import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Notice } from '../types'
import { DEFAULTS, parseConfig } from './config'
import type { MoltConfig } from './config'
import { CHARS_PER_TOKEN, atLeast, projectedPercent, stageOf, thresholdsFor } from './measure'
import { gateAllows, isProgress } from './gate'
import { markerPath } from './handoff'
import { briefPrompt, extractFacts, factsBrief, isUsableSummary, pickHandoff, resolvePath } from './handoff'
import type { Handoff, Message } from './handoff'
import { fallbackPath, lineagePath, parseLineage } from './records'
import type { Lineage } from './records'
import type { Stage, Thresholds } from './measure'
import { activePath, autonomicPath, logPath, parseAutonomic, safeSessionId } from './records'
import { DEFAULT_INSTRUCTIONS, DEFAULT_SEED, HARD_NOTE, expandHome, fill } from './templates'

// molt: in-place context handoff (spec §2). Module variables survive /clear, which is
// what a molt needs to carry across; $.state does not, and holds only the band.

type Engine = EngineInterface

const notice = atom({ plugin: 'molt', key: 'notice' } as const, null as Notice)

let cfg: MoltConfig = DEFAULTS
let stage: Stage = 'below'
let lastPercent: number | undefined
const off = new Set<string>()
let paused: string | undefined
let seeded: { session: string; startPercent?: number } | undefined

const MAX_STOP_BLOCKS = 2
let unmeasured = 0                        // tool and response output no response has measured yet
let inFlight = false                      // a molt between /clear and its seed
let progress = 0                          // Write, Edit or commit since the last molt
const nudged = new Set<string>()          // sessions told once at a tool result
const stopBlocks = new Map<string, number>()
const lastMd = new Map<string, string>()  // the last .md a session wrote past soft
const forced = new Set<string>()          // /molt now: soft whatever the fill
let unattended = 0                        // molts since the operator last sent a prompt
let pending: { oldSession: string; handoff: string; chain: string; depth: number } | undefined

const USAGE = 'usage: /molt now | off | on | status'

async function home($: Engine): Promise<string> {
  return (await $.env.get('HOME')) ?? ''
}

async function readText($: Engine, path: string): Promise<string | undefined> {
  try {
    const text = await $.fs.read(path)
    return typeof text === 'string' ? text : undefined
  } catch {
    return undefined
  }
}

async function log($: Engine, line: string): Promise<void> {
  try {
    await $.process.run(['sh', '-c', 'mkdir -p "$(dirname "$2")" && printf "%s\\n" "$1" >> "$2"',
      'sh', `${new Date().toISOString()} ${line}`, logPath(await home($))])
  } catch {}
}

async function touchActive($: Engine, sessionId: string): Promise<void> {
  if (!safeSessionId(sessionId) || off.has(sessionId)) return
  try { await $.fs.write(activePath(await home($), sessionId), `${new Date().toISOString()}\n`) } catch {}
}

async function dropActive($: Engine, sessionId: string): Promise<void> {
  if (!safeSessionId(sessionId)) return
  try { await $.process.run(['rm', '-f', activePath(await home($), sessionId)]) } catch {}
}

async function setNotice($: Engine, value: Notice): Promise<void> {
  await update($, notice, () => value)
}

function currentThresholds(sessionId: string): Thresholds {
  return thresholdsFor(cfg, seeded?.session === sessionId ? seeded.startPercent : undefined)
}

async function measure($: Engine, sessionId: string): Promise<number | undefined> {
  const percent = projectedPercent((await $.session.usage()).context, unmeasured)
  if (percent !== undefined) {
    lastPercent = percent
    stage = stageOf(percent, currentThresholds(sessionId))
  }
  if (forced.has(sessionId) && stage === 'below') stage = 'soft'
  return percent
}

