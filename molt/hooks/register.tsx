import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Notice } from '../types'
import { DEFAULTS, parseConfig } from './config'
import type { MoltConfig } from './config'
import { CHARS_PER_TOKEN, atLeast, projectedPercent, stageOf, thresholdsFor } from './measure'
import { MAX_STOP_BLOCKS, gateAllows, isProgress, takeRequest, waitsIn } from './gate'
import type { Request } from './gate'
import { markerPath } from './handoff'
import { briefPrompt, extractFacts, factsBrief, isUsableSummary, pickHandoff, resolvePath } from './handoff'
import type { Handoff, Message } from './handoff'
import { fallbackPath, lineagePath, parseLineage } from './records'
import type { Lineage, Successor } from './records'
import type { Stage, Thresholds } from './measure'
import { activePath, autonomicPath, logPath, parseSuccessor, sdkHandoffPath, successorPath, parseAutonomic, progressPath, recordBell, safeSessionId, stagePath } from './records'
import {
  SESSION_OFF, SESSION_ON, COMMAND_USAGE, STATUS_OFF, STATUS_PAUSED,
  HANDOFF_REQUIRED, HANDED_OFF, PARENT_HANDOFF, HANDING_OFF, RESUMED,
  SEED_REJECTED, CONFIG_PROBLEMS, SETTINGS_PROBLEMS, SESSION_STATUS, FILL_STATUS,
  MODE_STATUS, WARNED, PAUSED_UNATTENDED, PAUSED_NO_PROGRESS, PAUSED_AGENT, MISSING_HANDOFF,
  STATUS_METER, BLOCK_NOTE, CHILD_NOTE, SDK_NOTE, SDK_HANDED_OFF, STALE_SESSION, CHILD_WARNING, DEFAULT_INSTRUCTIONS,
  DEFAULT_SEED, DEFAULT_WARNING, OLD_DEFAULT_INSTRUCTIONS, ROOT_NOTE, expandHome,
  OPERATOR_LEAD, PAST_LEAD, fill,
} from './templates'

// molt: in-place context handoff (spec §2). Module variables survive /clear, which is
// what a molt needs to carry across; $.state does not, and holds only the band.

type Engine = EngineInterface

const notice = atom({ plugin: 'molt', key: 'notice' } as const, null as Notice)

let cfg: MoltConfig = DEFAULTS
let stage: Stage = 'below'
let lastPercent: number | undefined
const off = new Set<string>()
let paused: string | undefined
let pausedText = ''                       // the pause's reason, told to the agent at each prompt it gets
let seeded: { session: string; startPercent?: number } | undefined

// One copy in two files: molt's register.tsx and autonomic's; tests/test-mod-shell-parity.sh holds the two identical.
// The engine kills a `process.run` child at 30 s when no bound is given — the same bound
// molt-v0.2.2's awaited bell therefore ran under. Stated explicitly, and never tightened:
// a slow bell (a remote notify curl) that completed on 0.2.2 must still complete, while a
// hung one stays bounded. Nothing waits on it (see `pause`), so this is only a backstop.
const BELL_TIMEOUT_MS = 30_000
let unmeasured = 0                        // tool and response output no response has measured yet
let inFlight = false                      // a molt between /clear and its seed
let progress = 0                          // Write, Edit or commit since the last molt
const nudged = new Set<string>()          // sessions told once at a tool result
const stopBlocks = new Map<string, number>()
const lastMd = new Map<string, string>()  // the last .md a session wrote past the command
const forced = new Set<string>()          // /molt now: the command stage whatever the fill
let unattended = 0                        // molts since the operator last sent a prompt
let pending: { oldSession: string; handoff: string; chain: string; depth: number } | undefined
// The turn-end requests molt submitted that have not yet arrived at prompt.submit (#929): one
// at a time per session, and each runs only in the session that was asked.
const asked: Request[] = []
const warned = new Map<string, number>()   // warnings delivered per session: 0, 1 or 2
const handedOff = new Set<string>()        // child sessions that have named their handoff
const commandNoted = new Set<string>()     // child sessions whose status file says HANDOFF_REQUIRED
let statusFailed = false                   // the status-file failure is logged once per process
const sdkHandoffs = new Map<string, string | null>()  // root sessions an SDK host keeps: their handoff path, also on disk
const stale = new Map<string, Successor | null>()  // a session's successor record, read once per process
// What a stale session may still run: reads, so it can find the newest handoff for the operator.
const STALE_TOOLS = new Set(['Read', 'Grep', 'Glob'])

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

