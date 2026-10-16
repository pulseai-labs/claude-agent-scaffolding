// autonomic on OMP (omp 18.8.9): maps omp's extension events onto autonomic's pure modules (../hooks) so an OMP
// coordinator in autopilot gets the ask reflex, the turn-end reflex and the never-approve floor. Loaded only by
// omp-seat with -e (never ambient). It imports autonomic's own pure modules and node: builtins only; omp's host
// types are `any`, so this file imports in plain bun. Every rule, threshold, text and pain list is in ../hooks.
//
// What does not port from hooks/register.tsx, and why: the pain band and its option buttons (no band on OMP: the
// options are listed in the notice and the pain file), the permission fork (OMP seats run --approval-mode yolo,
// so no permission prompt exists; the floor is a tool_call block instead), and the hard-deny ring (a call that a
// seat guard blocks emits no tool_result, so there is nothing to observe).
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULTS, parseConfig } from '../hooks/config'
import type { AutonomicConfig } from '../hooks/config'
import { toolEntry, pushEntry, renderDigest } from '../hooks/digest'
import { enforced } from '../hooks/enforce'
import { hasMoltMarker, parseStage, parseStageCommand, stageYields, statusYields } from '../hooks/floor'
import { ledgerLine, ledgerPathFor, oneLine, redact } from '../hooks/ledger'
import type { LedgerCase } from '../hooks/ledger'
import { parseCommand, parseEnvMode, resolveDoc, statusText } from '../hooks/mode'
import { DEFAULT_READERS, floorFindings, namesDanger, neverRules } from '../hooks/never'
import type { Finding, Where } from '../hooks/never'
import { operationFacts, permissionEligibility } from '../hooks/operations'
import type { ApprovedCommand, ApprovedPermission, OperationContext, PermissionEligibility } from '../hooks/operations'
import { DEFAULT_POLICY, expandHome } from '../hooks/policy'
import { askPrompt, scopeMessage, shownInput, turnEndPrompt } from '../hooks/prompts'
import { lineagePath, logPath, modeFilePath, parseLineageFrom, parseRecord, safeSessionId, serializeRecord, sessionPath, stagePath } from '../hooks/records'
import type { SessionRecord } from '../hooks/records'
import { shape } from '../hooks/shape'
import { parseAsk, parseTurn } from '../hooks/verdict'
import type { Question } from '../hooks/verdict'
import { captureLaunchBinding } from '../hooks/authority'
import { launchWorkerRoots } from '../bin/authority'
import { PinnedAuthority, placementFacts } from './authority-store'
import type { AuthorityLease } from '../hooks/authority'
import { acceptedChoice, captureFrame, judgeNative, parsePolicyBundle } from './judgment'
import type { ConsumerHost, DecisionDraft, DecisionFrame, DecisionIO } from './judgment'
import { commitDecision } from './decision-ledger'
import { assembleAsk, holdsSecret, planAsk, snapshotAsk } from './asks'

type Live = SessionRecord & { problem?: string; invalid?: string }

// Every side effect, so a test drives the reflexes with fakes.
export type AutonomicIO = {
  pid: number
  remove(path: string): void                                 // synchronous; missing is success
  writeMode(path: string, mode: string): void                  // synchronous; creates the folder
  rename(from: string, to: string): void                      // synchronous; atomic sibling replacement
  sessionId(): string
  cwd: string
  env: Readonly<Record<string, string | undefined>>
  launchCwd?: string                                        // immutable trusted process-start cwd
  sessionFile?(): string | undefined
  setEnv(name: string, value: string | undefined): void
  readText(path: string): Promise<string | undefined>
  exists(path: string): Promise<boolean>
  writeText(path: string, text: string): Promise<void>          // creates the folder
  appendLine(path: string, line: string): Promise<boolean>      // creates the folder; false when it did not land
  touch(path: string): Promise<boolean>
  run(argv: string[]): Promise<{ exitCode: number; stdout: string }>
  // The bounded decision services (Task 4). Absent means the native decision route is unavailable:
  // a consumer must fall back to operator handling, never to the old ephemeral classifier.
  decisions?: DecisionIO
  // Read the live entry context ONCE, binding judge/generate to that exact object. Absent on hosts
  // with no captured context; the decision route is then unavailable.
  captureHost?: () => ConsumerHost
  // One side turn off the session's history. A throw or an empty reply is a failed attempt; undefined means the
  // host has no ephemeral turn, so there is nothing to judge with.
  ephemeral(prompt: string, timeoutMs: number): Promise<string | undefined>
  usage(): number | undefined                                    // ctx.getContextUsage().percent
  systemPrompt(): string | string[] | undefined
  notify(text: string): void
  status(text: string): void
  bell(command: string, message: string): Promise<void>
}

const CONFIG_PATH = '.omp/agent/autonomic.json'
const USAGE_TEXT = 'usage: /autopilot on [scope doc …] | off | status'
// tool_call and the other dispatched handlers have a 30 s budget in omp 18.8.9, and tool_call fails closed on a
// timeout. Both attempts of a judgment share one deadline inside it, so a slow model ends in a pain signal and a
// passed event, never in the host's timeout.
export const JUDGE_BUDGET_MS = 25_000
const MIN_ATTEMPT_MS = 1_000

// The deadline must not depend on the host honouring the abort signal: a turn that never settles is a failed attempt.
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no reply within ${ms} ms`)), ms)
    p.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
  })
}

// omp 18.8.9's built-in tools (the binary's tool registry, the same enumeration molt/omp/core.ts records), each
// decided once. Read-only, so a turn of these alone is no progress for the loop guard:
//   read, grep, glob, find, ast_grep, web_search, fetch, ls, ask, todo, wait, think, recall, reflect
// Everything else counts as a change: bash, write, edit, apply_patch, eval, js, python, notebook, github,
// browser, puppeteer, computer, debug, ida, task, checkpoint, rewind, context_notes, new_context, memory_edit,
// retain, learn, manage_skill, generate_image, tts, vibe_*, mcp__* and extension tools. An unknown tool is a change.
// Three tools are decided by their call (changedBy): ast_edit's own result is a preview and changes nothing (omp stages
// a pending action that a later `write xd://resolve` applies and `xd://reject` discards); lsp edits files only through
// rename and rename_file (unless apply is false) and code_actions with apply true.
const READ_ONLY = new Set(['read', 'grep', 'glob', 'find', 'ast_grep', 'web_search', 'fetch', 'ls', 'ask', 'todo', 'wait', 'think', 'recall', 'reflect'])
const RESOLUTION_DEVICE = /^\s*xd:\/\/(resolve|reject|propose)\s*$/i

// A call that confirms (`resolve`), discards (`reject`) or proposes a plan (`propose`) for a staged action: the xd:// device
// written through `write`, or omp's own tool of that name (which takes action apply | discard).
function resolutionOf(toolName: string, input: unknown): 'resolve' | 'reject' | 'propose' | undefined {
  const args = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  if (toolName === 'write') {
    const path = typeof args.path === 'string' ? args.path : typeof args.file_path === 'string' ? args.file_path : ''
    const kind = RESOLUTION_DEVICE.exec(path)?.[1]?.toLowerCase()
    return kind === 'resolve' || kind === 'reject' || kind === 'propose' ? kind : undefined
  }
  if (toolName === 'resolve') return args.action === 'discard' ? 'reject' : 'resolve'
  if (toolName === 'reject' || toolName === 'propose') return toolName
  return undefined
}

const flag = (v: unknown): boolean | undefined => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined)

