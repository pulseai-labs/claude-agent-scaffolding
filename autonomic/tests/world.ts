import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import { APPEND, TOUCH } from '../hooks/io'

// The engine beneath autonomic, from memory. Each noun autonomic calls is answered here;
// a call with no answer throws at the bottom of the chain and fails the test loudly. A
// test varies this world's fields; it never registers a second bottom hook for an event
// answered here.
export type Fork = { isAnswered: true; text: string } | { isAnswered: false; reason: 'nothing-to-fork' | 'aborted' | 'empty-reply' | 'api-error' }
export type World = {
  files: Map<string, string>
  env: Record<string, string>       // the mocked environment: what env.get answers
  runs: string[][]
  runInits: Array<{ timeoutMs?: number } | undefined>  // what each run was given, in step with runs
  bellRuns: string[][]         // every autopilot bell's argv, in order
  bellDelayMs?: number         // a bell answers after this long instead of at once
  failBell?: boolean           // the bell process rejects
  bellExit?: number            // a bell that runs answers with this exit status
  bellFinished: boolean        // a bell answered (after its delay, if any)
  toasts: string[]
  statuses: Array<string | undefined>
  notices: unknown[]
  fills: string[]
  envSets: Array<[string, string | undefined]>   // each $.env.set, in order
  submits: Array<{ text: string; origin: unknown }>   // prompts that reached the bottom
  hasBox: boolean
  session: { id: string; cwd: string }
  git: { top?: string; branch?: string; originHead?: string }
  forks: Fork[]                // the fork's replies, in order; none left means empty-reply
  forkPrompts: string[]        // every $.model.fork, in order
  completes: Array<{ model: string; prompt: string }>   // every $.model.complete, in order (0.10.0 decidingModel)
  verdict: { decision: 'allow' | 'ask' | 'deny'; reason?: string }
  sections: Array<{ id: string; text: string; scope: 'shared' | 'session' }>
  asked: number                // AskUserQuestion calls that reached the bottom: the operator
  toolDeny?: string            // tool.call beneath autonomic denies with this text
  toolResultText?: string      // the text a non-Ask tool.call result carries
  failRegister?: boolean       // $.command.register throws
  failEnvSet?: (value: string | undefined) => boolean   // $.env.set throws for a matching value
  failHome?: boolean           // $.env.get('HOME') throws
  failCwd?: boolean            // session.cwd throws (the host cannot answer)
  failAppend?: RegExp          // an append to a matching path fails
  appendsLeft?: number         // appends that still succeed; the next ones fail
  failTouch?: RegExp           // a touch of a matching path fails
  failWrite?: RegExp           // a write to a matching path fails
  stopBlock?: string           // a block a plugin beneath autonomic returns at Stop
  usage: { tokens?: number; window: number; percent?: number }   // the context figure
  readOnly?: boolean           // core marks every tool call read-only
  dropPrompts?: boolean        // a hook beneath autonomic refuses every prompt (the result's drop arm)
  throwPrompts?: boolean       // the engine throws on every prompt
}

const USAGE = { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 100 }

// The test runtime has timers; the engine's types declare none, so reach it through globalThis.
const sleep = (globalThis as unknown as { setTimeout: (f: (v?: unknown) => void, ms: number) => unknown }).setTimeout

export const REC = (id = 's1') => `/home/u/.claude/state/autonomic/sessions/${id}.json`
export const LEDGER = '/repo/.autonomic/ledger.md'
export const POLICY = '/home/u/.claude/autonomic/policy.md'

