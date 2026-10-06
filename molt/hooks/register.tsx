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
import { activePath, autonomicPath, logPath, parseAutonomic, safeSessionId, stagePath } from './records'
import { BLOCK_NOTE, CHILD_NOTE, CHILD_WARNING, DEFAULT_INSTRUCTIONS, DEFAULT_SEED, DEFAULT_WARNING, OLD_DEFAULT_INSTRUCTIONS, ROOT_NOTE, expandHome, fill } from './templates'

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
const lastMd = new Map<string, string>()  // the last .md a session wrote past the command
const forced = new Set<string>()          // /molt now: the command stage whatever the fill
let unattended = 0                        // molts since the operator last sent a prompt
let pending: { oldSession: string; handoff: string; chain: string; depth: number } | undefined
const warned = new Map<string, number>()   // warnings delivered per session: 0, 1 or 2
const handedOff = new Set<string>()        // child sessions that have named their handoff
const commandNoted = new Set<string>()     // child sessions whose status file says 'handoff required'
let statusFailed = false                   // the status-file failure is logged once per process

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

// A handoff must be a file the resumed session can read; a directory exists but cannot be.
async function isReadableFile($: Engine, path: string): Promise<boolean> {
  return (await readText($, path)) !== undefined
}

async function log($: Engine, line: string): Promise<void> {
  try {
    await $.process.run(['sh', '-c', 'mkdir -p "$(dirname "$2")" && printf "%s\\n" "$1" >> "$2"',
      'sh', `${new Date().toISOString()} ${line}`, logPath(await home($))])
  } catch {}
}

async function touchActive($: Engine, sessionId: string): Promise<void> {
  if (!safeSessionId(sessionId) || off.has(sessionId) || paused === sessionId) return
  try { await $.fs.write(activePath(await home($), sessionId), `${new Date().toISOString()}\n`) } catch {}
}

async function dropActive($: Engine, sessionId: string): Promise<void> {
  if (!safeSessionId(sessionId)) return
  try { await $.process.run(['rm', '-f', activePath(await home($), sessionId)]) } catch {}
}

// The stage file (0.2.1): molt's stage and effective thresholds, for autonomic's turn-end
// floor. Rewritten only when the stage or a threshold changes; best-effort, logged once.
const published = new Map<string, string>()
let stageFailed = false
async function publishStage($: Engine, sessionId: string): Promise<void> {
  if (!safeSessionId(sessionId)) return
  const t = currentThresholds(sessionId)
  const s = off.has(sessionId) ? 'off' : stage
  const key = `${s} ${t.command} ${t.block} ${t.fallback}`
  if (published.get(sessionId) === key) return
  try {
    const body = { stage: s, ...(lastPercent === undefined ? {} : { percent: lastPercent }), command: t.command, block: t.block, fallback: t.fallback, at: new Date().toISOString() }
    await $.fs.write(stagePath(await home($), sessionId), `${JSON.stringify(body)}\n`)
    published.set(sessionId, key)
  } catch (err) {
    if (stageFailed) return
    stageFailed = true
    await log($, `stage write failed session=${sessionId} ${String(err)}`)
  }
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
  if (forced.has(sessionId) && !atLeast(stage, 'command')) stage = 'command'
  await publishStage($, sessionId)
  return percent
}

async function instruction($: Engine, sessionId: string): Promise<string> {
  const t = currentThresholds(sessionId)
  const values = {
    percent: Math.round(lastPercent ?? t.command), command: Math.round(t.command), block: Math.round(t.block),
    soft: Math.round(t.command), hard: Math.round(t.block),   // 0.1.0 template names (plan decision 5)
  }
  const text = `${fill(await template($, cfg.instructionsTemplate, DEFAULT_INSTRUCTIONS), values)}\n\n${noteFor(await isChild($))}`
  return atLeast(stage, 'block') ? `${text}\n\n${fill(BLOCK_NOTE, values)}` : text
}

