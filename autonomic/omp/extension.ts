// autonomic on OMP (omp 18.8.9): maps omp's extension events onto autonomic's pure modules (../hooks) so an OMP
// coordinator in autopilot gets the ask reflex, the turn-end reflex and the never-approve floor. Loaded only by
// omp-seat with -e (never ambient). It imports autonomic's own pure modules and node: builtins only; omp's host
// types are `any`, so this file imports in plain bun. Every rule, threshold, text and pain list is in ../hooks.
// 0.10.0 Task 7a: the operator-route integrity guard and the park/release key are shared there too.
//
// What does not port from hooks/register.tsx, and why: the pain band and its option buttons (no band on OMP: the
// options are listed in the notice and the pain file), the permission fork (OMP seats run --approval-mode yolo,
// so no permission prompt exists; the floor is a tool_call block instead), and the hard-deny ring (a call that a
// seat guard blocks emits no tool_result, so there is nothing to observe).
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULTS, parseConfig, retiredNote } from '../hooks/config'
import type { AutonomicConfig } from '../hooks/config'
import { invokesParkCommand, planPermission, settlePermission } from '../hooks/decide'
import type { DecideContext, PermissionVerdict, Plan } from '../hooks/decide'
import { hasMoltMarker, parseStage, parseStageCommand, stageYields, statusYields } from '../hooks/floor'
import { ledgerLine, ledgerPathFor, oneLine, redact } from '../hooks/ledger'
import type { LedgerCase, LedgerSource } from '../hooks/ledger'
import { parseCommand, parseEnvMode, resolveDoc, statusText } from '../hooks/mode'
import { DEFAULT_READERS, namesParkStore, routes } from '../hooks/never'
import type { Where } from '../hooks/never'
import { operationFacts, permissionEligibility } from '../hooks/operations'
import type { OperationContext } from '../hooks/operations'
import { PARK_ID, approve, callKey, consume, parkId, parkText, parksDir, parsePark, serializePark } from '../hooks/parks'
import type { Park } from '../hooks/parks'
import { DEFAULT_POLICY, expandHome } from '../hooks/policy'
import { MAX_INPUT, scopeMessage, shownInput } from '../hooks/prompts'
import { lineagePath, logPath, modeFilePath, parseLineageFrom, parseRecord, safeSessionId, serializeRecord, sessionPath, stagePath } from '../hooks/records'
import type { SessionRecord } from '../hooks/records'
import { shape } from '../hooks/shape'
import { parsePermission } from '../hooks/verdict'
import type { TurnCase, TurnVerdict } from '../hooks/verdict'
import { captureLaunchBinding } from '../hooks/authority'
import { launchWorkerRoots } from '../bin/authority'
import { PinnedAuthority, placementFacts } from './authority-store'
import type { AuthorityLease } from '../hooks/authority'
import { acceptedChoice, captureFrame, judgeNative, parsePolicyBundle } from './judgment'
import type { ConsumerHost, DecisionDraft, DecisionFrame, DecisionIO } from './judgment'
import { commitDecision } from './decision-ledger'
import { assembleAsk, holdsSecret, planAsk, snapshotAsk } from './asks'
import { payloadForTurn, stateHoldsSecret, turnEvidence } from './turn-end'

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
  readDir(path: string): Promise<readonly string[]>              // the park store's entries; a missing folder is empty
  writePark(path: string, text: string): Promise<void>          // folder 0700, file 0600
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
  usage(): number | undefined                                    // ctx.getContextUsage().percent
  systemPrompt(): string | string[] | undefined
  notify(text: string): void
  status(text: string): void
  bell(command: string, message: string): Promise<void>
}

const CONFIG_PATH = '.omp/agent/autonomic.json'
const USAGE_TEXT = 'usage: /autopilot on [scope doc …] | off | status | parks | approve <park> | drop <park>'
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

// One call the permission route judges (Task 6). `command` is the text a shell would run, or null
// for a tool with no command text (the routed file tools); `input` is the whole call.
export type RouteCall = { tool: string; command: string | null; cwd?: unknown; input: unknown }
type JudgePlan = Extract<Plan, { kind: 'judge' }>