// A policy is on disk unless a test says otherwise: without one, autopilot refuses (spec §4).
export function world(on: On, opts: { env?: Record<string, string>; files?: Record<string, string>; noPolicy?: boolean } = {}): World {
  const w: World = {
    files: new Map([...(opts.noPolicy ? [] : [[POLICY, 'TEST POLICY\n'] as [string, string]]), ...Object.entries(opts.files ?? {})]),
    env: { HOME: '/home/u', ...(opts.env ?? {}) },
    runs: [], runInits: [], bellRuns: [], bellFinished: false, toasts: [], statuses: [], notices: [], fills: [], envSets: [], submits: [], hasBox: true,
    session: { id: 's1', cwd: '/repo' },
    git: { top: '/repo', branch: 'feat/x', originHead: 'origin/main' },
    forks: [], forkPrompts: [], completes: [],
    verdict: { decision: 'ask', reason: 'needs approval' },
    sections: [{ id: 'intro', text: 'engine intro', scope: 'shared' }],
    asked: 0,
    usage: { tokens: 100_000, window: 1_000_000 },
  }
  on('env.set', (_$, e) => { if (w.failEnvSet?.(e.value)) throw new Error('env refused'); w.envSets.push([e.name, e.value]); return { value: undefined } as never })
  on('env.get', (_$, e) => { if (w.failHome && e.name === 'HOME') throw new Error('no HOME'); return { value: w.env[e.name] } as never })
  mock.store(on)
  on('state.set', async (_$, e, next) => {
    const s = e as unknown as { key?: string; value?: unknown }
    if (s.key === 'notice') w.notices.push(s.value)
    return next(e)
  })
  on('session.id', () => ({ value: w.session.id }) as never)
  on('session.cwd', () => { if (w.failCwd) throw new Error('no cwd'); return ({ value: w.session.cwd }) as never })
  on('session.usage', () => ({ value: { startedAt: 0, context: { ...w.usage }, rateLimits: [] } }) as never)
  on('fs.read', (_$, e) => {
    const text = w.files.get(e.path)
    return (text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }) as never
  })
  on('fs.write', (_$, e) => {
    if (w.failWrite?.test(e.path)) return { deny: `EACCES: ${e.path}` } as never
    w.files.set(e.path, e.text)
    return { value: undefined } as never
  })
  on('fs.exists', (_$, e) => ({ value: w.files.has(e.path) }) as never)
  // The park store's listing (0.10.0 Task 5): the host answers {name, kind, size, mtimeMs,
  // isLink} per direct child, sorted by name. A file is any w.files key directly under the dir.
  on('fs.list', (_$, e) => {
    const dir = e.path.replace(/\/+$/, '')
    const names: string[] = []
    for (const path of w.files.keys()) {
      if (!path.startsWith(`${dir}/`)) continue
      const name = path.slice(dir.length + 1).split('/')[0]!
      if (name !== '' && !names.includes(name)) names.push(name)
    }
    const entries = names.sort().map(name => ({ name, kind: w.files.has(`${dir}/${name}`) ? 'file' : 'dir', size: 0, mtimeMs: 0, isLink: false }))
    return { value: entries } as never
  })
  on('process.run', async (_$, e) => (await exec(w, [...e.argv], e.init)) as never)
  on('model.fork', (_$, e) => { w.forkPrompts.push(e.prompt); return { value: nextFork(w) } as never })
  // The deciding model (0.10.0 Task 5, call 8): same reply queue as the fork, and every call is
  // recorded with its model so a test can see which API answered.
  on('model.complete', (_$, e) => { w.completes.push({ model: e.model, prompt: e.prompt }); return { value: nextFork(w) } as never })
  on('tool.check', () => ({ ...w.verdict }) as never)
  on('prompt.compose', () => ({ sections: [...w.sections] }) as never)
  on('prompt.fill', (_$, e) => {
    if (!w.hasBox) return { isFilled: false, cause: 'no_composer' } as never
    w.fills.push(e.text)
    return { isFilled: true } as never
  })
  on('prompt.submit', (_$, e) => { if (w.throwPrompts) throw new Error('no prompt'); w.submits.push({ text: e.text, origin: e.origin }); return (w.dropPrompts ? { drop: 'refused beneath autonomic' } : { text: e.text, context: e.context }) as never })
  on('tool.call', (_$, e) => {
    if (e.tool === 'AskUserQuestion') { w.asked += 1; return { result: 'the operator answered', text: 'the operator answered' } as never }
    if (w.toolDeny !== undefined) return { deny: w.toolDeny } as never
    return (w.readOnly ? { result: 'ran', text: w.toolResultText ?? 'ok', isReadOnly: true } : { result: 'ran', text: w.toolResultText ?? 'ok' }) as never
  })
  on('ui.toast', (_$, e) => { w.toasts.push(e.text); return { value: undefined } as never })
  on('ui.status', (_$, e) => { w.statuses.push(e.text); return { value: undefined } as never })
  on('command.register', () => { if (w.failRegister) throw new Error('no register'); return { value: undefined } as never })
  on('classic.Stop', () => (w.stopBlock === undefined ? {} : { block: w.stopBlock }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  return w
}

// The fork's next reply, in order: one queue for $.model.fork, $.model.complete and the engine
// double a test drives the exported functions with (0.10.0 Task 5).
function nextFork(w: World): never {
  const f = w.forks.shift() ?? { isAnswered: false, reason: 'empty-reply' }
  return (f.isAnswered ? { ...f, usage: USAGE } : f.reason === 'nothing-to-fork' ? f : { ...f, usage: USAGE }) as never
}

// process.run's answer, from memory: the dispatch handler and the engine double share it.
export type Exec = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean }
type RunAnswer = { value: Exec } | { deny: string }
async function exec(w: World, argv: string[], init: { timeoutMs?: number } | undefined): Promise<RunAnswer> {
  w.runs.push(argv)
  w.runInits.push(init)
  const ok = (stdout = ''): RunAnswer => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false } })
  const fail = (): RunAnswer => ({ value: { exitCode: 1, stdout: '', stderr: 'failed', isStdoutTruncated: false } })
  // The autopilot bell, `sh -c 'AUTONOMIC_MESSAGE="$1"; …'`. It is answered here, never by
  // the engine, so the bound `ring` passes is observable only through runInits. A delay
  // stands in for a bell that has not answered yet; a delay past the bound it was given
  // rejects, as the engine kills it (here at once — waiting the bound out in real time
  // would only slow the suite). bellExit answers with a non-zero exit instead.
  if (typeof argv[2] === 'string' && argv[2].includes('AUTONOMIC_MESSAGE')) {
    w.bellRuns.push(argv)
    if (w.failBell) return { deny: 'bell refused' }
    const bound = init?.timeoutMs ?? 30_000
    if ((w.bellDelayMs ?? 0) > bound) return { deny: `timed out after ${bound}ms` }
    if (w.bellDelayMs !== undefined) {
      const { promise, resolve } = Promise.withResolvers<void>()
      sleep(resolve, w.bellDelayMs)
      await promise
    }
    w.bellFinished = true
    return { value: { exitCode: w.bellExit ?? 0, stdout: '', stderr: '', isStdoutTruncated: false } }
  }
  if (argv[0] === 'rm' && argv[1] === '-f' && argv[2] !== undefined) { w.files.delete(argv[2]); return ok() }
  if (argv[0] === 'git') {
    const a = argv.join(' ')
    if (a.includes('--show-toplevel')) return w.git.top === undefined ? fail() : ok(`${w.git.top}\n`)
    if (a.includes('--abbrev-ref')) return w.git.branch === undefined ? fail() : ok(`${w.git.branch}\n`)
    if (a.includes('symbolic-ref')) return w.git.originHead === undefined ? fail() : ok(`${w.git.originHead}\n`)
    return fail()
  }
  if (argv[0] === 'sh' && argv[2] === APPEND) {
    const line = argv[4] ?? ''
    const path = argv[5] ?? ''
    if (w.failAppend?.test(path)) return fail()
    if (w.appendsLeft !== undefined) { if (w.appendsLeft <= 0) return fail(); w.appendsLeft -= 1 }
    w.files.set(path, `${w.files.get(path) ?? ''}${line}\n`)
    return ok()
  }
  if (argv[0] === 'sh' && argv[2] === TOUCH) {
    const path = argv[4] ?? ''
    if (w.failTouch?.test(path)) return fail()
    if (!w.files.has(path)) w.files.set(path, '')
    return ok()
  }
  return ok()
}

