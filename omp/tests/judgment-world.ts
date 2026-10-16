// The decision-transaction fixture (Plan Task 4 §6). It is implemented here and consumed by
// Tasks 5–8, never left as a declaration in product code. It drives the real factory
// (`createAutonomic`, the module the default OMP export wires to pi.on) so the lifecycle handlers
// and the exposed `decisions` service share ONE PinnedAuthority — a mode change, navigation,
// switch or shutdown then really invalidates outstanding frames. Real mode/policy/ledger/snapshot
// files and the real Task 3 issuer build the startup binding; the local Git repository is
// synthetic and no network/git mutation is performed. Every SDK/host import is `import type`: the
// CSA tree has no installed host package, so a value import would not resolve under plain bun.
import type { ExtensionContext, ExtensionJudge } from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types'
import type { AsyncJobSnapshot } from '@oh-my-pi/pi-coding-agent/session/agent-session-types'
import type { JudgmentRequest, Usage } from '@oh-my-pi/pi-ai'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { issueAuthority } from '../../autonomic/bin/authority'
import { placementFacts } from '../../autonomic/omp/authority-store'
import type { EvidenceMaterial, Grant, Snapshot } from '../../autonomic/hooks/authority'
import { createAutonomic } from '../../autonomic/omp/extension'
import type { AutonomicIO } from '../../autonomic/omp/extension'
import { DEFAULT_POLICY } from '../../autonomic/hooks/policy'
import { parsePolicyBundle } from '../../autonomic/omp/judgment'
import type { ConsumerHost, DecisionIO, PolicyBundle } from '../../autonomic/omp/judgment'

// SEAT_MODS_ROLE is read by PinnedAuthority at construction; the fixture pins seat.role to
// 'implementer', so an ambient guard role would fail every load. Neutralize before each test and
// restore exactly after the file's tests.
const ambientSeatRole = process.env.SEAT_MODS_ROLE
export function neutralizeSeatRole(): void { delete process.env.SEAT_MODS_ROLE }
export function restoreSeatRole(): void {
  if (ambientSeatRole === undefined) delete process.env.SEAT_MODS_ROLE; else process.env.SEAT_MODS_ROLE = ambientSeatRole
}

export function fixtureUsage(input: number, output: number): Usage {
  // Synthetic fixture values, never a provider cost claim.
  return { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
}

const TEMPLATE_REPO = '/fixture/repo'
const TEMPLATE_TREE = '/fixture/tree'
const TEMPLATE_REF = 'refs/heads/fixture'
const digest = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex')
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))

// A synthetic, version-1 effective-policy file. Its `text` and acceptance values are fixture
// boundaries, never a deployed cutoff or real calibration label.
export function fixturePolicy(): PolicyBundle {
  const text = 'Synthetic fixture policy: no action without its named task grant; all operator gates remain.'
  const calibration = 'Synthetic endpoint fixture calibration; not deployment evidence.'
  const ref = { id: 'fixture-calibration', source: join(tmpdir(), 'fixture-operator-event'),
    sha256: digest(calibration), locator: 'fixture:calibration' }
  const choice = { minProbability: 1, minConfidence: 1 }
  const noul = { minYes: 1, minNo: 1 }
  return { version: 1, text, acceptance: { permission: { ...choice }, 'ask.coverage': { ...noul },
    'ask.selection': { ...choice }, 'ask.membership': { ...noul }, 'turn-end': { ...choice } },
    routes: [{ api: 'openrouter-decisions', provider: 'openrouter', model: 'fixture-selected', calibrationRef: ref.id }],
    evidence: [{ ref, text: calibration }],
    approved: { commands: [], permissions: [], questions: [], turns: [], remainingSteps: [] } }
}