// Whether a call whose result succeeded changed something.
function changedBy(toolName: string, input: unknown): boolean {
  if (toolName === 'ast_edit') return false
  const kind = resolutionOf(toolName, input)
  if (kind !== undefined) return kind === 'resolve'
  if (toolName === 'lsp') {
    const args = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
    const action = typeof args.action === 'string' ? args.action.toLowerCase() : ''
    const apply = flag(args.apply)
    if (action === 'rename' || action === 'rename_file') return apply !== false
    return action === 'code_actions' && apply === true
  }
  return !READ_ONLY.has(toolName)
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('\n')
}

// omp's ask input: { questions: [{ id, question, options: [{ label, description? }], recommended?, header?, multi? }] }
// (probe 13 Q4; the binary also reads a legacy single `question` / `options` form and options given as strings).
export function questionsOf(input: unknown): Question[] {
  const args = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const list = Array.isArray(args.questions) ? args.questions : typeof args.question === 'string' ? [args] : []
  const out: Question[] = []
  for (const q of list) {
    const text = str((q as Record<string, unknown> | null)?.question)
    if (text === undefined) continue
    const rec = q as Record<string, unknown>
    const options = (Array.isArray(rec.options) ? rec.options : [])
      .map(o => ({ label: typeof o === 'string' ? o : str((o as Record<string, unknown> | null)?.label) }))
      .filter((o): o is { label: string } => o.label !== undefined && o.label !== '')
    const header = str(rec.header)
    out.push({ question: text, ...(header === undefined ? {} : { header }), options, ...(rec.multi === true ? { multiSelect: true } : {}) })
  }
  return out
}

// A system prompt as a list of blocks: omp 18.8.9 hands the event and ctx.getSystemPrompt() a string[]; a lone string is one block.
const blocksOf = (v: unknown): string[] | undefined =>
  typeof v === 'string' ? [v] : Array.isArray(v) && v.every(b => typeof b === 'string') ? (v as string[]) : undefined

// A bash call's own `cwd`, read as omp's resolveToCwd reads it (the same reading as seat-mods/omp/extension.ts ompPlace,
// 'cwd' mode; copied, as no mod imports another): a leading `:` before a path shape and an `@` before `/abs`, `~` or a URL
// are dropped, unicode spaces become spaces, `file://` becomes its path, `~` and `~/x` are HOME, `/` alone and a relative path
// are the session folder's. A path still carrying a `scheme:/` belongs to omp's URL router: undefined.
const SCHEME = /[A-Za-z][A-Za-z0-9+.-]*:\//
export function bashCwd(raw: string, session: string, home: string): string | undefined {
  let t = /^:(?=[/\\~]|\.\.?[/\\]|[A-Za-z]:)/.test(raw) ? raw.slice(1) : raw
  if (t.startsWith('@')) { const r = t.slice(1); if (r.startsWith('/') || r === '~' || r.startsWith('~/') || SCHEME.test(r)) t = r }
  t = t.replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
  if (t.toLowerCase().startsWith('file://')) { try { t = fileURLToPath(t) } catch {} }
  if (SCHEME.test(t)) return undefined
  if (t.startsWith('~')) {
    if (!home.startsWith('/')) throw new Error('an omp ~ path needs HOME')
    const h = home.replace(/\/+$/, '') || '/'
    t = t === '~' ? h : t.startsWith('~/') || t.startsWith('~\\') ? (h === '/' ? t.slice(1) : h + t.slice(1)) : resolve(h, t.slice(1))
  }
  if (/^\/+$/.test(t)) return session
  return t.startsWith('/') ? t : resolve(session, t)
}

// omp rebinds factories for task children in the same process; only the first load clears a reused pid.
const claimedModeFiles = new Set<string>()

type Judged<T> = { v: T } | { skip: true } | { fail: string }