async function instruction($: Engine, sessionId: string): Promise<string> {
  const t = currentThresholds(sessionId)
  const values = { percent: Math.round(lastPercent ?? t.soft), soft: Math.round(t.soft), hard: Math.round(t.hard) }
  const text = fill(await template($, cfg.instructionsTemplate, DEFAULT_INSTRUCTIONS), values)
  return atLeast(stage, 'hard') ? `${text}\n\n${fill(HARD_NOTE, values)}` : text
}

async function ring($: Engine, bell: string, message: string): Promise<void> {
  try {
    await $.process.run(['sh', '-c', `AUTONOMIC_MESSAGE="$1"; export AUTONOMIC_MESSAGE; ${bell}`, 'sh', message])
  } catch (err) {
    await log($, `bell failed ${String(err)}`)
  }
}

async function pause($: Engine, sessionId: string, text: string, bell: string | undefined): Promise<void> {
  paused = sessionId
  await setNotice($, { text, tone: 'warn' })
  $.ui.toast(text)
  showStatus($, sessionId)
  if (bell !== undefined) await ring($, bell, text)
  await log($, `pause session=${sessionId} ${text}`)
}

async function fallbackBrief($: Engine, sessionId: string): Promise<string> {
  const raw = await $.session.messages()
  const messages = (Array.isArray(raw) ? raw : []) as Message[]
  const facts = extractFacts(messages)
  let summary: string | undefined
  try {
    const r = await $.model.complete({
      model: 'haiku',
      system: 'You write precise handoff briefs for coding sessions.',
      prompt: briefPrompt(messages, facts),
      maxTokens: 4000,
      timeoutMs: 60_000,
    })
    if (r.isAnswered && isUsableSummary(r.text)) summary = r.text
    else await log($, `haiku brief unusable session=${sessionId} reason=${r.isAnswered ? 'no Next step section' : r.reason}`)
  } catch (err) {
    await log($, `haiku brief error session=${sessionId} ${String(err)}`)
  }
  const path = fallbackPath(await home($), sessionId)
  await $.fs.write(path, factsBrief(facts, { sessionId, percent: lastPercent, summary }))
  return path
}

async function molt($: Engine, sessionId: string, handoff: Handoff): Promise<void> {
  const h = await home($)
  const record = parseAutonomic(await readText($, autonomicPath(h, sessionId)))
  const own = parseLineage(await readText($, lineagePath(h, sessionId)))
  if (record.mode === 'manual' && unattended >= cfg.manualMaxMolts) {
    return pause($, sessionId, `molt paused: ${unattended} molts in a row with no message from you. ` +
      `Send a message to resume; the handoff is at ${handoff.path}.`, undefined)
  }
  if (record.mode === 'autopilot' && own !== undefined && progress === 0) {
    return pause($, sessionId, 'molt paused: no progress since the last molt (no Write, Edit or commit). ' +
      `Autopilot stops here; the handoff is at ${handoff.path}.`, record.bell)
  }
  inFlight = true
  pending = { oldSession: sessionId, handoff: handoff.path, chain: own?.chain ?? sessionId, depth: (own?.depth ?? 0) + 1 }
  await setNotice($, { text: `molt: handing off at ${Math.round(lastPercent ?? 0)}% — ${handoff.path}`, tone: 'info' })
  await log($, `molt session=${sessionId} handoff=${handoff.path} source=${handoff.source} percent=${lastPercent}`)
  const p = pending
  $.command.run({ command: 'clear' }).then(async () => {
    // A SessionStart consumes pending before /clear resolves. When it did not, and the
    // session id is unchanged, a hook answered /clear without clearing.
    try {
      if (pending !== p || (await $.session.id()) !== sessionId) return
      pending = undefined
      inFlight = false
      await setNotice($, { text: `molt: /clear did not clear this session; it keeps going. The handoff is at ${handoff.path}.`, tone: 'warn' })
      await log($, `clear did not clear session=${sessionId}`)
    } catch {}
  }, async (err: unknown) => {
    pending = undefined
    inFlight = false
    await setNotice($, { text: `molt: /clear was rejected; this session keeps going. The handoff is at ${handoff.path}.`, tone: 'warn' })
    await log($, `clear rejected session=${sessionId} ${String(err)}`)
  })
}