async function isChild($: Engine): Promise<boolean> {
  return ((await $.env.get('MOLT_HANDOFF')) ?? '').trim() === 'parent'
}

function noteFor(child: boolean): string {
  return child ? CHILD_NOTE : ROOT_NOTE
}

// The warning this session is owed at its current stage, if any. Past the command the
// command text stands in for both, so no warning is delivered after it.
function dueWarning(sessionId: string): 1 | 2 | undefined {
  if (atLeast(stage, 'command') || !atLeast(stage, 'warn')) return undefined
  const done = warned.get(sessionId) ?? 0
  if (stage === 'warnAgain') return done < 2 ? 2 : undefined
  return done < 1 ? 1 : undefined
}

// A child's events, one line each, appended for its parent to read (spec §1.4). Never
// for a root; a failure here never stops a warning or a handoff.
async function appendStatus($: Engine, event: string): Promise<void> {
  if (!(await isChild($))) return
  const path = ((await $.env.get('MOLT_STATUS_PATH')) ?? '').trim()
  if (path === '') return
  try {
    // The host has no append, so each event rewrites the file. A file that exists but
    // cannot be read is left alone: rewriting it would drop the parent's earlier lines.
    const old = await readText($, path)
    if (old === undefined && await $.fs.exists(path)) throw new Error('exists but cannot be read')
    await $.fs.write(path, `${old ?? ''}${new Date().toISOString()} ${event}\n`)
  } catch (err) {
    if (statusFailed) return
    statusFailed = true
    await log($, `status write failed ${path} ${String(err)}`)
  }
}

async function noteCommand($: Engine, sessionId: string): Promise<void> {
  if (commandNoted.has(sessionId)) return
  commandNoted.add(sessionId)
  await appendStatus($, 'handoff required')
}

function warnedAt(sessionId: string, which: 1 | 2): number {
  const t = currentThresholds(sessionId)
  return Math.round(which === 1 ? t.warn : t.warnAgain)
}

// A child is never cleared: its parent replaces it (spec §1.3).
async function handOff($: Engine, sessionId: string, handoff: Handoff): Promise<void> {
  handedOff.add(sessionId)
  await appendStatus($, `handed-off ${handoff.path}`)
  try { await setNotice($, { text: `molt: handed off to the parent — ${handoff.path}`, tone: 'info' }) } catch {}
  await log($, `handed off session=${sessionId} handoff=${handoff.path} source=${handoff.source} percent=${lastPercent}`)
}