// The session's progress, kept beside the module count: /reload-plugins reloads this
// module and the count falls to 0, while the file the session wrote survives it — which
// is what the next autopilot molt reads (#713). Best-effort, logged once per process.
let progressFailed = false
async function markProgress($: Engine, sessionId: string): Promise<void> {
  if (!safeSessionId(sessionId)) return
  try {
    await $.fs.write(progressPath(await home($), sessionId), `${new Date().toISOString()}\n`)
  } catch (err) {
    if (progressFailed) return
    progressFailed = true
    await log($, `progress write failed session=${sessionId} ${String(err)}`)
  }
}

async function dropProgress($: Engine, sessionId: string): Promise<void> {
  if (!safeSessionId(sessionId)) return
  try { await $.process.run(['rm', '-f', progressPath(await home($), sessionId)]) } catch {}
}

// Above 0 the module count has it; at 0 — after a reload — the session's own file still
// does. A file that cannot be read counts as no file: the guard keeps its older behaviour.
async function hasProgress($: Engine, h: string, sessionId: string): Promise<boolean> {
  if (progress > 0) return true
  try {
    return await $.fs.exists(progressPath(h, sessionId))
  } catch {
    return false
  }
}

// The stage file (0.2.1): molt's stage and effective thresholds, for autonomic's /autopilot status and its
// handling of molt's block deny. Rewritten only when the stage or a threshold changes; best-effort, logged once.
const published = new Map<string, string>()
let stageFailed = false
async function publishStage($: Engine, sessionId: string): Promise<void> {
  if (!safeSessionId(sessionId)) return
  const t = currentThresholds(sessionId)
  const s = off.has(sessionId) ? 'off' : stage
  // A seeded session's ladder is unknown until a response measures its start: no thresholds yet (PR #681).
  const known = !(seeded?.session === sessionId && seeded.startPercent === undefined)
  const key = known ? `${s} ${t.command} ${t.block} ${t.fallback}` : `${s} unknown`
  if (published.get(sessionId) === key) return
  try {
    const ladder = known ? { command: t.command, block: t.block, fallback: t.fallback } : {}
    const body = { stage: s, ...(lastPercent === undefined ? {} : { percent: lastPercent }), ...ladder, at: new Date().toISOString() }
    await $.fs.write(stagePath(await home($), sessionId), `${JSON.stringify(body)}\n`)
    published.set(sessionId, key)
  } catch (err) {
    if (stageFailed) return
    stageFailed = true
    await log($, `stage write failed session=${sessionId} ${String(err)}`)
  }
}

// Best effort: a notice that cannot be written never aborts the step that wanted it. A
// pause writes its toast, status, bell and log whether or not the band took the text (#665).
let noticeFailed = false
async function setNotice($: Engine, value: Notice): Promise<void> {
  try {
    await update($, notice, () => value)
  } catch (err) {
    if (noticeFailed) return
    noticeFailed = true
    await log($, `notice write failed ${String(err)}`)
  }
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
  let body = fill(await template($, cfg.instructionsTemplate, DEFAULT_INSTRUCTIONS), values)
  // /molt now below the handoff threshold: the built-in first line says "past" a threshold the fill has not reached (#903).
  const past = fill(PAST_LEAD, values)
  if (forced.has(sessionId) && (lastPercent ?? 0) < t.command && body.startsWith(past)) body = fill(OPERATOR_LEAD, values) + body.slice(past.length)
  const text = `${body}\n\n${await noteFor($)}`
  return atLeast(stage, 'block') ? `${text}\n\n${fill(BLOCK_NOTE, values)}` : text
}

async function isChild($: Engine): Promise<boolean> {
  return ((await $.env.get('MOLT_HANDOFF')) ?? '').trim() === 'parent'
}