export type RoutingWorld = {
  root: string; tree: string; authorityPath: string; ledgerPath: string; painPath: string
  // Task 7: each pinned material's real ref (exact id/source/sha256), keyed by ID.
  materials: Record<string, EvidenceMaterial['ref']>
  readonly decisions: DecisionIO
  handlers: Map<string, (event: any, ctx: any) => Promise<any> | any>
  ctx: any; notices: string[]; nativeRequests: JudgmentRequest[]; generationRequests: unknown[]
  entryMs: () => number
  invoke: (toolName: string, input: unknown) => Promise<{ block: true; reason: string } | undefined>
  stop: (reply: string) => Promise<{ decision: 'block'; reason: string } | undefined>
  setNative: (run: ExtensionJudge) => void
  setGeneration: (run: NonNullable<ExtensionContext['runEphemeralTurn']>) => void
  revoke: () => void; replace: () => void
  switchTo: (id: string, reason: 'new' | 'resume' | 'fork') => Promise<void>
  // Task 7: the host's async-job snapshot, read by the turn-end state builder. Null means the host
  // exposes none; a running entry is real armed work.
  setJobs: (snapshot: AsyncJobSnapshot | null) => void
  // E3/E4/E5 (Plan Task 5 Step 5): an append fault injector owned by the fixture's own
  // io.appendLine, the ordered multi-extension dispatch, and a pain-file reader.
  armAppend: (hook: ((path: string, line: string) => void | Promise<void>) | undefined) => void
  registerOrdered: (factory: (pi: unknown) => void) => void
  // The fixture's own real Autonomic tool_call handler, without building a second PinnedAuthority
  // (a second factory would read the ambient SEAT_MODS_ALLOW and refuse the fixture worktree).
  orderedAutonomic: () => void
  dispatch: (toolName: string, input: unknown) => Promise<{ block: boolean; reason?: string; receipt: number; order: string[] }>
  order: string[]
  painLines: () => string[]
  // Write the fixture home's ~/.omp/agent/autonomic.json before session_start, so the real
  // config load reads it (the load is lazy and session_start is the first caller).
  writeConfig: (config: Record<string, unknown>) => void
  // E2/negative-world helpers: a fixture-local remote and an origin/HEAD mapping, no network.
  addRemote: (name: string, url: string) => void
  setRemoteHead: (name: string, ref: string) => void
  branchRef: () => string
  close: () => void
}