async function warningText($: Engine, sessionId: string, which: 1 | 2): Promise<string> {
  const t = currentThresholds(sessionId)
  const values = { percent: Math.round(lastPercent ?? t.warn), stage: which === 1 ? 'first' : 'second', command: Math.round(t.command) }
  const text = fill(await template($, cfg.warningTemplate, DEFAULT_WARNING), values)
  return (await isChild($)) ? `${text}\n\n${CHILD_WARNING}` : text
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
  await dropActive($, sessionId)
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
  // /molt now is the operator asking for this molt: it is not a loop, whatever the progress.
  if (record.mode === 'autopilot' && own !== undefined && progress === 0 && !forced.has(sessionId)) {
    return pause($, sessionId, 'molt paused: no progress since the last molt (no Write, Edit or commit). ' +
      `Autopilot stops here; the handoff is at ${handoff.path}.`, record.bell)
  }
  inFlight = true
  pending = { oldSession: sessionId, handoff: handoff.path, chain: own?.chain ?? sessionId, depth: (own?.depth ?? 0) + 1 }
  // Best-effort: inFlight and pending are set, so nothing between here and /clear may throw.
  try { await setNotice($, { text: `molt: handing off at ${Math.round(lastPercent ?? 0)}% — ${handoff.path}`, tone: 'info' }) } catch {}
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

// The seed of a molt that has cleared the session. It is submitted before any step that
// can fail; every step after it is best-effort, and a rejection's warning always wins.
async function seed($: Engine, sessionId: string, p: NonNullable<typeof pending>): Promise<void> {
  // Counted here, once the clear happened: a /clear that is rejected or never clears is not
  // a molt for the loop guards.
  unattended += 1
  progress = 0
  forced.delete(p.oldSession)
  seeded = { session: sessionId }
  let text = fill(DEFAULT_SEED, { path: p.handoff })
  try { text = fill(await template($, cfg.seedTemplate, DEFAULT_SEED), { path: p.handoff }) } catch {}
  const warning = { text: `molt: the seed was rejected. Resume by hand from ${p.handoff}.`, tone: 'warn' } as const
  let rejected = false
  // Not awaited: the seed's turn cannot start until this hook returns.
  $.prompt.submit({ text }).catch(async (err: unknown) => {
    rejected = true
    try { await setNotice($, warning) } catch {}
    await log($, `seed rejected session=${sessionId} ${String(err)}`)
  })
  try {
    await setNotice($, { text: `molt: resumed from ${p.handoff}`, tone: 'info' })
    if (rejected) await setNotice($, warning)
  } catch {}
  try {
    const lineage: Lineage = { from: p.oldSession, chain: p.chain, depth: p.depth, handoff: p.handoff }
    await $.fs.write(lineagePath(await home($), sessionId), `${JSON.stringify(lineage, null, 2)}\n`)
  } catch (err) {
    await log($, `lineage write failed session=${sessionId} ${String(err)}`)
  }
  await log($, `seeded session=${sessionId} from=${p.oldSession} depth=${p.depth}`)
}

function showStatus($: Engine, sessionId: string): void {
  if (off.has(sessionId)) return $.ui.status('molt: off')
  if (paused === sessionId) return $.ui.status('molt: paused')
  const t = currentThresholds(sessionId)
  $.ui.status(lastPercent === undefined ? 'molt' : `molt ${Math.round(lastPercent)}%/${Math.round(t.command)}%`)
}

async function template($: Engine, path: string, fallback: string): Promise<string> {
  return (await readText($, expandHome(path, await home($))))?.trim() || fallback
}

async function writeMissingTemplates($: Engine): Promise<void> {
  const h = await home($)
  const pairs: Array<[string, string]> = [
    [cfg.instructionsTemplate, DEFAULT_INSTRUCTIONS], [cfg.warningTemplate, DEFAULT_WARNING], [cfg.seedTemplate, DEFAULT_SEED],
  ]
  for (const [path, text] of pairs) {
    const full = expandHome(path, h)
    try {
      if (await $.fs.exists(full)) {
        // 0.1.0 wrote its own default here; only that exact text is replaced (plan decision 4).
        if (text !== DEFAULT_INSTRUCTIONS || (await readText($, full))?.trim() !== OLD_DEFAULT_INSTRUCTIONS.trim()) continue
      }
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
    `fill: ${lastPercent === undefined ? 'not measured yet' : `${Math.round(lastPercent)}%`} — warnings ${Math.round(t.warn)}% and ${Math.round(t.warnAgain)}%, handoff ${Math.round(t.command)}%, block ${Math.round(t.block)}%, fallback ${Math.round(t.fallback)}%`,
    `mode (autonomic's record): ${record.mode}`,
  ]
  const b = usage.context.breakdown
  if (b === undefined || b.rawMaxTokens <= 0) lines.push('auto-compact threshold not readable on this build.')
  else if (!b.isAutoCompactEnabled || b.autoCompactThreshold === undefined) lines.push('auto-compact is off.')
  else {
    const at = (b.autoCompactThreshold / b.rawMaxTokens) * 100
    lines.push(at <= t.block
      ? `WARNING: auto-compact runs at ${Math.round(at)}%, at or below molt's block threshold (${Math.round(t.block)}%). Raise auto-compact or lower molt's thresholds, or auto-compact acts first.`
      : `auto-compact at ${Math.round(at)}%: above molt's block threshold.`)
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
    // A molt's seed goes out first. The session is already cleared, so nothing after this
    // point — another plugin's SessionStart included — may stop it.
    const p = e.source === 'clear' ? pending : undefined
    if (p !== undefined) pending = undefined
    // Module state survives a clear, a compact and a resume; the fill it measured does not.
    if (e.source === 'clear' || e.source === 'compact' || e.source === 'resume') {
      stage = 'below'
      lastPercent = undefined
      unmeasured = 0
      // A compact keeps the session id: the new window gets a whole handoff cycle again.
      nudged.delete(e.session_id)
      warned.delete(e.session_id)
      commandNoted.delete(e.session_id)
      stopBlocks.delete(e.session_id)
      lastMd.delete(e.session_id)
      published.delete(e.session_id)
      try { await publishStage($, e.session_id) } catch {}
    }
    if (p !== undefined) {
      try { await seed($, e.session_id, p) } catch (err) { await log($, `seed error ${String(err)}`) }
    }
    inFlight = false
    const r = await next(e)
    try {
      if (e.source === 'startup') await writeMissingTemplates($)
      await touchActive($, e.session_id)
    } catch (err) {
      await log($, `SessionStart error ${String(err)}`)
    }
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      const sessionId = await $.session.id()
      if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
        unattended = 0
        if (paused === sessionId) paused = undefined
        try {
          const value = await read($, notice)
          if (value !== null && (value.tone === 'info' || paused === undefined)) await setNotice($, null)
        } catch (err) {
          await log($, `prompt.submit notice error ${String(err)}`)
        }
      }
      // After the pause check, so a lifted pause brings the marker back in this hook (#668).
      await touchActive($, sessionId)
    } catch (err) {
      await log($, `prompt.submit error ${String(err)}`)
    }
    let warning: { sessionId: string; due: 1 | 2; text: string } | undefined
    try {
      const sessionId = await $.session.id()
      // A seeded session's ladder sits above its starting fill, unknown until a response
      // measures it: its seed carries no warning.
      const unshifted = seeded?.session === sessionId && seeded.startPercent === undefined
      if (!off.has(sessionId) && !inFlight && paused !== sessionId && !unshifted) {
        await measure($, sessionId)
        const due = dueWarning(sessionId)
        if (due !== undefined && !handedOff.has(sessionId)) warning = { sessionId, due, text: await warningText($, sessionId, due) }
      }
    } catch (err) {
      await log($, `prompt.submit warning error ${String(err)}`)
    }
    if (warning === undefined) return next(e)
    const r = await next({ ...e, context: [...(e.context ?? []), warning.text] })
    // A prompt refused beneath molt carried no warning: the next prompt that enters does.
    if (r.drop === undefined) {
      warned.set(warning.sessionId, warning.due)
      await appendStatus($, `warned ${warnedAt(warning.sessionId, warning.due)}`)
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const args = e as unknown as Readonly<Record<string, unknown>>
    let sessionId = ''
    try {
      sessionId = await $.session.id()
      if (!off.has(sessionId) && !inFlight) {
        await measure($, sessionId)
        if (atLeast(stage, 'block') && !gateAllows(e.tool, args)) {
          await log($, `gate denied session=${sessionId} tool=${e.tool} percent=${lastPercent}`)
          return { deny: await instruction($, sessionId) }
        }
      }
    } catch (err) {
      await log($, `tool.call gate error ${String(err)}`)
    }
    const r = await next(e)
    if (typeof r.text === 'string') unmeasured += Math.ceil(r.text.length / CHARS_PER_TOKEN)
    // A staged Write or Edit is held for review and leaves the file unchanged.
    const staged = (r.result as { staged?: unknown } | undefined)?.staged === true
    if (r.deny === undefined && r.isError === undefined && !staged) {
      // Below the first warning only: past it the session may write and commit its handoff, which
      // would make every molt look like progress to the autopilot loop guard.
      if (isProgress(e.tool, args) && !atLeast(stage, 'warn')) progress += 1
      const path = args.file_path
      if ((e.tool === 'Write' || e.tool === 'Edit') && typeof path === 'string' && path.endsWith('.md')
        && sessionId !== '' && atLeast(stage, 'command')) lastMd.set(sessionId, path)
    }
    return r
  })

  on('classic.PostToolUse', async ($, e, next) => {
    const r = await next(e)
    try {
      if ((e as { agent_id?: string }).agent_id !== undefined) return r
      const sessionId = e.session_id
      if (off.has(sessionId) || inFlight || handedOff.has(sessionId)) return r
      await measure($, sessionId)
      if (atLeast(stage, 'command')) {
        if (nudged.has(sessionId)) return r
        warned.set(sessionId, 2)
        nudged.add(sessionId)
        await noteCommand($, sessionId)
        return { ...r, additionalContext: [...(r.additionalContext ?? []), await instruction($, sessionId)] }
      }
      const due = dueWarning(sessionId)
      if (due === undefined) return r
      warned.set(sessionId, due)
      await appendStatus($, `warned ${warnedAt(sessionId, due)}`)
      return { ...r, additionalContext: [...(r.additionalContext ?? []), await warningText($, sessionId, due)] }
    } catch (err) {
      await log($, `PostToolUse error ${String(err)}`)
      return r
    }
  })

  on('classic.Stop', async ($, e, next) => {
    const r = await next(e)
    try {
      const sessionId = e.session_id
      if (off.has(sessionId) || inFlight || paused === sessionId || handedOff.has(sessionId)) return r
      await measure($, sessionId)
      if (!atLeast(stage, 'command')) return r
      const marker = markerPath(e.last_assistant_message ?? '')
      let missing: string | undefined
      if (marker !== undefined) {
        const path = resolvePath(marker, await $.session.cwd(), await home($))
        if (await isReadableFile($, path)) return r
        missing = path
      }
      const n = stopBlocks.get(sessionId) ?? 0
      if (n >= MAX_STOP_BLOCKS) return r
      stopBlocks.set(sessionId, n + 1)
      await noteCommand($, sessionId)
      const text = missing === undefined
        ? await instruction($, sessionId)
        : `molt: the MOLT-HANDOFF line names ${missing}, but ${missing} does not exist or is not a readable file. Write the handoff file, then end your reply with MOLT-HANDOFF: <its absolute path>.`
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
      if (off.has(sessionId) || inFlight || paused === sessionId || handedOff.has(sessionId)) { showStatus($, sessionId); return r }
      await measure($, sessionId)
      showStatus($, sessionId)
      // Below soft a marker is not a molt: a seeded session keeps its minimum room, and a
      // quoted or example marker line does not clear the session. /molt now sets soft.
      if (!atLeast(stage, 'warn')) return r
      const marker = markerPath(e.answer)
      const resolved = marker === undefined ? undefined : resolvePath(marker, await $.session.cwd(), await home($))
      let handoff = pickHandoff(resolved, lastMd.get(sessionId))
      if (handoff !== undefined && !(await isReadableFile($, handoff.path))) {
        await log($, `handoff path missing session=${sessionId} path=${handoff.path}`)
        handoff = undefined
      }
      if (handoff === undefined) {
        // A warned session may hand off at a point it chose; nothing is asked of it yet.
        if (!atLeast(stage, 'command')) return r
        // The session still has room to write it: the Stop reflex asks again, up to its cap.
        if (!atLeast(stage, 'fallback') && (stopBlocks.get(sessionId) ?? 0) < MAX_STOP_BLOCKS) return r
        handoff = { path: await fallbackBrief($, sessionId), source: 'fallback' }
      }
      if (await isChild($)) await handOff($, sessionId, handoff)
      else await molt($, sessionId, handoff)
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
      await publishStage($, sessionId)
      showStatus($, sessionId)
      return { text: 'molt is off for this session. The crew context-ceiling hooks speak again here.' }
    }
    if (arg === 'on') {
      off.delete(sessionId)
      await touchActive($, sessionId)
      await publishStage($, sessionId)
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