export function createAutonomic(io: AutonomicIO, judgeBudgetMs: number = JUDGE_BUDGET_MS) {
  // Capture before worker execution; mode records, later env and briefs never rebind this store.
  const startup = Object.freeze({ ...io.env })
  const enrolled = ['AUTONOMIC_AUTHORITY_PATH', 'AUTONOMIC_AUTHORITY_SHA256', 'AUTONOMIC_ASSIGNMENT_ID', 'AUTONOMIC_ASSIGNMENT_GENERATION', 'AUTONOMIC_LAUNCH_ID'].some(name => startup[name] !== undefined)
  let authority: PinnedAuthority
  let authorityState = enrolled ? 'unavailable' : 'legacy/manual (no grant)'
  let authorityLease: AuthorityLease | undefined
  let predecessorFile: string | undefined
  try {
    const binding = captureLaunchBinding(startup)
    authority = new PinnedAuthority(binding, binding ? launchWorkerRoots(startup, io.launchCwd ?? io.cwd) : [])
  } catch {
    authority = new PinnedAuthority(undefined, [])
    authority.invalidate()
    authorityState = 'invalid startup binding; fresh trusted launch required'
  }

  // One per-process cancellation for outstanding decision frames. A mode change, navigation,
  // shutdown, Molt transition or authority invalidation aborts it and replaces it for the next
  // frame, so no late completion can act on a session whose authority has moved.
  let frameAbort = new AbortController()
  function abortFrames(): void { frameAbort.abort(new Error('frame cancelled')); frameAbort = new AbortController() }

  // Every automatic fall to manual is a mode change. It cancels outstanding decision frames and, for
  // an enrolled session, suspends the pinned authority — the same invalidation the other points use —
  // so no frame captured before the fall can still pass its freshness check and release afterward.
  function fallToManual(rec: Live, problem: string): Live {
    if (enrolled) suspendAuthority()
    else abortFrames()
    return { ...rec, mode: 'manual', problem }
  }

  // The entry moment of the current handler, captured before any await so a decision frame gets the
  // real start of its one monotonic 25-second window. Read by the native consumers (Tasks 5–7).
  let lastEntryMs = 0

  function suspendAuthority(): void {
    if (!enrolled) return
    abortFrames()
    authority.suspend()
    authorityState = 'suspended; fresh trusted launch required'
  }
  function onSessionBeforeSwitch(): void {
    predecessorFile = io.sessionFile?.()
    suspendAuthority()
  }
  async function onSessionSwitch(): Promise<void> {
    // reason:new + predecessor file/lineage/stage do not expose Molt's private pending ownership.
    // Keep the observed predecessor, but never turn a generic new/resume into autonomous eligibility.
    if (enrolled) {
      suspendAuthority()
      io.notify(`autonomic authority: ${authorityState}${predecessorFile ? ' (observed predecessor transition)' : ''}`)
    }
    await onSessionStart()
  }
  let cfg: AutonomicConfig = DEFAULTS
  let ready: Promise<void> | undefined
  const live = new Map<string, Live>()       // each session's resolved record
  const pushes = new Map<string, number>()   // covered or stalled turn ends in a row with no change
  const changed = new Set<string>()          // sessions that changed something since their last turn end
  const announced = new Set<string>()        // sessions whose carried scope has been announced
  const pendingScope = new Set<string>()     // prepared scope, committed only at agent_start
  const digests = new Map<string, string[]>()
  const note = (id: string, entry: string): void => { digests.set(id, pushEntry(digests.get(id) ?? [], entry)) }
  const digestOf = (id: string): string => renderDigest(digests.get(id) ?? [])

  const home = (): string => io.env.HOME ?? ''
  // omp's bash helper captures the environment after extension load. The path stays fixed for this process.
  const modeFile = modeFilePath(resolve(home() || '/'), io.pid)
  io.setEnv('AUTONOMIC_MODE_FILE', modeFile)
  if (!claimedModeFiles.has(modeFile)) {
    claimedModeFiles.add(modeFile)
    try { io.remove(modeFile) } catch {} // a reused pid must not inherit a previous process's mode
  }

  function onSessionShutdown(): void {
    abortFrames()
    if (enrolled) authority.invalidate()
    try { io.remove(modeFile) } catch {}
  }

  // ~/.omp/agent/autonomic.json holds autonomic's userConfig keys; absent is DEFAULTS, unreadable is DEFAULTS plus a problem.
  const load = (): Promise<void> => (ready ??= (async () => {
    const text = await io.readText(`${home()}/${CONFIG_PATH}`)
    if (text === undefined) return
    try { cfg = parseConfig(JSON.parse(text) as Record<string, unknown>) } catch (err) {
      cfg = { ...DEFAULTS, problems: [`${CONFIG_PATH} is not valid JSON (${String(err)}); using the defaults`] }
    }
  })())

  // Best effort: a log that cannot be written never stops the step that called it.
  async function log(line: string): Promise<void> {
    try { await io.appendLine(logPath(home()), `${new Date().toISOString()} ${line}`) } catch {}
  }

  async function policyText(): Promise<string | undefined> {
    return (await io.readText(expandHome(cfg.policyPath, home())))?.trim() || undefined
  }

  async function repoRoot(): Promise<string> {
    try {
      const r = await io.run(['git', '-C', io.cwd, 'rev-parse', '--show-toplevel'])
      if (r.exitCode === 0 && r.stdout.trim() !== '') return r.stdout.trim()
    } catch {}
    return io.cwd
  }

  async function ledgerPath(): Promise<string> {
    return ledgerPathFor(io.env.AUTONOMIC_LEDGER, await repoRoot())
  }

  function bellOf(): string | undefined {
    const env = (io.env.AUTONOMIC_BELL ?? '').trim()
    return env !== '' ? env : cfg.bell
  }

  // Autopilot needs its policy and a writable ledger; without either the session is manual (spec §4).
  // An enrolled session additionally needs the native decision service; the ask and turn-end
  // consumers stay operator-owned until Tasks 6–7 ship (see askReflex/onSessionStop).
  async function guard(rec: Live): Promise<Live> {
    const clean: Live = { ...rec, problem: undefined }
    if (rec.mode !== 'autopilot') return clean
    if (enrolled && io.decisions === undefined) return fallToManual(clean, 'enrolled authority requires the native decision service')
    if ((await policyText()) === undefined) return fallToManual(clean, 'no policy')
    if (!(await io.touch(await ledgerPath()))) return fallToManual(clean, 'ledger not writable')
    return clean
  }

  // Keep the in-process/Claude signal and atomically replace the live file OMP launchers read.
  function publish(mode: Live['mode']): void {
    const say = (text: string): void => { try { io.notify(text) } catch {} }
    const temp = `${modeFile}.tmp`
    try {
      io.writeMode(temp, mode)
      io.rename(temp, modeFile)
    } catch {
      let removed = true
      try { io.remove(modeFile) } catch { removed = false }
      say(removed
        ? `autonomic: the mode file ${modeFile} could not be updated to ${mode}; it was removed, so a launcher reads manual.`
        : `autonomic: the mode file ${modeFile} could not be updated to ${mode} or removed; do not let a launcher trust it in this session.`)
    } finally {
      try { io.remove(temp) } catch {}
    }
    try { io.setEnv('AUTONOMIC_EFFECTIVE_MODE', mode) } catch {
      // A value that cannot be set is unset, so a launcher reads no stale mode.
      try { io.setEnv('AUTONOMIC_EFFECTIVE_MODE', undefined) } catch {}
      say(`autonomic: AUTONOMIC_EFFECTIVE_MODE could not be set to ${mode}; a launcher starts no child in autopilot.`)
    }
  }

  // A record that cannot be written cannot reach a molt successor: autopilot ends (spec §4), and the operator is told.
  async function save(id: string, rec: Live): Promise<Live> {
    let out = rec
    if (safeSessionId(id)) {
      try { await io.writeText(sessionPath(home(), id), serializeRecord(rec)) } catch (err) {
        await log(`record write failed session=${id} ${String(err)}`)
        out = fallToManual(rec, 'record not writable')
        io.notify(`autonomic: the session record could not be saved (${sessionPath(home(), id)}); this session is manual.`)
      }
    }
    live.set(id, out)
    publish(out.mode)
    io.status(statusText(out))
    return out
  }

  // The record for the current session: its own file, else its molt parent's (only a root has one), else the spawn's env.
  async function modeOf(): Promise<Live> {
    await load()
    const id = io.sessionId()
    const known = live.get(id)
    // The policy is read again each time: one removed mid-session ends autopilot (spec §4).
    if (known !== undefined && (known.mode !== 'autopilot' || (await policyText()) !== undefined)) return known
    if (known !== undefined) {
      const off = await save(id, fallToManual(known, 'no policy'))
      io.notify('autonomic: autopilot refused — no policy')
      return off
    }
    const h = home()
    const safe = safeSessionId(id)
    let rec: Live | undefined = safe ? parseRecord(await io.readText(sessionPath(h, id))) : undefined
    if (rec === undefined) {
      const from = safe ? parseLineageFrom(await io.readText(lineagePath(h, id))) : undefined
      const parent = from !== undefined && safeSessionId(from) ? parseRecord(await io.readText(sessionPath(h, from))) : undefined
      if (parent !== undefined) rec = { ...parent, source: 'lineage' }
    }
    if (rec === undefined) {
      const env = parseEnvMode(io.env.AUTONOMIC_MODE)
      const bell = bellOf()
      rec = { mode: env.mode, scope: [], source: 'env', ...(bell === undefined ? {} : { bell }), ...(env.invalid === undefined ? {} : { invalid: env.invalid }) }
    }
    const checked = await save(id, await guard(rec))
    if (checked.problem !== undefined) io.notify(`autonomic: autopilot refused — ${checked.problem}`)
    return checked
  }

  // One ledger line. A ledger that cannot be written ends autopilot (spec §4); the caller must not act on a
  // decision that was not recorded.
  const record = (id: string, kase: LedgerCase, q: string, a: string, why: string): Promise<boolean> =>
    recordAll(id, [ledgerLine({ time: new Date().toISOString(), session: id, kase, q, a, why })])

  async function recordAll(id: string, lines: readonly string[]): Promise<boolean> {
    if (await io.appendLine(await ledgerPath(), lines.join('\n'))) return true
    const rec = live.get(id)
    if (rec !== undefined) await save(id, fallToManual(rec, 'ledger not writable'))
    io.notify('autonomic: the ledger is not writable; this session is manual now.')
    await log(`ledger append failed session=${id}`)
    await pain(id, 'ledger not writable', `${await ledgerPath()}: autopilot is off for this session`)
    return false
  }

  // A pain signal (spec §3.4): notice, bell and the pain file a launcher may name. It never resumes the run by
  // itself. Options (a turn-end pain) are listed in the notice, the bell and the pain file, numbered; a credential
  // request is its own plain-text line after them. No band buttons on OMP.
  async function pain(id: string, reason: string, detail: string, options?: ReadonlyArray<{ label: string; text: string; recommended: boolean }>, credential?: string): Promise<void> {
    const text = `autopilot: ${reason} — ${oneLine(detail, 200)}`
    const shown = (options ?? []).map(o => ({ label: oneLine(o.label, 40), recommended: o.recommended })).sort((a, b) => Number(b.recommended) - Number(a.recommended))
    const plain = credential === undefined ? undefined : oneLine(credential, Number.MAX_SAFE_INTEGER)
    const numbered = shown.length === 0 ? text
      : `${text} · options: ${shown.map((o, i) => `${i + 1}) ${o.label}${o.recommended ? ' (Recommended)' : ''}`).join(' ')}`
    const listed = plain === undefined ? numbered : `${numbered} · in plain text: ${plain}`
    io.notify(listed)
    const bell = live.get(id)?.bell
    // The bell has its own timeout; it must not consume the event handler's budget.
    if (bell !== undefined) {
      try { void io.bell(bell, listed).catch(err => log(`bell failed ${String(err)}`)) }
      catch (err) { void log(`bell failed ${String(err)}`) }
    }
    const path = (io.env.AUTONOMIC_PAIN_PATH ?? '').trim()
    if (path !== '' && !(await io.appendLine(path, `${new Date().toISOString()} pain ${listed}`))) await log(`pain file append failed ${path}`)
    await log(`pain session=${id} ${listed}`)
  }

  // The bounded decision services (Task 4). Built once; absent (undefined) whenever this session is
  // not an enrolled assignment, so a consumer treats the native route as unavailable. It is exposed
  // for Tasks 5–7 to call; nothing here activates a consumer or the old classifier.
  const decisionIO: DecisionIO | undefined = enrolled ? {
    capture: () => {
      const host = io.captureHost?.()
      if (host === undefined) throw new Error('no captured host context')
      return host
    },
    authority,
    placement: async (input, signal) => {
      signal.throwIfAborted()
      const raw = input !== null && typeof input === 'object' && 'cwd' in input ? input.cwd : undefined
      const dir = typeof raw === 'string' && raw.trim() !== '' ? bashCwd(raw, io.cwd, home()) : io.cwd
      if (dir === undefined) throw new Error('the input cwd is not a folder the decision route can read')
      return placementFacts(dir)
    },
    policy: lease => parsePolicyBundle(lease.policyText),
    appendLine: (path, line) => io.appendLine(path, line),
    ledgerPath,
    // Manual/failure integration: publish the operator-facing failure state; never authorize action.
    fail: async (sessionId, reason) => {
      const rec = live.get(sessionId)
      if (rec !== undefined) await save(sessionId, fallToManual(rec, 'decision not recorded'))
      await pain(sessionId, 'decision failure', reason)
    },
  } : undefined
  if (decisionIO !== undefined) io.decisions = decisionIO

  // One side turn, one retry (spec §4), both inside one deadline. No ephemeral turn lets the event pass.
  async function judge<T>(kind: 'turn-end' | 'ask', prompt: string, parse: (text: string) => T | undefined): Promise<Judged<T>> {
    const deadline = Date.now() + judgeBudgetMs
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now()
      if (attempt > 0 && left < MIN_ATTEMPT_MS) break
      let text: string | undefined
      const ms = Math.max(left, MIN_ATTEMPT_MS)
      try { text = await within(io.ephemeral(prompt, ms), ms) } catch (err) {
        await log(`fork failed attempt=${attempt + 1} ${String(err)}`)
        continue
      }
      if (text === undefined) return { skip: true }
      if (text.trim() === '') { await log(`fork reply empty attempt=${attempt + 1}`); continue }
      await log(`fork ${kind} session=${io.sessionId()}`)
      const v = parse(text)
      if (v !== undefined) return { v }
      await log(`fork reply did not parse attempt=${attempt + 1}`)
    }
    return { fail: 'the fork failed twice, or its reply did not parse' }
  }

  async function writeDefaultPolicy(): Promise<void> {
    const path = expandHome(cfg.policyPath, home())
    try {
      if (!(await io.exists(path))) await io.writeText(path, DEFAULT_POLICY)
    } catch (err) {
      await log(`policy write failed ${path} ${String(err)}`)
    }
  }

  async function where(cwd: string = io.cwd): Promise<Where> {
    const out = async (argv: string[]): Promise<string | undefined> => {
      try {
        const r = await io.run(argv)
        return r.exitCode === 0 ? r.stdout.trim() || undefined : undefined
      } catch {
        return undefined
      }
    }
    const root = (await out(['git', '-C', cwd, 'rev-parse', '--show-toplevel'])) ?? cwd
    const branch = await out(['git', '-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'])
    const originHead = await out(['git', '-C', cwd, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    const w: Where = { cwd, root, home: home() }
    if (branch !== undefined && branch !== 'HEAD') w.branch = branch
    if (originHead !== undefined) w.defaultBranch = originHead.replace(/^origin\//, '')
    return w
  }

  // The pain text leads with the line that names a danger, so the notice shows what tripped.
  function painFocus(rules: readonly string[], command: string): string {
    const lines = command.split('\n').map(l => l.trim()).filter(Boolean)
    const hit = lines.find(l => namesDanger(l)) ?? lines[0] ?? command
    // The shape, never the text: no credential reaches a pain signal.
    return `${rules.join(', ')} — ${shape(hit)}${lines.length > 1 ? ` (+${lines.length - 1} more lines)` : ''}`
  }

  async function statusReport(id: string): Promise<string> {
    const rec = await modeOf()
    const policyPath = expandHome(cfg.policyPath, home())
    const painPath = (io.env.AUTONOMIC_PAIN_PATH ?? '').trim()
    const pol = await policyText()
    const stageNow = safeSessionId(id) ? parseStage(await io.readText(stagePath(home(), id))) : undefined
    const lines = [
      `${rec.mode} (source: ${rec.source})${rec.problem === undefined ? '' : ` — autopilot refused: ${rec.problem}`}`,
      ...(enrolled ? [`authority: ${authority.signal.aborted ? 'suspended; fresh trusted launch required' : authorityState}`] : []),
      `scope: ${rec.scope.length === 0 ? 'none named (what the session has read)' : rec.scope.join(', ')}`,
      `policy: ${pol === undefined ? 'missing or empty' : pol === DEFAULT_POLICY.trim() ? 'default' : 'edited'} (${policyPath})`,
      `yieldAtPercent: ${cfg.yieldAtPercent} (used only without a molt stage file) · loopMax: ${cfg.loopMax} · tailChars: ${cfg.tailChars}`,
      `never-approve: ${cfg.neverApprove.length === 0 ? "none (every command is the fork's to judge)" : cfg.neverApprove.join(' ')}`,
      `readers: ${(cfg.readers ?? DEFAULT_READERS).map(r => r.join(' ')).join('; ') || 'none'}`,
      `molt stage: ${stageNow ?? 'none'}`,
      `ledger: ${await ledgerPath()}`,
      `bell: ${rec.bell === undefined ? 'not set' : 'set'}; pain file: ${painPath === '' ? 'not set' : painPath}`,
      `pushes in a row with no change: ${pushes.get(id) ?? 0} of ${cfg.loopMax}`,
    ]
    if (rec.invalid !== undefined) lines.push(`AUTONOMIC_MODE="${rec.invalid}" is not a mode`)
    if (cfg.problems.length > 0) lines.push(`settings: ${cfg.problems.join('; ')}`)
    return lines.join('\n')
  }

  // session_start: the default policy (never overwritten), the live mode for launchers, and any config problem.
  async function onSessionStart(): Promise<void> {
    if (enrolled) {
      try {
        authorityLease = authority.lease(io.sessionId(), placementFacts(io.cwd))
        authorityState = 'eligible pinned assignment (decision activation separate)'
      } catch {
        authorityState = 'suspended; fresh trusted launch required'
        io.notify(`autonomic authority: ${authorityState}`)
      }
    }
    await load()
    await writeDefaultPolicy()
    try { publish((await modeOf()).mode) } catch (err) { await log(`session_start mode error ${String(err)}`) }
    if (cfg.problems.length > 0) io.notify(`autonomic: ${cfg.problems.join('; ')}`)
  }

  // In-file navigation/compaction abandons branch facts, never the operator's mode or scope.
  function onContextRebuild(): void {
    abortFrames()
    suspendAuthority()
    const id = io.sessionId()
    digests.delete(id)
    changed.delete(id)
    pendingScope.delete(id)
    announced.delete(id)
    pushes.delete(id)
  }

  // before_agent_start: in autopilot the policy joins the system prompt, and a carried scope is announced once.
  // omp 18.8.9 passes the prompt as a list of blocks (and wraps a string we return into one block), so the policy and the
  // scope notice are blocks of their own and omp's blocks go back byte for byte.
  async function onBeforeAgentStart(e: { systemPrompt?: string | string[] }): Promise<{ systemPrompt: string[] } | undefined> {
    const id = io.sessionId()
    pendingScope.delete(id)
    try {
      const rec = await modeOf()
      if (rec.mode !== 'autopilot') return undefined
      const policy = await policyText()
      if (policy === undefined) return undefined
      const base = blocksOf(e?.systemPrompt) ?? blocksOf(io.systemPrompt())
      if (base === undefined) return void (await log('before_agent_start carried no system prompt: the policy was not added'))
      const add: string[] = base.some(b => b.includes(policy)) ? [] : [policy]
      if (rec.scope.length > 0 && rec.source !== 'env' && !announced.has(id)) {
        const scope = scopeMessage(rec.scope)
        if (!base.some(b => b.includes(scope))) add.push(scope)
        pendingScope.add(id)
      }
      return add.length === 0 ? undefined : { systemPrompt: [...base, ...add] }
    } catch (err) {
      await log(`before_agent_start error ${String(err)}`)
      return undefined
    }
  }

  // omp emits agent_start after committing the prepared system-prompt override.
  function onAgentStart(): void {
    const id = io.sessionId()
    if (pendingScope.delete(id)) announced.add(id)
  }

  // An ask that reaches the operator is on the record as well as on the screen (Review Focus 5).
  async function askPain(id: string, question: string, why: string): Promise<void> {
    await record(id, 'pain', question, 'ask the operator', why)
    await pain(id, 'question for you', `${question} (${why})`)
  }

  // The ask reflex (spec §3.2): answer from the policy and scope, or let the operator see the question and ring.
  async function askReflex(input: unknown): Promise<{ block: true; reason: string } | undefined> {
    const questions = questionsOf(input)
    if ((await modeOf()).mode !== 'autopilot' || questions.length === 0) return undefined
    // An enrolled session answers only from a complete grounded native batch (Plan Task 6 §8): the
    // whole original ask stays displayed, and rings, on any shortfall. No conversational fallback.
    if (enrolled) return answerAsk(input)
    const id = io.sessionId()
    // A question with no options takes free text: only the operator can answer it.
    if (questions.some(q => !Array.isArray(q.options) || q.options.length === 0)) {
      await askPain(id, questions[0]?.question ?? 'a question', 'free text')
      return undefined
    }
    const j = await judge('ask', askPrompt(questions, (await policyText()) ?? '', digestOf(id)), t => parseAsk(t, questions))
    if ('v' in j && j.v.covered) {
      const { answers, reason } = j.v
      const time = new Date().toISOString()
      const lines = questions.map(q => ledgerLine({ time, session: id, kase: 'ask', q: q.question, a: answers[q.question] ?? '', why: reason }))
      if (!(await recordAll(id, lines))) return undefined
      const noteText = `autonomic answered in the operator's place, from the autopilot policy and scope: ${reason}`
      note(id, toolEntry('ask', input, { text: `autonomic answered: ${JSON.stringify(answers)}` }))
      return { block: true, reason: `autonomic answered: ${JSON.stringify(answers)} — ${noteText}` }
    }
    const why = 'v' in j ? j.v.reason : 'fail' in j ? j.fail : 'nothing to judge yet'
    await askPain(id, questions[0]?.question ?? 'a question', why)
    return undefined
  }

  // The native ask consumer (Plan Task 6 §8 Step 4): snapshot the whole batch, plan the exact-ID
  // independent questions, judge once, assemble only a complete grounded batch, record every
  // question's decision, and only then block the original ask with the single exact answer block.
  // Any exception, missing bridge/authority/route/acceptance, unplannable batch or ledger failure
  // leaves the entire original ask visible (with the existing ask-pain path) and never injects a
  // fake or partial answer.
  async function answerAsk(input: unknown): Promise<{ block: true; reason: string } | undefined> {
    const decisions = io.decisions
    if (decisions === undefined) return undefined
    const id = io.sessionId()
    let snapshot
    try { snapshot = snapshotAsk(input) } catch (err) {
      await log(`ask snapshot rejected ${String(err)}`)
      await askPain(id, questionsOf(input)[0]?.question ?? 'a question', 'a malformed ask batch')
      return undefined
    }
    // Never judge a batch in part: if redaction would hide any string the frozen batch carries (a
    // question text, option label, description or header), the whole ask stays with the operator.
    // The same shape as the permission path; the reason/pain layers apply their own redaction, so
    // no secret byte is echoed.
    if (holdsSecret(snapshot)) {
      await askPain(id, snapshot.questions[0]!.question, 'the batch holds content that redaction would hide')
      return undefined
    }
    try {
      const frame = await captureFrame(decisions, lastEntryMs, 'ask', input)
      const plan = planAsk(snapshot, frame)
      const result = await judgeNative(frame, plan.request)
      const answer = assembleAsk(plan, result, frame)
      if (answer === undefined) {
        await askPain(id, plan.snapshot.questions[0]!.question, 'the batch is not completely covered by approved evidence')
        return undefined
      }
      const draft: DecisionDraft = { outcome: 'answered', grantIds: answer.grantIds, evidenceIds: answer.evidenceIds,
        answers: result.judgment.answers as DecisionDraft['answers'], route: result.route, response: result.judgment,
        payloadSource: { kind: 'candidate', id: null }, reason: answer.reason }
      await commitDecision(decisions, frame, draft,
        plan.snapshot.questions.map(q => ({ kase: 'ask' as const, q: q.question, a: answer.answers[q.question]! })))
      frame.budget.check()
      if (!frame.lease.fresh()) return undefined
      note(id, toolEntry('ask', input, { text: `autonomic answered: ${JSON.stringify(answer.answers)}` }))
      return { block: true, reason: `autonomic answered: ${JSON.stringify(answer.answers)} — ${answer.reason}` }
    } catch (err) {
      await log(`ask decision error ${String(err)}`)
      await askPain(id, snapshot.questions[0]?.question ?? 'a question', 'the native ask decision is unavailable')
      return undefined
    }
  }

  // The one independent choice question of Step 4: statement and criteria exactly as planned.
  const PERMISSION_QUESTIONS = { permission: {
    type: 'choice' as const,
    instructions: 'Within the supplied positive task grants and bounded effects, is this routine operation covered? Never expand authority.',
    criteria: { allow: 'All effects are within supplied approved task evidence; no operator gate or red line applies.',
      ask: 'Task coverage is unclear or operator handling is required.' },
  } }

  // The never-approve floor (planner decision 7): in autopilot a match blocks the bash call and rings. A session that
  // left autopilot through a failure (ledger, record, policy) keeps the floor: under yolo, manual means no asks at all.
  // `cwd` is the bash call's own folder (omp's bash tool takes one); the command is judged where it will run. Task 5
  // adds one branch: a matched call whose effects are fully bounded by positive authority is decided (and recorded)
  // through the native judgment route, and only then does the original tool proceed.
  async function floor(command: string, from?: { tool?: 'bash' | 'github'; cwd?: unknown; input?: unknown }): Promise<{ block: true; reason: string } | undefined> {
    if (!namesDanger(command, cfg.readers)) return undefined
    const tool = from?.tool ?? 'bash'
    // From here every failure keeps the call blocked: an unneeded block costs one operator decision, a missed one a force push.
    let findings: Finding[]
    try {
      const m = await modeOf()
      if (m.mode !== 'autopilot' && m.problem === undefined) return undefined
      const raw = typeof from?.cwd === 'string' && from.cwd.trim() !== '' ? from.cwd : undefined
      const dir = raw === undefined ? io.cwd : bashCwd(raw, io.cwd, home())
      if (dir === undefined) throw new Error(`cwd ${raw} is not a folder the floor can read`)
      findings = floorFindings(command, await where(dir), cfg.readers).findings.filter(f => cfg.neverApprove.includes(f.rule))
    } catch (err) {
      await log(`floor error ${String(err)}`)
      return { block: true, reason: 'autonomic: the never-approve check failed; this call stays with the operator' }
    }
    if (findings.length === 0) return undefined
    const rules = [...new Set(findings.map(f => f.rule))]
    // An enrolled session owns a decision service; without one the call keeps the plain operator block.
    const decisions = io.decisions
    if (decisions !== undefined) {
      try {
        return await decisionFor(decisions, { tool, command, input: from?.input, findings })
      } catch (err) {
        await log(`permission decision error ${String(err)}`)
        return { block: true, reason: 'autonomic: decision unavailable or stale; this call stays with the operator' }
      }
    }
    return signalOperator(tool, command, rules)
  }
  // The plain never-approve operator path, unchanged (Plan Task 5 §7 Step 4).
  async function signalOperator(tool: 'bash' | 'github', command: string, rules: readonly string[]): Promise<{ block: true; reason: string }> {
    try {
      const id = io.sessionId()
      await record(id, 'permission', tool === 'github' ? `github pr_push: ${shape(command)}` : `Bash: ${shape(command)}`, 'ask the operator', `never-approve: ${rules.join(', ')}`)
      await pain(id, 'never-approve', painFocus(rules, command))
      note(id, toolEntry(tool, { command }, { deny: `never-approve: ${rules.join(', ')}` }))
    } catch (err) {
      await log(`floor signal error ${String(err)}`)
    }
    return { block: true, reason: `autonomic: never-approve — ${rules.join(', ')}; the operator decides` }
  }

  /**
   * The Step 4 intercepted path: capture the whole original input, bound its effects, and either
   * decide it deterministically/through one native judgment and record it before returning the
   * host's nonblocking result, or keep it with the operator. Every failure returns an explicit
   * block; a catch returning undefined here would release a yolo-blocked call.
   */
  async function decisionFor(io2: DecisionIO, call: { tool: 'bash' | 'github'; command: string; input: unknown; findings: Finding[] }): Promise<{ block: true; reason: string } | undefined> {
    const { tool, command } = call
    const captured = call.input !== undefined ? call.input : { command }
    // Never judge an input in part: if redaction would hide material text, this call stays with the operator.
    const shown = shownInput(captured)
    if (redact(shown) !== shown) return operatorBlock(tool, command, call.findings, 'the input holds content that redaction would hide')
    const frame = await captureFrame(io2, lastEntryMs, 'permission', captured)
    const ctx: OperationContext = { inputSha256: frame.inputSha256, facts: frame.facts, snapshot: frame.lease.snapshot,
      approved: frame.policy.approved.permissions as ApprovedPermission[], evidence: frame.lease.evidence,
      commands: frame.policy.approved.commands as ApprovedCommand[] }
    const facts = operationFacts(tool, captured, ctx, cfg.readers ?? DEFAULT_READERS)
    const merged: Finding[] = [...new Map([...facts.findings, ...call.findings].map(f => [`${f.rule}|${f.level}|${f.focus}`, f])).values()]
    const eligibility = permissionEligibility({ ...facts, findings: merged }, ctx)
    if (eligibility.kind === 'ask') return operatorBlock(tool, command, merged, eligibility.reason)
    let decision: 'allow' | 'ask'
    let draft: DecisionDraft
    if (eligibility.kind === 'covered') {
      decision = eligibility.decision
      draft = { outcome: decision, grantIds: eligibility.grantIds, evidenceIds: eligibility.evidenceIds, answers: {},
        route: null, response: null, payloadSource: { kind: 'deterministic', id: null }, reason: eligibility.reason }
    } else {
      const result = await judgeNative(frame, { state: nativeState(frame, facts), questions: PERMISSION_QUESTIONS })
      const answer = (result.judgment.answers as Record<string, unknown>).permission
      const choice = acceptedChoice(answer as never, frame.policy.acceptance.permission)
      decision = choice === 'allow' ? 'allow' : 'ask'
      draft = { outcome: decision, grantIds: eligibility.grantIds, evidenceIds: eligibility.evidenceIds,
        answers: { permission: answer as never }, route: result.route, response: result.judgment,
        payloadSource: { kind: 'candidate', id: null },
        reason: decision === 'allow'
          ? `native judgment and the matched grants ${eligibility.grantIds.join(', ')} agree within their evidence`
          : 'native judgment did not accept the call as covered' }
    }
    if (decision !== 'allow') return { block: true, reason: 'autonomic: the operator decides' }
    await commitDecision(io2, frame, draft, [{ kase: 'permission', q: `${tool}: ${shape(command)}`, a: 'allow original call' }])
    frame.budget.check()
    if (!frame.lease.fresh()) throw new Error('stale permission')
    return undefined // nonblocking result only; normal host executes the original tool once
  }

  // The operator-visible outcome for a call the decision route will not release: the same
  // never-approve record/pain/notice plus the deciding reason.
  async function operatorBlock(tool: 'bash' | 'github', command: string, findings: readonly Finding[], reason: string): Promise<{ block: true; reason: string }> {
    const rules = [...new Set(findings.map(f => f.rule))]
    try {
      const id = io.sessionId()
      await record(id, 'permission', tool === 'github' ? `github pr_push: ${shape(command)}` : `Bash: ${shape(command)}`, 'ask the operator', `never-approve: ${rules.join(', ')} (${reason})`)
      await pain(id, 'never-approve', painFocus(rules, command))
      note(id, toolEntry(tool, { command }, { deny: `never-approve: ${rules.join(', ')}` }))
    } catch (err) {
      await log(`floor signal error ${String(err)}`)
    }
    return { block: true, reason: `autonomic: never-approve — ${rules.join(', ')}; the operator decides` }
  }

  // The bounded native state: sanitized full input, authority identity and the normalized facts.
  function nativeState(frame: DecisionFrame, facts: ReturnType<typeof operationFacts>) {
    return { tool: facts.tool, cwd: facts.cwd, inputSha256: frame.inputSha256, inputShape: frame.inputShape,
      assignmentId: frame.lease.snapshot.assignmentId, generation: frame.lease.snapshot.generation,
      authoritySha256: frame.lease.binding.sha256, policySha256: frame.lease.policyDigest,
      effects: facts.effects.map(e => ({ operation: e.operation, argv: e.argv, cwd: e.cwd,
        force: e.force, deletion: e.deletion, noVerify: e.noVerify, merge: e.merge, trailer: e.trailer,
        targets: e.targets, unresolved: e.unresolved })),
      findings: facts.findings.map(f => ({ rule: f.rule, level: f.level })) }
  }

  async function onToolCall(e: { toolName?: string; input?: unknown }): Promise<{ block: true; reason: string } | undefined> {
    // The one monotonic decision window starts at the first line, before load/mode/authority awaits.
    lastEntryMs = performance.now()
    await load()
    if (e?.toolName === 'ask') {
      try { return await askReflex(e.input) } catch (err) { await log(`ask reflex error ${String(err)}`); return undefined }
    }
    if (e?.toolName === 'bash') {
      const input = e.input as { command?: unknown; cwd?: unknown } | undefined
      return typeof input?.command === 'string' ? floor(input.command, { cwd: input.cwd, input: e.input }) : undefined
    }
    // omp's own push tool: github pr_push with forceWithLease is a force push of the branch the call names (default: HEAD).
    if (e?.toolName === 'github') {
      const input = e.input as { op?: unknown; branch?: unknown; forceWithLease?: unknown } | undefined
      if (input?.op !== 'pr_push' || (input.forceWithLease !== true && input.forceWithLease !== 'true')) return undefined
      // Never the raw name in a command line: only a plain ref name is passed on.
      const ref = typeof input.branch === 'string' && /^[\w./-]+$/.test(input.branch) ? input.branch : 'HEAD'
      return floor(`git push --force-with-lease origin ${ref}`, { tool: 'github', input: e.input })
    }
    return undefined
  }

  // tool_result: the turn digest, and whether this turn changed anything (the loop guard's progress).
  async function onToolResult(e: { toolName?: string; input?: unknown; isError?: boolean; content?: unknown }): Promise<void> {
    try {
      const id = io.sessionId()
      const name = String(e?.toolName ?? '')
      note(id, toolEntry(name, e.input, { text: textOf(e.content), ...(e.isError === true ? { isError: true as const } : {}) }))
      if (e.isError !== true && changedBy(name, e.input)) changed.add(id)
    } catch {}
  }

  // session_stop: the turn-end reflex (spec §3.1). Yield to molt first, then the loop guard, then classify.
  async function onSessionStop(e: { last_assistant_message?: unknown; session_id?: unknown }): Promise<{ decision: 'block'; reason: string } | undefined> {
    try {
      lastEntryMs = performance.now()   // the one monotonic window starts here, before any await
      await load()
      const id = io.sessionId()
      // omp runs the handlers in extension order and molt's has already cleared the session when it molted: the event is
      // the predecessor's and the live id is the successor's. Judging it would write the predecessor's turn under the
      // successor's id and move the successor's loop count and mode.
      const own = e?.session_id
      if (typeof own === 'string' && own !== id) {
        await log(`session_stop skipped: the event is session ${own}, the live session is ${id}`)
        return undefined
      }
      if ((await modeOf()).mode !== 'autopilot') return undefined
      // An enrolled session has no conversational classification fallback (Plan Task 4 §6); the
      // native turn-end consumer arrives in Task 7, so the turn ends normally until then.
      if (enrolled) return undefined
      const m = e?.last_assistant_message
      const answer = typeof m === 'string' ? m : m !== null && typeof m === 'object' ? textOf((m as { content?: unknown }).content) : ''
      // The turn end is molt's at its handoff command: molt's stage file when it exists, else the yieldAtPercent
      // fill fallback (molt absent). The live fill is checked against the file's effective command too, so hook
      // order cannot hide a handoff that is due.
      const stageText = safeSessionId(id) ? await io.readText(stagePath(home(), id)) : undefined
      const stage = parseStage(stageText)
      const at = stage === undefined ? cfg.yieldAtPercent : stage === 'off' ? undefined : parseStageCommand(stageText)
      const fill = at === undefined ? undefined : io.usage()
      const statusPath = (io.env.MOLT_STATUS_PATH ?? '').trim()
      const status = statusPath === '' ? undefined : await io.readText(statusPath)
      if (hasMoltMarker(answer) || statusYields(status) || stageYields(stage) || (fill !== undefined && at !== undefined && fill >= at)) {
        pushes.delete(id)
        changed.delete(id)
        await record(id, 'molt', 'turn end in a molt handoff', 'let it stop', 'molt owns this turn end')
        return undefined
      }
      const n = changed.has(id) ? 0 : (pushes.get(id) ?? 0)
      changed.delete(id)
      if (n >= cfg.loopMax) {
        pushes.delete(id)
        await record(id, 'pain', 'turn end', 'ask the operator', `autopilot loop: ${n} pushes with no change`)
        await pain(id, 'autopilot loop', `${n} turn ends pushed on with no change made`)
        return undefined
      }
      const j = await judge('turn-end', turnEndPrompt(answer.slice(-cfg.tailChars), (await policyText()) ?? ''), parseTurn)
      if ('skip' in j) return undefined
      if ('fail' in j) {
        pushes.delete(id)
        await record(id, 'pain', 'turn end', 'ask the operator', j.fail)
        await pain(id, 'fork failed', j.fail)
        return undefined
      }
      const v = j.v
      if (v.case === 'covered' || v.case === 'stalled') {
        const a = v.case === 'covered' ? (v.answer ?? '') : (v.next_step ?? '')
        if (!(await record(id, v.case, v.question ?? 'turn end', a, v.reason))) return undefined
        pushes.set(id, n + 1)
        const bare = a.replace(/[.!]\s*$/, '')
        return { decision: 'block', reason: v.case === 'covered' ? `Autopilot: ${bare}. Proceed.` : `Autopilot: continue — ${bare}.` }
      }
      pushes.delete(id)
      if (v.case === 'waiting') return undefined
      if (v.case === 'done') {
        await record(id, 'done', 'turn end', 'stop', v.reason)
        io.notify(`autopilot: done — ${oneLine(v.reason, 160)}`)
        return undefined
      }
      const asked = v.credential === undefined ? v.question ?? 'turn end' : `${v.question ?? 'turn end'} · in plain text: ${v.credential}`
      await record(id, 'pain', asked, 'ask the operator', v.reason)
      await pain(id, 'pain', v.question ?? v.reason, v.options, v.credential)
      return undefined
    } catch (err) {
      await log(`session_stop error ${String(err)}`)
      return undefined
    }
  }

  // /autopilot on [scope docs] | off | status. Returns the text for the operator.
  async function onCommand(args: string): Promise<string> {
    await load()
    const id = io.sessionId()
    const c = parseCommand(args ?? '')
    if (c.kind === 'usage') return USAGE_TEXT
    if (c.kind === 'status') return statusReport(id)
    const prev = await modeOf()
    if (c.kind === 'off') {
      suspendAuthority()
      pendingScope.delete(id)
      const off = await save(id, { ...prev, mode: 'manual', source: 'command', problem: undefined, invalid: undefined })
      pushes.delete(id)
      if (off.problem === 'record not writable')
        return `autopilot is off for this session, but its record could not be saved: a molt successor may still start in autopilot. Check that ${sessionPath(home(), id)} can be written.`
      return 'autopilot is off for this session: every ask reaches you.'
    }
    const h = home()
    const scope = c.scope.map(p => resolveDoc(p, io.cwd, h))
    const missing: string[] = []
    for (const p of scope) if ((await io.readText(p)) === undefined) missing.push(p)
    if (missing.length > 0) return `autopilot stays ${prev.mode}: cannot read ${missing.join(', ')}.`
    const bell = prev.bell ?? bellOf()
    const rec = await save(id, await guard({ mode: 'autopilot', scope, source: 'command', ...(bell === undefined ? {} : { bell }) }))
    if (rec.mode !== 'autopilot') {
      const fix = rec.problem === 'no policy' ? `Write ${expandHome(cfg.policyPath, h)}.`
        : rec.problem === 'record not writable' ? `Check that ${sessionPath(h, id)} can be written.` : `Check that ${await ledgerPath()} can be written.`
      return `autopilot refused: ${rec.problem}. ${fix}`
    }
    pushes.delete(id)
    announced.delete(id)
    pendingScope.delete(id)
    if (scope.length === 0) return 'autopilot is on. The scope is what this session has already read.'
    return 'autopilot is on. The next prompt you send carries the scope.'
  }

  // Claude's composer/bridge prompt reset: OMP notices have no persistent pain band to dismiss.
  function onInput(e: { source?: string }): void {
    if (enrolled && authorityLease && !authorityLease.fresh()) suspendAuthority()
    if (e.source !== 'extension') pushes.delete(io.sessionId())
  }

  return { authority, decisions: decisionIO, abortFrames, entryMs: () => lastEntryMs, onSessionBeforeSwitch, onSessionSwitch, onSessionShutdown, onInput, onAgentStart, onContextRebuild, onSessionStart, onBeforeAgentStart, onToolCall, onToolResult, onSessionStop, onCommand }
}

// omp's real ctx behind AutonomicIO. Each handler points `cur` at the event's ctx first.
function ioFor(pi: any, cur: () => any): AutonomicIO {
  // Bind the live entry context ONCE: judge/generate are captured against that exact object, so a
  // later mutable cur() cannot attribute a result to a different context (never evaluate after await).
  const captureHost = (): ConsumerHost => {
    const c = cur()
    return {
      sessionId: c?.sessionManager?.getSessionId?.() ?? '',
      cwd: typeof c?.cwd === 'string' ? c.cwd : '',
      sessionFile: c?.sessionManager?.getSessionFile?.(),
      judge: typeof c?.judge === 'function' ? c.judge.bind(c) : undefined,
      generate: typeof c?.runEphemeralTurn === 'function' ? c.runEphemeralTurn.bind(c) : undefined,
      asyncJobs: () => (typeof c?.getAsyncJobSnapshot === 'function' ? c.getAsyncJobSnapshot() : null) as ReturnType<ConsumerHost['asyncJobs']>,
    }
  }
  return {
    pid: process.pid,
    launchCwd: process.cwd(),
    captureHost,
    sessionFile: () => cur()?.sessionManager?.getSessionFile?.(),
    remove: path => { rmSync(path, { force: true }) },
    writeMode: (path, mode) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, mode) },
    rename: (from, to) => { renameSync(from, to) },
    sessionId: () => cur().sessionManager.getSessionId(),
    get cwd() { return cur().cwd },
    env: process.env,
    setEnv: (name, value) => { if (value === undefined) delete process.env[name]; else process.env[name] = value },
    readText: async path => { try { return readFileSync(path, 'utf8') } catch { return undefined } },
    exists: async path => existsSync(path),
    writeText: async (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) },
    appendLine: async (path, line) => {
      try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${line}\n`); return true } catch { return false }
    },
    touch: async path => { try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, ''); return true } catch { return false } },
    run: argv => new Promise(resolve => {
      execFile(argv[0]!, argv.slice(1), { timeout: 10_000, encoding: 'utf8' }, (err, stdout) => {
        const code = (err as { code?: unknown } | null)?.code
        resolve({ exitCode: err === null ? 0 : typeof code === 'number' ? code : 1, stdout: String(stdout ?? '') })
      })
    }),
    ephemeral: async (prompt, timeoutMs) => {
      const run = cur().runEphemeralTurn
      if (typeof run !== 'function') return undefined
      const r = await run.call(cur(), { promptText: prompt, tools: false, signal: AbortSignal.timeout(timeoutMs) })
      return typeof r?.replyText === 'string' ? r.replyText : ''
    },
    usage: () => { const p = cur().getContextUsage?.()?.percent; return typeof p === 'number' && Number.isFinite(p) ? p : undefined },
    systemPrompt: () => { try { return blocksOf(cur().getSystemPrompt?.()) } catch { return undefined } },
    notify: text => { cur().ui?.notify?.(text, 'warning') },
    status: text => { cur().ui?.setStatus?.('autonomic', text) },
    // Nothing waits on the bell beyond 30 s.
    bell: async (command, message) => {
      await pi.exec('sh', ['-c', `AUTONOMIC_MESSAGE="$1"; export AUTONOMIC_MESSAGE; ${command}`, 'sh', message], { timeout: 30_000 })
    },
  }
}

export default function (pi: any) {
  let ctx: any
  const autonomic = createAutonomic(ioFor(pi, () => ctx))
  // Only the main session runs a reflex; a task child or an advisor (whose calls reach this instance) returns at once.
  const main = (c: any): boolean => {
    if (c?.agent?.kind !== 'main') return false
    ctx = c
    return true
  }

  pi.registerCommand('autopilot', {
    description: 'autonomic: on [scope docs] | off | status',
    handler: async (args: string, c: any) => {
      if (!main(c)) return
      c.ui?.notify?.(await autonomic.onCommand(args ?? ''), 'info')
    },
  })
  pi.on('session_shutdown', (_e: any, c: any) => main(c) ? autonomic.onSessionShutdown() : undefined)
  pi.on('session_start', (_e: any, c: any) => main(c) ? autonomic.onSessionStart() : undefined)
  pi.on('session_tree', (_e: any, c: any) => main(c) ? autonomic.onContextRebuild() : undefined)
  pi.on('session_compact', (_e: any, c: any) => main(c) ? autonomic.onContextRebuild() : undefined)
  pi.on('session_before_switch', (_e: unknown, c: unknown) => main(c) ? autonomic.onSessionBeforeSwitch() : undefined)
  pi.on('session_switch', (_e: unknown, c: unknown) => main(c) ? autonomic.onSessionSwitch() : undefined)
  pi.on('input', (e: any, c: any) => main(c) ? autonomic.onInput(e) : undefined)
  pi.on('agent_start', (_e: any, c: any) => main(c) ? autonomic.onAgentStart() : undefined)
  pi.on('before_agent_start', (e: any, c: any) => main(c) ? autonomic.onBeforeAgentStart(e) : undefined)
  pi.on('tool_call', (e: any, c: any) => main(c) ? autonomic.onToolCall(e) : undefined)
  pi.on('tool_result', (e: any, c: any) => {
    if (!main(c)) return
    // Rewind rebuilds at turn end without an event. Reset now so later retained tools keep their state.
    if (e?.toolName === 'rewind' && e.isError !== true) return autonomic.onContextRebuild()
    return autonomic.onToolResult(e)
  })
  pi.on('session_stop', (e: any, c: any) => main(c) ? autonomic.onSessionStop(e) : undefined)
}