/** Build a real transaction world: real temp files, real issuer, the real factory and lifecycle. */
export function routingWorld(options: { grants: Grant[]; policy: PolicyBundle; branch?: string; mode?: 'manual' | 'autopilot';
  // Task 7: extra trusted evidence the policy's approved records may cite. Each entry becomes real
  // launch material with its own digest, and its ref is returned in `materials` so a test can cite
  // an exact ID/source/sha256 without re-deriving it.
  extraMaterials?: Array<{ id: string; text: string }> }): RoutingWorld {
  const root = mkdtempSync(join(tmpdir(), 'judgment-world-'))
  const tree = join(root, 'tree'), out = join(root, 'out'), trusted = join(root, 'trusted'), authority = join(root, 'authority'), home = join(root, 'home')
  for (const p of [tree, out, trusted, authority, home]) mkdirSync(p, { recursive: true })
  const branch = options.branch ?? 'fixture'
  git(tree, 'init', '-b', branch)
  git(tree, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '--allow-empty', '-m', 'synthetic fixture')
  // E2 (Plan Task 5 §7): the requested branch is a real ref, so a push grant always has a source.
  git(tree, 'rev-parse', '--verify', `refs/heads/${branch}`)

  const workerRoots = [tree, out]
  // Rewrite the plan's template repository/paths/refs into this fixture's temp roots BEFORE issuance.
  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (value === TEMPLATE_REPO || value === TEMPLATE_TREE) return tree
      if (value.startsWith(`${TEMPLATE_TREE}/`)) return tree + value.slice(TEMPLATE_TREE.length)
      if (value === TEMPLATE_REF) return `refs/heads/${branch}`
      if (value.startsWith('/') && !(value === tree || value.startsWith(root + '/'))) throw new Error(`fixture path escapes its temp root: ${value}`)
      return value
    }
    if (Array.isArray(value)) return value.map(rewrite)
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, rewrite(v)]))
    return value
  }
  const grants = rewrite(options.grants) as Grant[]

  const material = (id: string, text: string): EvidenceMaterial => {
    const source = join(trusted, id); writeFileSync(source, text)
    return { ref: { id, source, sha256: digest(text), locator: id }, text }
  }
  const brief = material('fixture-brief', 'Synthetic task: exercise the bounded decision transaction. No publication.')
  const policy = material('fixture-policy', JSON.stringify(options.policy))
  // Task 7: extra evidence, minted through the same real `material` writer, so its ref bytes match
  // what the issuer will later verify.
  const extra = (options.extraMaterials ?? []).map(m => material(m.id, m.text))
  const materials: Record<string, EvidenceMaterial['ref']> = Object.fromEntries(
    [brief, policy, ...extra].map(m => [m.ref.id, m.ref]))
  const snapshot: Snapshot = {
    version: 1, assignmentId: 'fixture-assignment', generation: 1,
    issuer: { kind: 'operator', id: 'fixture-operator', approvalRef: 'fixture-approval', delegationRef: null },
    seat: { id: 'fixture-seat', host: 'omp', role: 'implementer', launchId: 'fixture-launch' },
    placement: { repository: tree, worktree: tree, branch: `refs/heads/${branch}` },
    task: { briefSha256: brief.ref.sha256, scopeRefs: [brief.ref], instructionRefs: [] },
    policy: { id: policy.ref.id, sha256: policy.ref.sha256, approvalRef: 'fixture-approval' },
    grants, lifetime: { issuedAt: '2026-10-01T00:00:00Z', expiresAt: null, revoked: false },
  }
  const input = join(trusted, 'issuance.json')
  const approval = material('fixture-approval', JSON.stringify({ version: 1, kind: 'operator-approval',
    id: 'fixture-approval', operatorId: 'fixture-operator', snapshotSha256: digest(bytes(snapshot)),
    delegationSha256: null, assignments: [{ assignmentId: snapshot.assignmentId, briefSha256: snapshot.task.briefSha256 }] }))
  writeFileSync(input, JSON.stringify({ snapshot, material: [brief, policy, ...extra], approval, delegation: null }))
  const binding = issueAuthority(input, authority, workerRoots)

  const ledgerPath = join(tree, '.autonomic/ledger.md')
  const notices: string[] = []
  const nativeRequests: JudgmentRequest[] = []
  const generationRequests: unknown[] = []
  let currentId = 'S1'
  let nativeRun: ExtensionJudge | undefined
  let generationRun: NonNullable<ExtensionContext['runEphemeralTurn']> | undefined
  // Task 7: the host async-job snapshot the turn-end state reads. Null is the host default.
  let jobs: AsyncJobSnapshot | null = null

  const ctx: Record<string, unknown> = {
    agent: { kind: 'main', id: 'fixture-agent', name: 'main' },
    cwd: tree,
    getContextUsage: () => ({ tokens: 1, contextWindow: 100, percent: 10 }),
    getSystemPrompt: () => 'FIXTURE BASE PROMPT',
    getAsyncJobSnapshot: () => jobs,
    sessionManager: { getSessionId: () => currentId, getSessionFile: () => join(out, `${currentId}.jsonl`) },
    ui: { notify: (t: string) => { notices.push(t) }, setStatus: () => {} },
  }
  ctx.judge = async (request: JudgmentRequest, opts: unknown) => { nativeRequests.push(structuredClone(request)); if (!nativeRun) throw new Error('no native run'); return nativeRun(request, opts as never) }
  ctx.runEphemeralTurn = async (opts: unknown) => { generationRequests.push(opts); if (!generationRun) throw new Error('no generation run'); return generationRun(opts as never) }

  // Enroll through the real startup binding variables; HOME, the ledger path and the pain path are
  // fixture-local, so a real consumer's io.fail → pain() writes inside this temp root and never the
  // running seat's pain file. All are restored exactly in close(). The pain file sits under `out`:
  // the launcher derives a worker root from its dirname, and `root` itself would overlap the
  // authority directory.
  const painPath = join(out, 'pain.log')
  const savedEnv: Record<string, string | undefined> = {}
  // E1 (Plan Task 5 Step 1): the requested mode is real. Without AUTONOMIC_MODE the session
  // record resolves `manual` and the intercepted floor returns before any decision.
  for (const [k, v] of Object.entries({ AUTONOMIC_MODE: options.mode ?? 'manual', AUTONOMIC_AUTHORITY_PATH: binding.path, AUTONOMIC_AUTHORITY_SHA256: binding.sha256,
    AUTONOMIC_ASSIGNMENT_ID: binding.assignmentId, AUTONOMIC_ASSIGNMENT_GENERATION: String(binding.generation),
    AUTONOMIC_LAUNCH_ID: binding.launchId, AUTONOMIC_LEDGER: ledgerPath, AUTONOMIC_PAIN_PATH: painPath, HOME: home })) { savedEnv[k] = process.env[k]; process.env[k] = v }

  const host = (): ConsumerHost => ({
    sessionId: currentId, cwd: tree, sessionFile: join(out, `${currentId}.jsonl`),
    judge: ctx.judge as ExtensionJudge, generate: ctx.runEphemeralTurn as NonNullable<ExtensionContext['runEphemeralTurn']>,
    asyncJobs: () => jobs,
  })

  // A real AutonomicIO over the fixture tree: real files, real local git, no network.
  let appendHook: ((path: string, line: string) => void | Promise<void>) | undefined
  const order: string[] = []
  const io: AutonomicIO = {
    pid: process.pid,
    launchCwd: tree,
    env: process.env,
    cwd: tree,
    sessionId: () => currentId,
    sessionFile: () => join(out, `${currentId}.jsonl`),
    remove: path => { rmSync(path, { force: true }) },
    writeMode: (path, mode) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, mode) },
    rename: (from, to) => { renameSync(from, to) },
    setEnv: (name, value) => { if (value === undefined) delete process.env[name]; else process.env[name] = value },
    readText: async path => { try { return readFileSync(path, 'utf8') } catch { return undefined } },
    exists: async path => existsSync(path),
    writeText: async (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) },
    appendLine: async (path, line) => {
      order.push(path.endsWith('.decisions.jsonl') ? 'sidecar' : 'human')
      if (appendHook !== undefined) await appendHook(path, line)
      try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${line}\n`); return true } catch { return false }
    },
    touch: async path => { try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, ''); return true } catch { return false } },
    run: argv => Promise.resolve(runLocal(argv, tree)),
    usage: () => 10,
    systemPrompt: () => 'FIXTURE BASE PROMPT',
    notify: text => { notices.push(text) },
    status: () => {},
    bell: async () => {},
    captureHost: host,
  }

  const autonomic = createAutonomic(io)
  // E1 (Plan Task 5 Step 1): a real autopilot session has the default policy on disk, written by
  // session_start. The fixture writes it at construction so `invoke` alone is a live autopilot call.
  mkdirSync(join(home, '.claude/autonomic'), { recursive: true })
  writeFileSync(join(home, '.claude/autonomic/policy.md'), DEFAULT_POLICY)
  // The exposed decisions service and the lifecycle handlers share this one authority instance.
  const decisions = autonomic.decisions
  if (decisions === undefined) throw new Error('fixture is not enrolled: the decision service is unavailable')

  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown> | unknown>()
  const pi = { on: (n: string, fn: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) => handlers.set(n, fn), registerCommand: () => {}, exec: async () => ({ code: 0 }) }
  // Register through the same wiring the default export uses, so invoke/stop hit the actual handlers.
  pi.on('session_shutdown', () => autonomic.onSessionShutdown())
  pi.on('session_start', () => autonomic.onSessionStart())
  pi.on('session_tree', () => autonomic.onContextRebuild())
  pi.on('session_compact', () => autonomic.onContextRebuild())
  pi.on('session_before_switch', () => autonomic.onSessionBeforeSwitch())
  pi.on('session_switch', () => autonomic.onSessionSwitch())
  pi.on('input', (e: unknown) => autonomic.onInput(e as { source?: string }))
  pi.on('agent_start', () => autonomic.onAgentStart())
  pi.on('before_agent_start', (e: unknown) => autonomic.onBeforeAgentStart(e as { systemPrompt?: string | string[] }))
  pi.on('tool_call', (e: unknown) => autonomic.onToolCall(e as { toolName?: string; input?: unknown }))
  pi.on('tool_result', (e: unknown) => autonomic.onToolResult(e as { toolName?: string; input?: unknown; isError?: boolean; content?: unknown }))
  pi.on('session_stop', (e: unknown) => autonomic.onSessionStop(e as { last_assistant_message?: unknown; session_id?: unknown }))

  const invoke = async (toolName: string, rawInput: unknown) => handlers.get('tool_call')?.({ toolName, input: rawInput }, ctx) as Promise<{ block: true; reason: string } | undefined>
  // E4: the real extension order. seat-mods, molt and autonomic each register one `tool_call`
  // handler; dispatch runs them in registration order, stops at the first block, and otherwise
  // runs the no-side-effect original tool once (a receipt), recording the observed order. The
  // plain `handlers` map stays intact, so `invoke` still reaches the Autonomic handler alone.
  const ordered: Array<(e: unknown, c: unknown) => unknown> = []
  let receipt = 0
  const registerOrdered = (factory: (piArg: unknown) => void): void => {
    factory({ on: (n: string, fn: unknown) => { if (n === 'tool_call') ordered.push(fn as (e: unknown, c: unknown) => unknown) },
      registerCommand: () => {}, exec: async () => ({ code: 0 }), sendMessage: () => {}, sendUserMessage: () => {} })
  }
  const dispatch = async (toolName: string, input: unknown) => {
    order.push('dispatch')
    for (const fn of ordered) {
      const r = await fn({ toolName, input }, ctx) as { block?: true; reason?: string } | undefined
      if (r?.block === true) return { block: true, reason: r.reason, receipt, order: [...order] }
    }
    receipt += 1
    order.push(`receipt:${toolName}`)
    return { block: false, receipt, order: [...order] }
  }
  return {
    root, tree, authorityPath: binding.path, ledgerPath, painPath, decisions, handlers, ctx, notices, nativeRequests, generationRequests, materials,
    entryMs: autonomic.entryMs,
    invoke,
    stop: async (reply: string) => handlers.get('session_stop')?.({ last_assistant_message: reply, session_id: currentId }, ctx) as Promise<{ decision: 'block'; reason: string } | undefined>,
    setNative: run => { nativeRun = run },
    setGeneration: run => { generationRun = run },
    setJobs: snapshot => { jobs = snapshot },
    // Test-only failure injectors: a revoked snapshot, and an atomic identical-bytes/new-inode swap.
    revoke: () => { writeFileSync(binding.path, JSON.stringify({ ...snapshot, lifetime: { ...snapshot.lifetime, revoked: true } })) },
    replace: () => { writeFileSync(binding.path + '.new', readFileSync(binding.path)); renameSync(binding.path + '.new', binding.path) },
    switchTo: async (id, reason) => {
      autonomic.onSessionBeforeSwitch()
      currentId = id
      await autonomic.onSessionSwitch()
      void reason
    },
    armAppend: hook => { appendHook = hook },
    registerOrdered,
    orderedAutonomic: () => { const h = handlers.get('tool_call'); if (h !== undefined) ordered.push(h as (e: unknown, c: unknown) => unknown) },
    dispatch,
    order,
    painLines: () => existsSync(painPath) ? readFileSync(painPath, 'utf8').split('\n').filter(l => l !== '') : [],
    writeConfig: config => { mkdirSync(join(home, '.omp/agent'), { recursive: true }); writeFileSync(join(home, '.omp/agent/autonomic.json'), JSON.stringify(config)) },
    addRemote: (name, url) => { git(tree, 'remote', 'add', name, url) },
    setRemoteHead: (name, ref) => { git(tree, 'symbolic-ref', `refs/remotes/${name}/HEAD`, ref) },
    branchRef: () => `refs/heads/${branch}`,
    close: () => {
      for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
      rmSync(root, { recursive: true, force: true })
    },
  }
}

function runLocal(argv: string[], tree: string): { exitCode: number; stdout: string } {
  const r = spawnSync(argv[0]!, argv.slice(1), { cwd: tree, encoding: 'utf8', timeout: 3000 })
  return { exitCode: r.status ?? 1, stdout: String(r.stdout ?? '') }
}

function git(tree: string, ...args: string[]): string {
  const r = spawnSync('git', ['-C', tree, ...args], { encoding: 'utf8', timeout: 3000 })
  if (r.status !== 0) throw new Error(`fixture git ${args[0]} failed: ${r.stderr}`)
  return r.stdout.trim()
}

// A controllable clock for deadline observations: shift `performance.now` forward so a
// transaction's monotonic window advances without real waiting; the caller restores it.
export function clockShift(ms: number): () => void {
  const real = performance.now.bind(performance)
  const previous = performance.now
  performance.now = () => real() + ms
  return () => { performance.now = previous }
}

// Re-exported for consumers (Tasks 5–8) and the fixture's own tests.
export { placementFacts, parsePolicyBundle }
export type { ConsumerHost, DecisionIO, PolicyBundle }