function showStatus($: Engine, sessionId: string): void {
  if (off.has(sessionId)) return $.ui.status('molt: off')
  if (paused === sessionId) return $.ui.status('molt: paused')
  const t = currentThresholds(sessionId)
  $.ui.status(lastPercent === undefined ? 'molt' : `molt ${Math.round(lastPercent)}%/${Math.round(t.soft)}%`)
}

async function template($: Engine, path: string, fallback: string): Promise<string> {
  return (await readText($, expandHome(path, await home($))))?.trim() || fallback
}

async function writeMissingTemplates($: Engine): Promise<void> {
  const h = await home($)
  const pairs: Array<[string, string]> = [[cfg.instructionsTemplate, DEFAULT_INSTRUCTIONS], [cfg.seedTemplate, DEFAULT_SEED]]
  for (const [path, text] of pairs) {
    const full = expandHome(path, h)
    try {
      if (await $.fs.exists(full)) continue
      await $.fs.write(full, `${text}\n`)
    } catch (err) {
      await log($, `template write failed ${full} ${String(err)}`)
    }
  }
}

async function status($: Engine, sessionId: string): Promise<string> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const t = currentThresholds(sessionId)
  const record = parseAutonomic(await readText($, autonomicPath(await home($), sessionId)))
  const lines = [
    `molt is ${off.has(sessionId) ? 'off' : paused === sessionId ? 'paused' : 'on'} for this session.`,
    `fill: ${lastPercent === undefined ? 'not measured yet' : `${Math.round(lastPercent)}%`} — soft ${Math.round(t.soft)}%, hard ${Math.round(t.hard)}%, fallback ${Math.round(t.fallback)}%`,
    `mode (autonomic's record): ${record.mode}`,
  ]
  const b = usage.context.breakdown
  if (b === undefined || b.rawMaxTokens <= 0) lines.push('auto-compact threshold not readable on this build.')
  else if (!b.isAutoCompactEnabled || b.autoCompactThreshold === undefined) lines.push('auto-compact is off.')
  else {
    const at = (b.autoCompactThreshold / b.rawMaxTokens) * 100
    lines.push(at <= t.hard
      ? `WARNING: auto-compact runs at ${Math.round(at)}%, at or below molt's hard threshold (${Math.round(t.hard)}%). Raise auto-compact or lower molt's thresholds, or auto-compact acts first.`
      : `auto-compact at ${Math.round(at)}%: above molt's hard threshold.`)
  }
  if (cfg.problems.length) lines.push(`settings: ${cfg.problems.join('; ')}`)
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  cfg = parseConfig(options as Readonly<Record<string, unknown>> | undefined)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'molt', description: 'molt: now | off | on | status' })
      const sessionId = await $.session.id()
      await touchActive($, sessionId)
      showStatus($, sessionId)
      if (cfg.problems.length) $.ui.toast(`molt: ${cfg.problems.join('; ')}`)
    } catch (err) {
      await log($, `session.start error ${String(err)}`)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await dropActive($, e.sessionId)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    try {
      if (e.source === 'startup') await writeMissingTemplates($)
      await touchActive($, e.session_id)
      if (e.source === 'clear' && pending !== undefined) {
        const p = pending
        pending = undefined
        // Counted here, once the clear happened: a /clear that is rejected or never clears
        // is not a molt for the loop guards.
        unattended += 1
        progress = 0
        forced.delete(p.oldSession)
        const sessionId = e.session_id
        seeded = { session: sessionId }
        unmeasured = 0
        stage = 'below'
        lastPercent = undefined
        // The session is already cleared: nothing below may stop the seed from going out.
        let seedText = fill(DEFAULT_SEED, { path: p.handoff })
        try { seedText = fill(await template($, cfg.seedTemplate, DEFAULT_SEED), { path: p.handoff }) } catch {}
        // Not awaited: the seed's turn cannot start until this hook returns.
        $.prompt.submit({ text: seedText }).catch(async (err: unknown) => {
          await setNotice($, { text: `molt: the seed was rejected. Resume by hand from ${p.handoff}.`, tone: 'warn' })
          await log($, `seed rejected session=${sessionId} ${String(err)}`)
        })
        try {
          const lineage: Lineage = { from: p.oldSession, chain: p.chain, depth: p.depth, handoff: p.handoff }
          await $.fs.write(lineagePath(await home($), sessionId), `${JSON.stringify(lineage, null, 2)}\n`)
        } catch (err) {
          await log($, `lineage write failed session=${sessionId} ${String(err)}`)
        }
        await setNotice($, { text: `molt: resumed from ${p.handoff}`, tone: 'info' })
        await log($, `seeded session=${sessionId} from=${p.oldSession} depth=${p.depth}`)
      }
    } catch (err) {
      await log($, `SessionStart error ${String(err)}`)
    } finally {
      inFlight = false
    }
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      const sessionId = await $.session.id()
      await touchActive($, sessionId)
      if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
        unattended = 0
        if (paused === sessionId) paused = undefined
        const value = await read($, notice)
        if (value !== null && (value.tone === 'info' || paused === undefined)) await setNotice($, null)
      }
    } catch (err) {
      await log($, `prompt.submit error ${String(err)}`)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const args = e as unknown as Readonly<Record<string, unknown>>
    let sessionId = ''
    try {
      sessionId = await $.session.id()
      if (!off.has(sessionId) && !inFlight) {
        await measure($, sessionId)
        if (atLeast(stage, 'hard') && !gateAllows(e.tool, args)) {
          await log($, `gate denied session=${sessionId} tool=${e.tool} percent=${lastPercent}`)
          return { deny: await instruction($, sessionId) }
        }
      }
    } catch (err) {
      await log($, `tool.call gate error ${String(err)}`)
    }
    const r = await next(e)
    if (typeof r.text === 'string') unmeasured += Math.ceil(r.text.length / CHARS_PER_TOKEN)
    if (r.deny === undefined && r.isError === undefined) {
      // Below soft only: past it the session writes and commits the handoff itself, which
      // would make every molt look like progress to the autopilot loop guard.
      if (isProgress(e.tool, args) && !atLeast(stage, 'soft')) progress += 1
      const path = args.file_path
      if ((e.tool === 'Write' || e.tool === 'Edit') && typeof path === 'string' && path.endsWith('.md')
        && sessionId !== '' && atLeast(stage, 'soft')) lastMd.set(sessionId, path)
    }
    return r
  })

  on('classic.PostToolUse', async ($, e, next) => {
    const r = await next(e)
    try {
      if ((e as { agent_id?: string }).agent_id !== undefined) return r
      const sessionId = e.session_id
      if (off.has(sessionId) || inFlight || nudged.has(sessionId)) return r
      await measure($, sessionId)
      if (!atLeast(stage, 'soft')) return r
      nudged.add(sessionId)
      return { ...r, additionalContext: [...(r.additionalContext ?? []), await instruction($, sessionId)] }
    } catch (err) {
      await log($, `PostToolUse error ${String(err)}`)
      return r
    }
  })

  on('classic.Stop', async ($, e, next) => {
    const r = await next(e)
    try {
      const sessionId = e.session_id
      if (off.has(sessionId) || inFlight || paused === sessionId) return r
      await measure($, sessionId)
      if (!atLeast(stage, 'soft')) return r
      const marker = markerPath(e.last_assistant_message ?? '')
      let missing: string | undefined
      if (marker !== undefined) {
        const path = resolvePath(marker, await $.session.cwd(), await home($))
        if (await $.fs.exists(path)) return r
        missing = path
      }
      const n = stopBlocks.get(sessionId) ?? 0
      if (n >= MAX_STOP_BLOCKS) return r
      stopBlocks.set(sessionId, n + 1)
      const text = missing === undefined
        ? await instruction($, sessionId)
        : `molt: the MOLT-HANDOFF line names ${missing}, but ${missing} does not exist. Write the handoff file, then end your reply with MOLT-HANDOFF: <its absolute path>.`
      return { ...r, block: r.block === undefined ? text : `${r.block}\n\n${text}` }
    } catch (err) {
      await log($, `Stop error ${String(err)}`)
      return r
    }
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const before = unmeasured
    const r = yield* next(e)
    try {
      if (r.usage) {
        // The response measured everything up to its request; its own output, and any
        // tool output that landed while it streamed, are new.
        unmeasured = Math.max(0, unmeasured - before) + (r.usage.output_tokens ?? 0)
        const sessionId = await $.session.id()
        if (seeded?.session === sessionId && seeded.startPercent === undefined) {
          const window = (await $.session.usage()).context.window
          const input = (r.usage.input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0)
          if (window > 0) seeded.startPercent = (input / window) * 100
        }
      }
    } catch (err) {
      await log($, `turn.step error ${String(err)}`)
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || e.isAborted) return r
    try {
      const sessionId = await $.session.id()
      await touchActive($, sessionId)
      if (off.has(sessionId) || inFlight || paused === sessionId) { showStatus($, sessionId); return r }
      await measure($, sessionId)
      showStatus($, sessionId)
      // Below soft a marker is not a molt: a seeded session keeps its minimum room, and a
      // quoted or example marker line does not clear the session. /molt now sets soft.
      if (!atLeast(stage, 'soft')) return r
      const marker = markerPath(e.answer)
      const resolved = marker === undefined ? undefined : resolvePath(marker, await $.session.cwd(), await home($))
      let handoff = pickHandoff(resolved, lastMd.get(sessionId))
      if (handoff !== undefined && !(await $.fs.exists(handoff.path))) {
        await log($, `handoff path missing session=${sessionId} path=${handoff.path}`)
        handoff = undefined
      }
      if (handoff === undefined) {
        // The session still has room to write it: the Stop reflex asks again, up to its cap.
        if (!atLeast(stage, 'fallback') && (stopBlocks.get(sessionId) ?? 0) < MAX_STOP_BLOCKS) return r
        handoff = { path: await fallbackBrief($, sessionId), source: 'fallback' }
      }
      await molt($, sessionId, handoff)
    } catch (err) {
      await log($, `turn.complete error ${String(err)}`)
    }
    return r
  })

  on('command.run', { command: 'molt' }, async ($, e) => {
    const sessionId = await $.session.id()
    const arg = (e.args ?? '').trim()
    if (arg === 'off') {
      off.add(sessionId)
      await dropActive($, sessionId)
      showStatus($, sessionId)
      return { text: 'molt is off for this session. The crew context-ceiling hooks speak again here.' }
    }
    if (arg === 'on') {
      off.delete(sessionId)
      await touchActive($, sessionId)
      showStatus($, sessionId)
      return { text: 'molt is on for this session.' }
    }
    if (arg === 'now') {
      off.delete(sessionId)
      paused = undefined
      forced.add(sessionId)
      await measure($, sessionId)
      // The host refuses $.prompt.submit here: it would wait on the turn this hook holds.
      // The request goes in the prompt box for one Enter, or rides the next prompt.
      const text = await instruction($, sessionId)
      const { isFilled } = await $.prompt.fill({ text })
      if (isFilled) return { text: 'molt: the handoff request is in the prompt box. Press Enter to send it.' }
      return { text: 'molt: the next prompt you send carries the handoff request.', context: [text] }
    }
    if (arg === 'status') return { text: await status($, sessionId) }
    return { text: USAGE }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const value = await read($, notice)
    if (value === null || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor={value.tone === 'info'}>{value.text} </Text>
        <Button key="dismiss" label="Dismiss" onPress={() => update($, notice, () => null)} />
      </Box>
    )
  })
}