export function createAutonomic(io: AutonomicIO) {
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
  // decision that was not recorded. `src` names who decided the call (spec §9); it is absent on every row
  // whose decision predates the field, so those stay byte-identical.
  const record = (id: string, kase: LedgerCase, q: string, a: string, why: string, src?: LedgerSource): Promise<boolean> =>
    recordAll(id, [ledgerLine({ time: new Date().toISOString(), session: id, kase, q, a, why, ...(src === undefined ? {} : { src }) })])

  async function recordAll(id: string, lines: readonly string[]): Promise<boolean> {
    if (await io.appendLine(await ledgerPath(), lines.join('\n'))) return true
    const rec = live.get(id)
    if (rec !== undefined) await save(id, fallToManual(rec, 'ledger not writable'))
    io.notify('autonomic: the ledger is not writable; this session is manual now.')
    await log(`ledger append failed session=${id}`)
    await pain(id, 'ledger not writable', `${await ledgerPath()}: autopilot is off for this session`)
    return false
  }

  // The complete validated option text (Plan Task 7 §9 line 1103): a 40-character one-line label and the
  // whole instruction a press submits, never cut, recommended first. One renderer, so the notice, the bell,
  // the pain file and the human row all carry the same content.
  function optionLines(options?: ReadonlyArray<{ label: string; text: string; recommended: boolean }>): string {
    return (options ?? [])
      .map(o => ({ label: oneLine(o.label, 40), text: o.text, recommended: o.recommended }))
      .sort((a, b) => Number(b.recommended) - Number(a.recommended))
      .map((o, i) => `${i + 1}) ${o.label}${o.recommended ? ' (Recommended)' : ''} — ${o.text}`)
      .join(' ')
  }

  // The pain row a press would submit, and the bound that keeps it whole: `painOptions` allows three
  // options of 300 characters, and the row carries every one of them complete, exactly as the notice does.
  function painRow(options?: ReadonlyArray<{ label: string; text: string; recommended: boolean }>): { a: string; answerMax: number } {
    const optionsText = optionLines(options)
    const a = optionsText === '' ? 'ask the operator' : `ask the operator; options: ${optionsText}`
    return { a, answerMax: a.length }
  }

  // A pain signal (spec §3.4): notice, bell and the pain file a launcher may name. It never resumes the run by
  // itself. Options (a turn-end pain) are listed in the notice, the bell and the pain file, numbered, recommended
  // first, each with its complete validated instruction text; a credential request is its own plain-text line
  // after them. No band buttons on OMP.
  async function pain(id: string, reason: string, detail: string, options?: ReadonlyArray<{ label: string; text: string; recommended: boolean }>, credential?: string): Promise<void> {
    const text = `autopilot: ${reason} — ${oneLine(detail, 200)}`
    const optionsText = optionLines(options)
    const plain = credential === undefined ? undefined : oneLine(credential, Number.MAX_SAFE_INTEGER)
    const numbered = optionsText === '' ? text : `${text} · options: ${optionsText}`
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

  async function statusReport(id: string): Promise<string> {
    const rec = await modeOf()
    const policyPath = expandHome(cfg.policyPath, home())
    const painPath = (io.env.AUTONOMIC_PAIN_PATH ?? '').trim()
    const pol = await policyText()
    const stageNow = safeSessionId(id) ? parseStage(await io.readText(stagePath(home(), id))) : undefined
    const retired = retiredNote(cfg.retired)
    const lines = [
      `${rec.mode} (source: ${rec.source})${rec.problem === undefined ? '' : ` — autopilot refused: ${rec.problem}`}`,
      ...(enrolled ? [`authority: ${authority.signal.aborted ? 'suspended; fresh trusted launch required' : authorityState}`] : []),
      `scope: ${rec.scope.length === 0 ? 'none named (what the session has read)' : rec.scope.join(', ')}`,
      `policy: ${pol === undefined ? 'missing or empty' : pol === DEFAULT_POLICY.trim() ? 'default' : 'edited'} (${policyPath})`,
      `yieldAtPercent: ${cfg.yieldAtPercent} (used only without a molt stage file) · loopMax: ${cfg.loopMax} · tailChars: ${cfg.tailChars}`,
      `never-approve: ${cfg.neverApprove.length === 0 ? "none (every command is the fork's to judge)" : cfg.neverApprove.join(' ')}`,
      ...(cfg.decidingModel === undefined ? [] : ['decidingModel applies on Claude Code only; OMP decides on the session model']),
      ...(retired === undefined ? [] : [retired]),
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

  // The operator's view of the store (call 2): one line per open park, so an id can be typed back
  // into `/autopilot approve <id>`. A used or expired approval is no open park.
  async function parksReport(): Promise<string> {
    const now = new Date().toISOString()
    const open = (await readParks())
      .filter(p => p.approval === null || (p.approval.usedAt === null && Date.parse(p.approval.expiresAt) > Date.parse(now)))
      .map(p => `${p.id} · ${p.redLine !== null ? `red line ${p.redLine}` : p.source === 'integrity' ? 'operator-only state' : 'the judge asked'} · ${p.tool}: ${oneLine(p.command, 160)} · ${p.cwd}`)
    return open.length === 0 ? 'parks: none' : `parks:\n${open.join('\n')}`
  }

  // One use, 72 hours, exactly this tool, command text and cwd (Task 3's approve/consume). The id
  // grammar is checked before it becomes a path: a mistyped id is no park, never a file elsewhere.
  async function approveCommand(id: string): Promise<string> {
    if (!PARK_ID.test(id)) return `no park ${id}`
    const text = await io.readText(parkFile(id))
    if (text === undefined) return `no park ${id}`
    let park: Park
    try { park = parsePark(text) } catch { return `no park ${id}` }
    let approved: Park
    try { approved = approve(park, new Date().toISOString()) } catch { return `park ${id} is already approved` }
    try { await io.writePark(parkFile(id), serializePark(approved)) } catch (err) {
      await log(`park approve failed ${String(err)}`)
      return `park ${id} was not approved: the store could not be written`
    }
    await record(io.sessionId(), 'operator', `park ${id}`, 'approved for one use', 'the operator approved the park', 'operator')
    return `park ${id} approved for one use.`
  }

  async function dropCommand(id: string): Promise<string> {
    if (!PARK_ID.test(id)) return `no park ${id}`
    if (!(await io.exists(parkFile(id)))) return `no park ${id}`
    io.remove(parkFile(id))
    await record(io.sessionId(), 'operator', `park ${id}`, 'dropped', 'the operator dropped the park', 'operator')
    return `park ${id} dropped.`
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

  // The display text of an operator-owned ask. Never used to judge or answer: `snapshotAsk` names a
  // well-formed batch, and a malformed or free-text one keeps a generic label (the dialog is on screen).
  function askLabel(input: unknown): string {
    try { return snapshotAsk(input).questions[0]!.question } catch {}
    const args = input !== null && typeof input === 'object' ? (input as { questions?: unknown; question?: unknown }) : {}
    const first = Array.isArray(args.questions) ? args.questions[0] : undefined
    if (first !== null && typeof first === 'object' && typeof (first as { question?: unknown }).question === 'string') return (first as { question: string }).question
    return typeof args.question === 'string' && args.question.trim() !== '' ? args.question : 'a question'
  }

  // An ask that reaches the operator is on the record as well as on the screen (Review Focus 5).
  async function askPain(id: string, question: string, why: string): Promise<void> {
    await record(id, 'pain', question, 'ask the operator', why)
    await pain(id, 'question for you', `${question} (${why})`)
  }

  // The ask reflex (spec §3.2): an enrolled session answers from a complete grounded native batch;
  // any other autopilot session leaves the whole ask with the operator (R3 — no conversational
  // classifier remains, and no ask is answered without a decision service).
  async function askReflex(input: unknown): Promise<{ block: true; reason: string } | undefined> {
    if ((await modeOf()).mode !== 'autopilot') return undefined
    if (io.decisions !== undefined) return answerAsk(input)
    // The dialog is already on screen; this records the operator-owned ask and rings.
    await askPain(io.sessionId(), askLabel(input), 'no decision service is enrolled')
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
      await askPain(id, askLabel(input), 'a malformed ask batch')
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
    // The cancellation generation this frame belongs to, bound where the frame starts:
    // `abortFrames()` aborts and replaces the controller, so reading it here is what ties the
    // frame's work to the session it was captured for (shutdown, switch, rebuild, mode fall).
    const signal = frameAbort.signal
    try {
      const frame = await captureFrame(decisions, lastEntryMs, 'ask', input, signal)
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
      return { block: true, reason: `autonomic answered: ${JSON.stringify(answer.answers)} — ${answer.reason}` }
    } catch (err) {
      await log(`ask decision error ${String(err)}`)
      // A frame cancelled with its session writes nothing late: the pain row would be attributed
      // to a dialog the session no longer owns.
      if (signal.aborted) return undefined
      await askPain(id, snapshot.questions[0]?.question ?? 'a question', 'the native ask decision is unavailable')
      return undefined
    }
  }

  // ---- the park store (Task 3's module, this host's IO) ----------------------------------------
  // OMP ships no notebook tool, so the routed file-tool set is read/write/edit (ruling 5: the
  // narrower set is a known limit, recorded in the report).
  const FILE_TOOLS: Record<string, true> = { read: true, write: true, edit: true }
  // The id grammar is the shared PARK_ID and the park key is the shared callKey (Task 7a): the
  // guards below check the imported grammar before an id becomes a path, as register.tsx does.
  const parkFile = (id: string): string => join(parksDir(io.env, home()), `${id}.json`)

  // The whole store, read before every decision so an approval the operator just wrote is seen. A
  // file that does not parse is ignored and logged, never matched (Task 3 step 3).
  async function readParks(): Promise<Park[]> {
    const dir = parksDir(io.env, home())
    const out: Park[] = []
    for (const name of await io.readDir(dir)) {
      if (!name.endsWith('.json')) continue
      const text = await io.readText(join(dir, name))
      if (text === undefined) continue
      try { out.push(parsePark(text)) } catch (err) { await log(`park ${name} ignored: ${String(err)}`) }
    }
    return out
  }

  // The operator-facing name of a call in a row or a listing: a command's shape, or another tool's
  // key set — never a value, so no credential can reach notice, ledger or pain.
  function parkQuery(call: RouteCall): string {
    if (call.command === null) return `${call.tool}: ${oneLine(shape(callKey(call)), 160)}`
    return `${call.tool === 'github' ? 'github pr_push' : 'Bash'}: ${shape(call.command)}`
  }

  // A stop that is recorded and rings, with the park file the operator approves. The reason and the
  // pain carry the shape, never the command text; the park file itself must hold the exact call, or
  // the approval could not match it.
  async function parkFor(req: { source: Park['source']; redLine: Park['redLine']; reason: string }, call: RouteCall, dir: string): Promise<{ block: true; reason: string }> {
    const session = io.sessionId()
    const parkedAt = new Date().toISOString()
    const command = callKey(call)
    const park: Park = { id: parkId({ session, tool: call.tool, command, cwd: dir, parkedAt }), session,
      host: 'omp', tool: call.tool, command, cwd: dir, source: req.source, redLine: req.redLine,
      reason: req.reason, parkedAt, approval: null }
    let stored = true
    try { await io.writePark(parkFile(park.id), serializePark(park)) } catch (err) { stored = false; await log(`park write failed ${String(err)}`) }
    await record(session, 'permission', parkQuery(call), 'parked for the operator', req.reason, req.source)
    await pain(session, 'parked', `${shape(command)} — ${oneLine(req.reason, 120)}`)
    return { block: true, reason: stored ? parkText(park) : 'autonomic: parked for the operator, but the park store could not be written; this call stays with the operator' }
  }

  // The operator's approval, spent before the call runs: the row goes in first, then the write-back
  // marks it used, so a second run of the same call parks again. A row the ledger cannot record is
  // not a release, and the park stays unused (spec §4, "no ledger, no autopilot"), as on Claude Code.
  async function releaseApproved(p: Park, call: RouteCall): Promise<{ block: true; reason: string } | undefined> {
    if (!(await record(io.sessionId(), 'permission', parkQuery(call), "released by the operator's approved park", `park ${p.id} approved for one use`, 'operator')))
      return { block: true, reason: 'autonomic: the release could not be recorded; this call stays with the operator' }
    try { await io.writePark(parkFile(p.id), serializePark(consume(p, new Date().toISOString()))) } catch (err) {
      await log(`park consume failed ${String(err)}`)
      return { block: true, reason: `autonomic: approved park ${p.id} could not be marked used; this call stays with the operator` }
    }
    return undefined
  }

  // The whole input must survive redaction and the shown-input bound before a judge sees it: an
  // unseen suffix is never sent to judgment and never released.
  function inputRefusal(input: unknown): string | null {
    const shown = shownInput(input)
    if (shown.length > MAX_INPUT) return 'the input exceeds the 64,000-code-unit shown-input bound'
    if (redact(shown) !== shown) return 'the input holds content that redaction would hide'
    return null
  }

  // One isolated, tool-free side turn (call 5): no transcript, no tools, the session's own model.
  // An unreachable host or an unparseable reply settles into a park, never into a release.
  async function oneSideTurn(promptText: string, signal: AbortSignal): Promise<PermissionVerdict | undefined> {
    const host = io.captureHost?.()
    if (host?.generate === undefined) throw new Error('the host exposes no isolated side turn')
    const r = await host.generate({ tools: false, isolated: true, dedupeReply: false, signal, promptText })
    return parsePermission(typeof r?.replyText === 'string' ? r.replyText : '')
  }

  /**
   * The one permission route every routed call takes (Plan Task 6 §3): the mode gate first, so a
   * manual session is byte-for-byte 0.9.1; then the shared plan (an approved park releases, an
   * enabled floor finding parks, the integrity guard parks, no route passes); else the judged lane
   * — the grant-bounded one for an enrolled command, the side turn otherwise. A routed call never
   * falls through unanswered: from the mode gate on, every failure keeps it with the operator.
   */
  async function route(call: RouteCall): Promise<{ block: true; reason: string } | undefined> {
    // The operator's own route needs no routing word to reach its guard (Task 7a): the pre-check
    // proceeds for it too, so the shared integrity park is what stops it. The whole input is
    // passed (a bash cwd in the park store is read here, R1), and a synthesized command rides
    // beside its own fields rather than replacing them.
    const routed = call.command === null ? call.input
      : call.input !== null && typeof call.input === 'object' ? { ...call.input, command: call.command }
      : { command: call.command }
    if (invokesParkCommand({ tool: call.tool, input: call.input, command: call.command }) === null &&
        !routes({ tool: call.tool, input: routed, cwd: typeof call.cwd === 'string' ? call.cwd : undefined }, cfg.readers)) return undefined
    try {
      const m = await modeOf()
      if (m.mode !== 'autopilot' && m.problem === undefined) return undefined
      const raw = typeof call.cwd === 'string' && call.cwd.trim() !== '' ? call.cwd : undefined
      const dir = raw === undefined ? io.cwd : bashCwd(raw, io.cwd, home())
      if (dir === undefined) throw new Error(`cwd ${raw} is not a folder the floor can read`)
      const at = await where(dir)
      const parks = await readParks()
      const now = new Date().toISOString()
      const plan = planPermission({ tool: call.tool, input: call.input, command: call.command, cwd: dir, where: at },
        { policy: (await policyText()) ?? '', recent: '', role: authorityLease?.snapshot.seat.role ?? null,
          grants: authorityLease?.snapshot.grants ?? null, parks, now, enabled: cfg.neverApprove })
      if (plan.kind === 'pass') return undefined
      if (plan.kind === 'release') return await releaseApproved(plan.park, call)
      if (plan.kind === 'park') return await parkFor({ source: plan.source, redLine: plan.redLine, reason: plan.reason }, call, dir)
      // A judge plan for a command in an enrolled session is the grant-bounded lane; every other
      // judge plan (an unenrolled session, or a file tool) is one side turn.
      return io.decisions !== undefined && call.command !== null
        ? await decisionFor(io.decisions, call, plan, dir, frameAbort.signal)
        : await judgeDirect(call, plan, dir, frameAbort.signal)
    } catch (err) {
      await log(`permission route error ${String(err)}`)
      return { block: true, reason: 'autonomic: the never-approve check failed; this call stays with the operator' }
    }
  }

  // Unenrolled sessions, and every non-command (file-tool) call: the judge's plan is answered by
  // one side turn, settled by the shared rule, and either released (recorded) or parked.
  async function judgeDirect(call: RouteCall, plan: JudgePlan, dir: string, signal: AbortSignal): Promise<{ block: true; reason: string } | undefined> {
    const refusal = inputRefusal(call.input)
    if (refusal !== null) return await parkFor({ source: 'judge', redLine: null, reason: refusal }, call, dir)
    let verdict: PermissionVerdict | undefined
    try { verdict = await oneSideTurn(plan.prompt, signal) }
    catch (err) { await log(`permission judge error ${String(err)}`) }
    const settled = settlePermission(verdict)
    if (settled.kind !== 'allow') return await parkFor({ source: 'judge', redLine: settled.redLine, reason: settled.reason }, call, dir)
    // A judgment the ledger cannot record is not taken (spec §4), as on Claude Code.
    if (!(await record(io.sessionId(), 'permission', parkQuery(call), 'allow', settled.reason, 'judge')))
      return { block: true, reason: 'autonomic: the allow could not be recorded; this call stays with the operator' }
    return undefined
  }

  /**
   * The enrolled, command lane: capture the whole input, bound its effects, and either decide it
   * deterministically (an exact approved decision), through the one side turn inside the matched
   * grant bound, or keep it with the operator. Every failure parks or throws to the route's catch;
   * a return of undefined is a release, and the host then runs the original tool once.
   */
  async function decisionFor(io2: DecisionIO, call: RouteCall, plan: JudgePlan, dir: string, signal: AbortSignal): Promise<{ block: true; reason: string } | undefined> {
    const refusal = inputRefusal(call.input)
    if (refusal !== null) return await parkFor({ source: 'judge', redLine: null, reason: refusal }, call, dir)
    const captured = call.input !== undefined ? call.input : { command: call.command }
    const frame = await captureFrame(io2, lastEntryMs, 'permission', captured, signal)
    const ctx: OperationContext = { inputSha256: frame.inputSha256, facts: frame.facts, snapshot: frame.lease.snapshot,
      approved: frame.policy.approved.permissions as ApprovedPermission[], evidence: frame.lease.evidence,
      commands: frame.policy.approved.commands as ApprovedCommand[] }
    const facts = operationFacts(call.tool, captured, ctx, cfg.readers ?? DEFAULT_READERS)
    const eligibility = permissionEligibility(facts, ctx)
    if (eligibility.kind === 'ask') return await parkFor({ source: 'judge', redLine: null, reason: eligibility.reason }, call, dir)
    let draft: DecisionDraft
    let src: LedgerSource = 'grant'
    if (eligibility.kind === 'covered') {
      draft = { outcome: eligibility.decision, grantIds: eligibility.grantIds, evidenceIds: eligibility.evidenceIds, answers: {},
        route: null, response: null, payloadSource: { kind: 'deterministic', id: null }, reason: eligibility.reason }
    } else {
      let verdict: PermissionVerdict | undefined
      try { verdict = await frame.budget.run('generation', s => oneSideTurn(plan.prompt, s)) }
      catch (err) { await log(`permission judge error ${String(err)}`) }
      const settled = settlePermission(verdict)
      if (settled.kind !== 'allow') return await parkFor({ source: 'judge', redLine: settled.redLine, reason: settled.reason }, call, dir)
      src = 'judge'
      draft = { outcome: 'allow', grantIds: eligibility.grantIds, evidenceIds: eligibility.evidenceIds, answers: {},
        route: null, response: null, payloadSource: { kind: 'generation', id: null }, reason: settled.reason }
    }
    // A deterministic approved decision may itself be an ask: that is an operator stop like any
    // other, and it parks with the reason the covered rule gives.
    if (draft.outcome !== 'allow') return await parkFor({ source: 'judge', redLine: null, reason: eligibility.kind === 'covered' ? eligibility.reason : '' }, call, dir)
    await commitDecision(io2, frame, draft, [{ kase: 'permission', q: parkQuery(call), a: 'allow original call', src }])
    frame.budget.check()
    if (!frame.lease.fresh()) throw new Error('stale permission')
    return undefined
  }

  async function onToolCall(e: { toolName?: string; input?: unknown }): Promise<{ block: true; reason: string } | undefined> {
    // The one monotonic decision window starts at the first line, before load/mode/authority awaits.
    lastEntryMs = performance.now()
    await load()
    if (e?.toolName === 'ask') {
      // The integrity guard covers every tool call's whole input (ruling 2), the ask reflex
      // included: a dialog that names the park store is parked first; everything else reaches the
      // reflex exactly as today.
      if (namesParkStore(e.input, io.cwd)) {
        const blocked = await route({ tool: 'ask', command: null, input: e.input })
        if (blocked !== undefined) return blocked
      }
      try { return await askReflex(e.input) } catch (err) { await log(`ask reflex error ${String(err)}`); return undefined }
    }
    if (e?.toolName === 'bash') {
      const input = e.input as { command?: unknown; cwd?: unknown } | undefined
      return typeof input?.command === 'string' ? route({ tool: 'bash', command: input.command, cwd: input.cwd, input: e.input }) : undefined
    }
    // omp's own push tool: github pr_push with forceWithLease is a force push of the branch the call names (default: HEAD).
    if (e?.toolName === 'github') {
      const input = e.input as { op?: unknown; branch?: unknown; forceWithLease?: unknown } | undefined
      if (input?.op !== 'pr_push' || (input.forceWithLease !== true && input.forceWithLease !== 'true')) return undefined
      // Never the raw name in a command line: only a plain ref name is passed on.
      const ref = typeof input.branch === 'string' && /^[\w./-]+$/.test(input.branch) ? input.branch : 'HEAD'
      return route({ tool: 'github', command: `git push --force-with-lease origin ${ref}`, input: e.input })
    }
    // The routed file tools (ruling 5): no command text, so their plan is the integrity guard or
    // the judge, and their park is keyed on the call's exact input JSON.
    if (typeof e?.toolName === 'string' && FILE_TOOLS[e.toolName] === true) return route({ tool: e.toolName, command: null, input: e.input })
    // A call that invokes the operator's /autopilot approve|drop route (Task 7a): the shared
    // integrity rule's lane, whatever tool carries the shape.
    const invoking = { tool: String(e?.toolName ?? ''), input: e?.input, command: null }
    if (invokesParkCommand(invoking) !== null) return route(invoking)
    // Every other tool (notebook, apply_patch, ast_edit, eval, js, python, debug, an MCP tool) is
    // outside today's permission lanes: the integrity check only (ruling 2). A call whose whole
    // input names the park store parks; every other call returns exactly what 0.9.1 returned, so
    // routing words in its input never send it to the judge.
    if (typeof e?.toolName === 'string' && namesParkStore(e.input, io.cwd)) return route({ tool: e.toolName, command: null, input: e.input })
    return undefined
  }

  // tool_result: whether this turn changed anything (the loop guard's progress).
  async function onToolResult(e: { toolName?: string; input?: unknown; isError?: boolean; content?: unknown }): Promise<void> {
    try {
      const id = io.sessionId()
      const name = String(e?.toolName ?? '')
      if (e.isError !== true && changedBy(name, e.input)) changed.add(id)
    } catch {}
  }

  // The one classification question (Plan Task 7 §9 Step 3): exactly five labels, judged once
  // against the bounded state, with the operator-owned acceptance rule. Never a joint planner.
  const TURN_QUESTIONS = { turn_end: {
    type: 'choice' as const,
    instructions: 'Classify this bounded turn end without granting authority or inventing payloads.',
    criteria: {
      covered: 'An already-decided routine choice can continue within supplied task authority.',
      stalled: 'An approved remaining step exists and work stopped without a valid wait or operator gate.',
      waiting: 'Real armed work or verified Molt handoff requires no continuation.',
      done: 'Approved objective completion is evidenced; no acceptance or release approval is implied.',
      pain: 'Operator decision, missing evidence/authority, credentials, approval gate or other unsafe ambiguity.',
    },
  } }

  // The hosted turn-end consumer (Plan Task 7 §9 Steps 3–5): freeze the bounded state, classify once
  // through the native bridge, render an exact candidate or one isolated generation, validate the
  // payload against the approved records, record both rows, re-check time and freshness, and only
  // then move the loop and return the continuation. Any shortfall leaves the operator the stop.
  async function decideTurnEnd(id: string, answer: string, n: number, turn: { changed: boolean; stage: string | null; handoff: boolean }): Promise<{ decision: 'block'; reason: string } | undefined> {
    const decisions = io.decisions
    if (decisions === undefined) return undefined
    let frame: DecisionFrame | undefined
    const signal = frameAbort.signal
    try {
      frame = await captureFrame(decisions, lastEntryMs, 'turn-end', { lastReply: answer.slice(-cfg.tailChars) }, signal)
      const state = turnEvidence(frame, answer.slice(-cfg.tailChars),
        { pushes: n, changed: turn.changed, loopMax: cfg.loopMax }, { stage: turn.stage, handoff: turn.handoff })
      // Every string the state would send native or generation must survive redaction unchanged.
      if (stateHoldsSecret(state)) return void (await turnPain(id, 'turn end', 'the turn state holds content that redaction would hide'))
      const result = await judgeNative(frame, { state: state as unknown as Readonly<Record<string, unknown>>, questions: TURN_QUESTIONS })
      const accepted = acceptedChoice((result.judgment.answers as Record<string, unknown>).turn_end as never, frame.policy.acceptance['turn-end'])
      if (accepted === undefined) return void (await turnPain(id, 'turn end', 'the native classification was not accepted'))
      const rendered = await payloadForTurn(frame, accepted as TurnCase, state)
      if (rendered === undefined) return void (await turnPain(id, 'turn end', `no grounded ${accepted} payload could be validated`))
      const verdict = rendered.verdict
      await commitTurn(frame, rendered, id, verdict)
      frame.budget.check()
      if (!frame.lease.fresh()) {
        pushes.delete(id)
        await turnPain(id, 'turn end', 'authority changed before the turn could continue')
        return undefined
      }
      return applyTurn(id, n, verdict)
    } catch (err) {
      await log(`turn-end decision error ${String(err)}`)
      if (frame !== undefined) {
        try { frame.budget.cancel() } catch {}
      }
      pushes.delete(id)
      // A frame cancelled with its session writes nothing late: the turn end belongs to a session
      // that has ended, switched or rebuilt.
      if (signal.aborted) return undefined
      await turnPain(id, 'turn end', 'the native turn-end decision is unavailable')
      return undefined
    }
  }

  // The operator-facing escalation for a turn end that could not be groundedly decided.
  async function turnPain(id: string, q: string, why: string): Promise<void> {
    await record(id, 'pain', q, 'ask the operator', why)
    await pain(id, 'pain', why)
  }

  // Both records, then the loop/progress move. `waiting` uses the existing `operator` human case with
  // the exact planned text and the JSONL outcome `waiting`; nothing outside this branch continues.
  async function commitTurn(frame: DecisionFrame, rendered: { verdict: TurnVerdict; source: DecisionDraft['payloadSource'] }, id: string, verdict: TurnVerdict): Promise<void> {
    const decisions = io.decisions!
    const draft: DecisionDraft = { outcome: verdict.case === 'covered' || verdict.case === 'stalled' ? 'continue'
        : verdict.case === 'waiting' ? 'waiting' : verdict.case === 'done' ? 'done' : 'pain',
      grantIds: frame.policy.approved.remainingSteps.filter(s => s.text === (verdict.answer ?? verdict.next_step)).flatMap(s => s.grantIds),
      evidenceIds: frame.lease.evidence.filter(e => verdict.reason.includes(e.ref.id)).map(e => e.ref.id),
      answers: {}, route: null, response: null, payloadSource: rendered.source, reason: verdict.reason }
    const rows = verdict.case === 'waiting'
      ? [{ kase: 'operator' as const, q: 'turn end', a: 'waiting; no continuation' }]
      : [verdict.case === 'pain'
        // A pain row carries the complete validated option content, exactly as the notice and pain file
        // do, so its own row bound is the content's own length rather than the default clamp.
        ? { kase: 'pain' as const, q: verdict.question ?? 'turn end', ...painRow(verdict.options) }
        : { kase: verdict.case, q: verdict.question ?? 'turn end', a: verdict.answer ?? verdict.next_step ?? 'stop' }]
    await commitDecision(decisions, frame, draft, rows)
    void id
  }

  // The loop/progress move and the continuation text, only after both records landed.
  function applyTurn(id: string, n: number, verdict: TurnVerdict): { decision: 'block'; reason: string } | undefined {
    if (verdict.case === 'covered' || verdict.case === 'stalled') {
      const a = (verdict.answer ?? verdict.next_step ?? '').replace(/[.!]\s*$/, '')
      pushes.set(id, n + 1)
      return { decision: 'block', reason: verdict.case === 'covered' ? `Autopilot: ${a}. Proceed.` : `Autopilot: continue — ${a}.` }
    }
    pushes.delete(id)
    if (verdict.case === 'done') io.notify(`autopilot: done — ${oneLine(verdict.reason, 160)}`)
    if (verdict.case === 'pain') void pain(id, 'pain', verdict.question ?? verdict.reason, verdict.options, verdict.credential)
    return undefined
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
      const m = e?.last_assistant_message
      const answer = typeof m === 'string' ? m : m !== null && typeof m === 'object' ? textOf((m as { content?: unknown }).content) : ''
      // The turn end is molt's at its handoff command: molt's stage file when it exists, else the yieldAtPercent
      // fill fallback (molt absent). The live fill is checked against the file's effective command too, so hook
      // order cannot hide a handoff that is due. Molt outranks the decision route (Plan Task 7 §9 Step 3).
      const stageText = safeSessionId(id) ? await io.readText(stagePath(home(), id)) : undefined
      const stage = parseStage(stageText)
      const at = stage === undefined ? cfg.yieldAtPercent : stage === 'off' ? undefined : parseStageCommand(stageText)
      const fill = at === undefined ? undefined : io.usage()
      const statusPath = (io.env.MOLT_STATUS_PATH ?? '').trim()
      const status = statusPath === '' ? undefined : await io.readText(statusPath)
      const handoff = hasMoltMarker(answer) || statusYields(status) || stageYields(stage) || (fill !== undefined && at !== undefined && fill >= at)
      if (handoff) {
        pushes.delete(id)
        changed.delete(id)
        await record(id, 'molt', 'turn end in a molt handoff', 'let it stop', 'molt owns this turn end')
        return undefined
      }
      // The loop guard is deterministic and outranks classification (Plan Task 7 §9 Step 3).
      const changedNow = changed.has(id)
      const n = changedNow ? 0 : (pushes.get(id) ?? 0)
      changed.delete(id)
      if (n >= cfg.loopMax) {
        pushes.delete(id)
        await record(id, 'pain', 'turn end', 'ask the operator', `autopilot loop: ${n} pushes with no change`)
        await pain(id, 'autopilot loop', `${n} turn ends pushed on with no change made`)
        return undefined
      }
      // No decision service means no classification, no generation and no continuation: the turn end
      // is operator-owned (R3). There is no conversational fallback left.
      if (io.decisions === undefined) return undefined
      // The state the classifier judges carries the facts this handler just measured — the change
      // mark and the live molt stage — never a hardcoded false/no-stage pair.
      return await decideTurnEnd(id, answer, n, { changed: changedNow, stage: stage ?? null, handoff })
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
    if (c.kind === 'parks') return await parksReport()
    if (c.kind === 'approve') return await approveCommand(c.id)
    if (c.kind === 'drop') return await dropCommand(c.id)
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
    if (c.kind !== 'on') return USAGE_TEXT
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
    readDir: async path => { try { return readdirSync(path) } catch { return [] } },
    writePark: async (path, text) => { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, text, { mode: 0o600 }) },
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
