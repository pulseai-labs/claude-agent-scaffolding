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
  runs: string[][]
  toasts: string[]
  statuses: Array<string | undefined>
  notices: unknown[]
  fills: string[]
  hasBox: boolean
  session: { id: string; cwd: string }
  git: { top?: string; branch?: string; originHead?: string }
  forks: Fork[]                // the fork's replies, in order; none left means empty-reply
  forkPrompts: string[]
  verdict: { decision: 'allow' | 'ask' | 'deny'; reason?: string }
  sections: Array<{ id: string; text: string; scope: 'shared' | 'session' }>
  asked: number                // AskUserQuestion calls that reached the bottom: the operator
  toolDeny?: string            // tool.call beneath autonomic denies with this text
  failAppend?: RegExp          // an append to a matching path fails
  appendsLeft?: number         // appends that still succeed; the next ones fail
  failTouch?: RegExp           // a touch of a matching path fails
  failWrite?: RegExp           // a write to a matching path fails
  stopBlock?: string           // a block a plugin beneath autonomic returns at Stop
  usage: { tokens?: number; window: number; percent?: number }   // the context figure
  readOnly?: boolean           // core marks every tool call read-only
  dropPrompts?: boolean        // a hook beneath autonomic refuses every prompt (the result's drop arm)
}

const USAGE = { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 100 }

export const REC = (id = 's1') => `/home/u/.claude/state/autonomic/sessions/${id}.json`
export const LEDGER = '/repo/.autonomic/ledger.md'
export const POLICY = '/home/u/.claude/autonomic/policy.md'

// A policy is on disk unless a test says otherwise: without one, autopilot refuses (spec §4).
export function world(on: On, opts: { env?: Record<string, string>; files?: Record<string, string>; noPolicy?: boolean } = {}): World {
  const w: World = {
    files: new Map([...(opts.noPolicy ? [] : [[POLICY, 'TEST POLICY\n'] as [string, string]]), ...Object.entries(opts.files ?? {})]),
    runs: [], toasts: [], statuses: [], notices: [], fills: [], hasBox: true,
    session: { id: 's1', cwd: '/repo' },
    git: { top: '/repo', branch: 'feat/x', originHead: 'origin/main' },
    forks: [], forkPrompts: [],
    verdict: { decision: 'ask', reason: 'needs approval' },
    sections: [{ id: 'intro', text: 'engine intro', scope: 'shared' }],
    asked: 0,
    usage: { tokens: 100_000, window: 1_000_000 },
  }
  mock.env(on, { HOME: '/home/u', ...(opts.env ?? {}) })
  mock.store(on)
  on('state.set', async (_$, e, next) => {
    const s = e as unknown as { key?: string; value?: unknown }
    if (s.key === 'notice') w.notices.push(s.value)
    return next(e)
  })
  on('session.id', () => ({ value: w.session.id }) as never)
  on('session.cwd', () => ({ value: w.session.cwd }) as never)
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
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    w.runs.push(argv)
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false } }) as never
    const fail = () => ({ value: { exitCode: 1, stdout: '', stderr: 'failed', isStdoutTruncated: false } }) as never
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
  })
  on('model.fork', (_$, e) => {
    w.forkPrompts.push(e.prompt)
    const f = w.forks.shift() ?? { isAnswered: false, reason: 'empty-reply' }
    return { value: f.isAnswered ? { ...f, usage: USAGE } : f.reason === 'nothing-to-fork' ? f : { ...f, usage: USAGE } } as never
  })
  on('tool.check', () => ({ ...w.verdict }) as never)
  on('prompt.compose', () => ({ sections: [...w.sections] }) as never)
  on('prompt.fill', (_$, e) => {
    if (!w.hasBox) return { isFilled: false, cause: 'no_composer' } as never
    w.fills.push(e.text)
    return { isFilled: true } as never
  })
  on('prompt.submit', (_$, e) => (w.dropPrompts ? { drop: 'refused beneath autonomic' } : { text: e.text, context: e.context }) as never)
  on('tool.call', (_$, e) => {
    if (e.tool === 'AskUserQuestion') { w.asked += 1; return { result: 'the operator answered', text: 'the operator answered' } as never }
    if (w.toolDeny !== undefined) return { deny: w.toolDeny } as never
    return (w.readOnly ? { result: 'ran', text: 'ok', isReadOnly: true } : { result: 'ran', text: 'ok' }) as never
  })
  on('ui.toast', (_$, e) => { w.toasts.push(e.text); return { value: undefined } as never })
  on('ui.status', (_$, e) => { w.statuses.push(e.text); return { value: undefined } as never })
  on('command.register', () => ({ value: undefined }) as never)
  on('classic.Stop', () => (w.stopBlock === undefined ? {} : { block: w.stopBlock }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  return w
}

// A full prompt.compose input: the engine refuses a next() without promptModel.
export const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as never
export const ledgerLines = (w: World) => (w.files.get(LEDGER) ?? '').split('\n').filter(Boolean)