// An Agent SDK library (the TypeScript or Python SDK) sets this. Such a host keeps the
// session id it started and resumes that id later, so a root cleared in place would come
// back as its pre-handoff self (#901). `sdk-cli` (`claude -p`) is not matched.
async function isSdkHost($: Engine): Promise<boolean> {
  const v = ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) ?? '').trim()
  return v === 'sdk-ts' || v === 'sdk-py'
}

async function noteFor($: Engine): Promise<string> {
  if (await isChild($)) return CHILD_NOTE
  return (await isSdkHost($)) ? SDK_NOTE : ROOT_NOTE
}

// The session's successor record, if it already molted into another session. Read once
// per process; a file that cannot be read or parsed counts as none.
async function staleRecord($: Engine, sessionId: string): Promise<Successor | undefined> {
  if (!safeSessionId(sessionId)) return undefined
  if (!stale.has(sessionId)) stale.set(sessionId, parseSuccessor(await readText($, successorPath(await home($), sessionId))) ?? null)
  return stale.get(sessionId) ?? undefined
}

// An SDK host may restart the process and resume this same session: the handoff it
// made is read back from its file, once per process, so it is not lost (#902).
async function sdkHandoff($: Engine, sessionId: string): Promise<string | undefined> {
  if (!safeSessionId(sessionId)) return undefined
  if (!sdkHandoffs.has(sessionId)) {
    const path = (await readText($, sdkHandoffPath(await home($), sessionId)))?.trim()
    sdkHandoffs.set(sessionId, path ? path : null)
    if (path) handedOff.add(sessionId)
  }
  return sdkHandoffs.get(sessionId) ?? undefined
}

function staleText(r: Successor): string {
  return fill(STALE_SESSION, { successor: r.successor, at: r.at, handoff: r.handoff })
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
  await appendStatus($, HANDOFF_REQUIRED)
}

function warnedAt(sessionId: string, which: 1 | 2): number {
  const t = currentThresholds(sessionId)
  return Math.round(which === 1 ? t.warn : t.warnAgain)
}

// A child is never cleared: its parent replaces it (spec §1.3).
async function handOff($: Engine, sessionId: string, handoff: Handoff): Promise<void> {
  handedOff.add(sessionId)
  await appendStatus($, fill(HANDED_OFF, { path: handoff.path }))
  try { await setNotice($, { text: fill(PARENT_HANDOFF, { path: handoff.path }), tone: 'info' }) } catch {}
  await log($, `handed off session=${sessionId} handoff=${handoff.path} source=${handoff.source} percent=${lastPercent}`)
}

async function warningText($: Engine, sessionId: string, which: 1 | 2): Promise<string> {
  const t = currentThresholds(sessionId)
  const values = { percent: Math.round(lastPercent ?? t.warn), stage: which === 1 ? 'first' : 'second', command: Math.round(t.command) }
  const text = fill(await template($, cfg.warningTemplate, DEFAULT_WARNING), values)
  if (await isChild($)) return `${text}\n\n${CHILD_WARNING}`
  return (await isSdkHost($)) ? `${text}\n\n${SDK_NOTE}` : text
}

// A root under an Agent SDK host is never cleared (#901): it stops pushing, as a child
// does, and each later prompt tells the agent to send the operator to a new thread.
async function sdkHandOff($: Engine, sessionId: string, handoff: Handoff): Promise<void> {
  handedOff.add(sessionId)
  sdkHandoffs.set(sessionId, handoff.path)
  if (safeSessionId(sessionId)) try {
    await $.fs.write(sdkHandoffPath(await home($), sessionId), `${handoff.path}\n`)
  } catch (err) {
    await log($, `sdk handoff write failed session=${sessionId} ${String(err)}`)
  }
  try { await setNotice($, { text: fill(SDK_HANDED_OFF, { path: handoff.path }), tone: 'warn' }) } catch {}
  await log($, `handed off to operator session=${sessionId} handoff=${handoff.path} source=${handoff.source} percent=${lastPercent} host=sdk`)
}