// The engine $ a direct call needs (0.10.0 Task 5). The test kit's own $ exposes dispatch verbs
// only — no fs, env, model or session.id — and the host refuses an engine-$ noun called from a
// test file ("its hooks module does not call it"), so a test that drives register.tsx's exported
// functions passes this instead: the world's same answers in the shape the engine gives them
// ({ value } unwrapped, { deny } thrown).
export type EngineDouble = {
  session: { id: () => Promise<string>; cwd: () => Promise<string> }
  env: { get: (name: string) => Promise<string | undefined>; set: (name: string, value: string | undefined) => Promise<void> }
  fs: { read: (path: string) => Promise<string>; write: (path: string, text: string) => Promise<void> }
  ui: { status: (text: string | undefined) => Promise<void>; toast: (text: string) => Promise<void> }
  process: { run: (argv: string[], init?: { timeoutMs?: number }) => Promise<Exec> }
  model: { fork: (r: { prompt: string }) => Promise<unknown>; complete: (r: { model: string; prompt: string }) => Promise<unknown> }
}

export function engine$(w: World): EngineDouble {
  return {
    session: {
      id: async () => w.session.id,
      cwd: async () => { if (w.failCwd) throw new Error('no cwd'); return w.session.cwd },
    },
    env: {
      get: async (name) => { if (w.failHome && name === 'HOME') throw new Error('no HOME'); return w.env[name] },
      set: async (name, value) => { if (w.failEnvSet?.(value)) throw new Error('env refused'); w.envSets.push([name, value]) },
    },
    fs: {
      read: async (path) => { const text = w.files.get(path); if (text === undefined) throw new Error(`ENOENT: ${path}`); return text },
      write: async (path, text) => { if (w.failWrite?.test(path)) throw new Error(`EACCES: ${path}`); w.files.set(path, text) },
    },
    ui: { status: async (text) => { w.statuses.push(text) }, toast: async (text) => { w.toasts.push(text) } },
    process: { run: async (argv, init) => { const r = await exec(w, [...argv], init); if ('deny' in r) throw new Error(r.deny); return r.value } },
    model: {
      fork: async (r) => { w.forkPrompts.push(r.prompt); return nextFork(w) },
      complete: async (r) => { w.completes.push({ model: r.model, prompt: r.prompt }); return nextFork(w) },
    },
  }
}

// A full prompt.compose input: the engine refuses a next() without promptModel.
export const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as never
export const ledgerLines = (w: World) => (w.files.get(LEDGER) ?? '').split('\n').filter(Boolean)