// Rung once and left to finish: the bell never gates the hook that paused the session. A bell
// that cannot start, throws, or is killed at BELL_TIMEOUT_MS rejects; one that runs and exits
// non-zero resolves. Both are failures and both are logged once — `log` never throws, so this
// promise always resolves and nothing is left unhandled (#665 item 4).
async function ring($: Engine, bell: string, message: string): Promise<void> {
  try {
    const r = await $.process.run(['sh', '-c', `AUTONOMIC_MESSAGE="$1"; export AUTONOMIC_MESSAGE; ${bell}`, 'sh', message], { timeoutMs: BELL_TIMEOUT_MS })
    if (r.exitCode !== 0) await log($, `bell failed exit=${r.exitCode}`)
  } catch (err) {
    await log($, `bell failed ${String(err)}`)
  }
}

async function pause($: Engine, sessionId: string, text: string, bell: string | undefined): Promise<void> {
  paused = sessionId
  pausedText = text
  await dropActive($, sessionId)
  await setNotice($, { text, tone: 'warn' })
  $.ui.toast(text)
  showStatus($, sessionId)
  // Not awaited: every caller of pause (both loop guards, both from turn.complete) returns
  // without waiting on the bell. That is not silence — it still rings, with this same text,
  // and still logs a failure once.
  if (bell !== undefined) void ring($, bell, text)
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
  const recordText = await readText($, autonomicPath(h, sessionId))
  const record = parseAutonomic(recordText)
  const own = parseLineage(await readText($, lineagePath(h, sessionId)))
  if (record.mode === 'manual' && unattended >= cfg.manualMaxMolts) {
    return pause($, sessionId, fill(PAUSED_UNATTENDED, { count: unattended, path: handoff.path }), recordBell(recordText))
  }
  // /molt now is the operator asking for this molt: it is not a loop, whatever the progress.
  if (record.mode === 'autopilot' && own !== undefined && !forced.has(sessionId) && !(await hasProgress($, h, sessionId))) {
    return pause($, sessionId, fill(PAUSED_NO_PROGRESS, { path: handoff.path }), record.bell)
  }
  inFlight = true
  pending = { oldSession: sessionId, handoff: handoff.path, chain: own?.chain ?? sessionId, depth: (own?.depth ?? 0) + 1 }
  // Best-effort: inFlight and pending are set, so nothing between here and /clear may throw.
  try { await setNotice($, { text: fill(HANDING_OFF, { percent: Math.round(lastPercent ?? 0), path: handoff.path }), tone: 'info' }) } catch {}
  await log($, `molt session=${sessionId} handoff=${handoff.path} source=${handoff.source} percent=${lastPercent}`)
  const p = pending
  $.command.run({ command: 'clear' }).then(async () => {
    // The clear resolved: under a new session id it cleared, and the new session gets the
    // seed first (#929: classic.SessionStart, which sent it, never runs for a plugin on an org
    // account). Under the same id a hook answered /clear without clearing.
    try {
      if (pending !== p) return
      pending = undefined
      const now = await $.session.id()
      if (now !== sessionId) {
        newWindow(now, 'clear')
        try { await seed($, now, p) } catch (err) { await log($, `seed error ${String(err)}`) }
        try { await publishStage($, now) } catch {}
        inFlight = false
        return
      }
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
  // The file belonged to the session that made the progress; a molt starts a new session
  // id, whose count starts at 0 like today's (#713).
  await dropProgress($, p.oldSession)
  forced.delete(p.oldSession)
  seeded = { session: sessionId }
  let text = fill(DEFAULT_SEED, { path: p.handoff })
  try { text = fill(await template($, cfg.seedTemplate, DEFAULT_SEED), { path: p.handoff }) } catch {}
  const warning = { text: fill(SEED_REJECTED, { path: p.handoff }), tone: 'warn' } as const
  let rejected = false
  // Not awaited: the seed's turn cannot start until this hook returns.
  $.prompt.submit({ text }).catch(async (err: unknown) => {
    rejected = true
    try { await setNotice($, warning) } catch {}
    await log($, `seed rejected session=${sessionId} ${String(err)}`)
  })
  try {
    await setNotice($, { text: fill(RESUMED, { path: p.handoff }), tone: 'info' })
    if (rejected) await setNotice($, warning)
  } catch {}
  // The status line still reads the session that molted; the new one has nothing measured
  // yet, and only a redraw says so (#665).
  showStatus($, sessionId)
  try {
    const lineage: Lineage = { from: p.oldSession, chain: p.chain, depth: p.depth, handoff: p.handoff }
    await $.fs.write(lineagePath(await home($), sessionId), `${JSON.stringify(lineage, null, 2)}\n`)
  } catch (err) {
    await log($, `lineage write failed session=${sessionId} ${String(err)}`)
  }
  // Keyed by the session that molted: a host that resumes it later finds it stale (#901).
  if (safeSessionId(p.oldSession)) try {
    const record: Successor = { successor: sessionId, handoff: p.handoff, at: new Date().toISOString() }
    await $.fs.write(successorPath(await home($), p.oldSession), `${JSON.stringify(record, null, 2)}\n`)
  } catch (err) {
    await log($, `successor write failed session=${p.oldSession} ${String(err)}`)
  }
  await log($, `seeded session=${sessionId} from=${p.oldSession} depth=${p.depth}`)
}

function showStatus($: Engine, sessionId: string): void {
  if (off.has(sessionId)) return $.ui.status(STATUS_OFF)
  if (paused === sessionId) return $.ui.status(STATUS_PAUSED)
  const t = currentThresholds(sessionId)
  $.ui.status(lastPercent === undefined ? 'molt' : fill(STATUS_METER, { percent: Math.round(lastPercent), command: Math.round(t.command) }))
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
  // The fill shown is the fill now, not the last one a hook happened to measure (#665).
  // A measure that fails keeps the cached figure.
  if (!off.has(sessionId) && !inFlight) try { await measure($, sessionId) } catch {}
  const usage = await $.session.usage({ breakdown: 'summary' })
  const t = currentThresholds(sessionId)
  const record = parseAutonomic(await readText($, autonomicPath(await home($), sessionId)))
  const lines = [
    fill(SESSION_STATUS, { state: off.has(sessionId) ? 'off' : paused === sessionId ? 'paused' : 'on' }),
    fill(FILL_STATUS, { percent: lastPercent === undefined ? 'not measured yet' : `${Math.round(lastPercent)}%`,
      warn: Math.round(t.warn), warnAgain: Math.round(t.warnAgain), command: Math.round(t.command), block: Math.round(t.block), fallback: Math.round(t.fallback) }),
    fill(MODE_STATUS, { mode: record.mode }),
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
  if (cfg.problems.length) lines.push(fill(SETTINGS_PROBLEMS, { problems: cfg.problems.join('; ') }))
  return lines.join('\n')
}

// The warning a main-loop tool result carries, if one is due: the command's instruction once
// past the command threshold, else the next of the two warnings.
async function warningFor($: Engine, sessionId: string): Promise<string | undefined> {
  if (off.has(sessionId) || inFlight || handedOff.has(sessionId)) return undefined
  await measure($, sessionId)
  if (atLeast(stage, 'command')) {
    if (nudged.has(sessionId)) return undefined
    warned.set(sessionId, 2)
    nudged.add(sessionId)
    await noteCommand($, sessionId)
    return instruction($, sessionId)
  }
  const due = dueWarning(sessionId)
  if (due === undefined) return undefined
  warned.set(sessionId, due)
  await appendStatus($, fill(WARNED, { percent: warnedAt(sessionId, due) }))
  return warningText($, sessionId, due)
}

// A new context window: after a /clear (a new session id), a resume or a compact (the same
// id). Module state survives each; the fill it measured does not. #929: these came from
// classic.SessionStart's source, which never reaches a plugin on an org account.
function newWindow(sessionId: string, source: 'clear' | 'compact' | 'resume'): void {
  stage = 'below'
  lastPercent = undefined
  unmeasured = 0
  // A compact keeps the session id: the new window gets a whole handoff cycle again.
  nudged.delete(sessionId)
  warned.delete(sessionId)
  commandNoted.delete(sessionId)
  stopBlocks.delete(sessionId)
  lastMd.delete(sessionId)
  published.delete(sessionId)
  // A compact gives this session a new window: a ladder raised by the fill the seed
  // landed in belongs to the old one, and the new window gets the plain ladder (#665).
  if (source === 'compact' && seeded?.session === sessionId) seeded = undefined
}

export const register: Register = (on, options) => {
  cfg = parseConfig(options as Readonly<Record<string, unknown>> | undefined)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'molt', description: 'molt: now | off | on | status' })
      const sessionId = await $.session.id()
      await touchActive($, sessionId)
      // The process start (#929: once classic.SessionStart's `startup`). A reload of the module
      // runs it again, which writes nothing: only missing templates are written.
      await writeMissingTemplates($)
      showStatus($, sessionId)
      if (cfg.problems.length) $.ui.toast(fill(CONFIG_PROBLEMS, { problems: cfg.problems.join('; ') }))
      await sdkHandoff($, sessionId)
      const r = await staleRecord($, sessionId)
      if (r !== undefined) {
        $.ui.toast(staleText(r))
        await log($, `stale session started session=${sessionId} successor=${r.successor}`)
      }
    } catch (err) {
      await log($, `session.start error ${String(err)}`)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await dropActive($, e.sessionId)
    await dropProgress($, e.sessionId)
    // A /clear or a resume: the process goes on under another id, in a new window. A molt's
    // own clear comes here too; its seed follows in molt()'s clear.
    if (e.reason === 'clear' || e.reason === 'resume') newWindow(e.sessionId, e.reason)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || 'skip' in r) return r
    try {
      const sessionId = await $.session.id()
      newWindow(sessionId, 'compact')
      await publishStage($, sessionId)
    } catch (err) {
      await log($, `session.compact error ${String(err)}`)
    }
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    // molt's own turn-end request: it runs only in the session that was asked, and never
    // while a molt is in flight: a seed or a clear owns that turn.
    const request = e.origin.kind === 'plugin' && e.origin.name === 'molt' ? takeRequest(asked, e.text) : undefined
    if (request !== undefined) {
      try {
        if ((await $.session.id()) !== request.sessionId || inFlight) {
          await log($, `request dropped session=${request.sessionId}`)
          return { drop: 'molt: the handoff request was dropped: the session moved on' }
        }
      } catch {}
    }
    try {
      const sessionId = await $.session.id()
      // An Agent SDK host (T3 Code) delivers the operator's message as an `sdk` prompt.
      if (e.origin.kind === 'composer' || e.origin.kind === 'bridge' || e.origin.kind === 'sdk') {
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
    // A pause shows only in the band, a toast and the status line, which an SDK host never
    // draws: the agent hears of it at every prompt it gets while paused, so it can say so.
    let pauseNote: string | undefined
    try {
      if (paused === (await $.session.id())) pauseNote = fill(PAUSED_AGENT, { reason: pausedText })
    } catch {}
    if (pauseNote !== undefined) e = { ...e, context: [...(e.context ?? []), pauseNote] }
    let hostNote: string | undefined
    try {
      const sessionId = await $.session.id()
      const r = await staleRecord($, sessionId)
      const kept = await sdkHandoff($, sessionId)
      if (r !== undefined) hostNote = staleText(r)
      else if (kept !== undefined) hostNote = fill(SDK_HANDED_OFF, { path: kept })
    } catch (err) {
      await log($, `prompt.submit stale check error ${String(err)}`)
    }
    if (hostNote !== undefined) e = { ...e, context: [...(e.context ?? []), hostNote] }
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
      await appendStatus($, fill(WARNED, { percent: warnedAt(warning.sessionId, warning.due) }))
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const args = e as unknown as Readonly<Record<string, unknown>>
    let sessionId = ''
    try {
      sessionId = await $.session.id()
      // Before every other rule, /molt off included: a stale session acts on old state.
      const r = await staleRecord($, sessionId)
      if (r !== undefined && !STALE_TOOLS.has(e.tool)) {
        await log($, `stale denied session=${sessionId} tool=${e.tool}`)
        return { deny: staleText(r) }
      }
      if (!off.has(sessionId) && !inFlight) {
        await measure($, sessionId)
        // A stale session's reads passed the stale rule above; the block does not refuse them.
        if (atLeast(stage, 'block') && r === undefined && !gateAllows(e.tool, args)) {
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
      if (isProgress(e.tool, args) && !atLeast(stage, 'warn')) {
        progress += 1
        // On disk too, so a module reloaded mid-session does not lose the count (#713).
        if (sessionId !== '') await markProgress($, sessionId)
      }
      const path = args.file_path
      // A file written while molt is off is not this session's handoff: /molt on does not
      // turn it into one (#665).
      if ((e.tool === 'Write' || e.tool === 'Edit') && typeof path === 'string' && path.endsWith('.md')
        && sessionId !== '' && !off.has(sessionId) && atLeast(stage, 'command')) lastMd.set(sessionId, path)
      // The warnings ride the tool's result as model-only context (#929: classic.PostToolUse,
      // which carried them, never runs for a plugin on an org account).
      if (sessionId !== '' && r.isError === undefined) {
        try {
          const text = await warningFor($, sessionId)
          if (text !== undefined) return { ...r, context: [...(r.context ?? []), text] }
        } catch (err) {
          await log($, `warning error ${String(err)}`)
        }
      }
    }
    return r
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
          if (window > 0) { seeded.startPercent = (input / window) * 100; await publishStage($, sessionId) }
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
      // A marker that names no readable file is asked about by its path, so the session can fix it.
      const missing = resolved !== undefined && !(await isReadableFile($, resolved)) ? resolved : undefined
      let handoff = pickHandoff(resolved, lastMd.get(sessionId))
      if (handoff !== undefined && !(await isReadableFile($, handoff.path))) {
        await log($, `handoff path missing session=${sessionId} path=${handoff.path}`)
        handoff = undefined
      }
      if (handoff === undefined) {
        // A warned session may hand off at a point it chose; nothing is asked of it yet.
        if (!atLeast(stage, 'command')) return r
        // The session still has room to write it: a follow-up turn asks, up to its cap (#929:
        // classic.Stop, which held the turn open, never runs for a plugin on an org account).
        const n = stopBlocks.get(sessionId) ?? 0
        if (!atLeast(stage, 'fallback') && n < MAX_STOP_BLOCKS) {
          // A turn that never answered (an API error, a refusal) is not asked; nor is one that
          // ends while the last request still waits its turn: one request at a time.
          if (e.reason === 'error' || e.reason === 'refusal' || waitsIn(asked, sessionId)) return r
          stopBlocks.set(sessionId, n + 1)
          await noteCommand($, sessionId)
          const text = missing === undefined ? await instruction($, sessionId) : fill(MISSING_HANDOFF, { path: missing })
          // Not awaited: the request's turn cannot start until this hook returns.
          const mine: Request = { sessionId, text }
          asked.push(mine)
          $.prompt.submit({ text }).catch(async (err: unknown) => {
            const i = asked.indexOf(mine)
            if (i >= 0) asked.splice(i, 1)
            await log($, `request failed session=${sessionId} ${String(err)}`)
          })
          return r
        }
        handoff = { path: await fallbackBrief($, sessionId), source: 'fallback' }
      }
      if (await isChild($)) await handOff($, sessionId, handoff)
      else if (await isSdkHost($)) await sdkHandOff($, sessionId, handoff)
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
      return { text: SESSION_OFF }
    }
    if (arg === 'on') {
      off.delete(sessionId)
      // The operator's word that this stale session may act: the record goes.
      if (await staleRecord($, sessionId) !== undefined) {
        try { await $.process.run(['rm', '-f', successorPath(await home($), sessionId)]) } catch (err) {
          await log($, `successor remove failed session=${sessionId} ${String(err)}`)
        }
        stale.set(sessionId, null)
        await log($, `stale guard lifted session=${sessionId}`)
      }
      await touchActive($, sessionId)
      await publishStage($, sessionId)
      showStatus($, sessionId)
      return { text: SESSION_ON }
    }
    if (arg === 'now') {
      off.delete(sessionId)
      paused = undefined
      // Lifting off (or a pause) turns the session back on here, so the marker comes back
      // here too — not at the next prompt, which a session with no prompt box never sends (#665 item 6).
      await touchActive($, sessionId)
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
    return { text: COMMAND_USAGE }
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
