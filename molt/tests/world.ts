import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

// The engine beneath molt, from memory. Each noun molt calls is answered here; a call
// with no answer would throw at the bottom of the chain and fail the test loudly. A
// test varies this world's fields; it never registers a second bottom hook for an
// event answered here, since the kit does not say which of two test hooks answers.
export type World = {
  files: Map<string, string>
  runs: string[][]
  prompts: string[]
  fills: string[]              // what molt put in the prompt box
  hasBox: boolean              // false: the session binds no prompt box (a -p run)
  clears: number
  clearTo: string[]            // a real clear starts a new session: the next ids, in order
  toasts: string[]
  statuses: Array<string | undefined>
  usage: { tokens?: number; window: number; percent?: number }
  breakdown?: { isAutoCompactEnabled: boolean; autoCompactThreshold?: number; rawMaxTokens: number }
  session: { id: string; cwd: string }
  messages: unknown[]
  haiku: { isAnswered: true; text: string } | { isAnswered: false; reason: 'empty-reply' }
  modelCalls: number
  toolText: string             // what every tool call's result text is
  failWrites?: RegExp          // fs.write to a matching path is refused (a read-only or full disk)
  rejectSeeds?: boolean        // a plugin's prompt.submit is refused
  slowWrites?: RegExp          // fs.write to a matching path takes 20 ms
  staged?: boolean             // Write/Edit results come back staged: held for review, file unchanged
  notices: unknown[]           // every value molt wrote to its notice, in order
  dirs: Set<string>            // paths that exist as directories: exists, but cannot be read
  stopBlock?: string           // a block another plugin beneath molt returns at Stop
}

// The test runtime has timers; the engine's types declare none, so reach it through globalThis.
const sleep = (globalThis as unknown as { setTimeout: (f: (v?: unknown) => void, ms: number) => unknown }).setTimeout

const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export function world(on: On, opts: { env?: Record<string, string>; files?: Record<string, string> } = {}): World {
  const w: World = {
    files: new Map(Object.entries(opts.files ?? {})),
    runs: [], prompts: [], fills: [], hasBox: true, clears: 0, clearTo: [], notices: [], dirs: new Set(), toasts: [], statuses: [],
    usage: { tokens: 100_000, window: 1_000_000 },
    session: { id: 's1', cwd: '/repo' },
    messages: [],
    haiku: { isAnswered: false, reason: 'empty-reply' },
    modelCalls: 0,
    toolText: 'ok',
  }
  mock.env(on, { HOME: '/home/u', ...(opts.env ?? {}) })
  mock.store(on)
  on('state.set', (_$, e, next) => {
    const w8 = e as unknown as { key?: string; value?: unknown }
    if (w8.key === 'notice') w.notices.push(w8.value)
    return next(e)
  })
  on('session.id', () => ({ value: w.session.id }) as never)
  on('session.cwd', () => ({ value: w.session.cwd }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { ...w.usage, breakdown: w.breakdown }, rateLimits: [] } }) as never)
  on('session.messages', () => ({ value: w.messages }) as never)
  on('fs.read', (_$, e) => {
    if (w.dirs.has(e.path)) return { deny: `EISDIR: ${e.path}` } as never
    const text = w.files.get(e.path)
    return (text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }) as never
  })
  on('fs.write', async (_$, e) => {
    if (w.slowWrites?.test(e.path)) await new Promise(resolve => sleep(resolve, 20))
    if (w.failWrites?.test(e.path)) return { deny: `EROFS: ${e.path}` } as never
    w.files.set(e.path, e.text)
    return { value: undefined } as never
  })
  on('fs.exists', (_$, e) => ({ value: w.files.has(e.path) || w.dirs.has(e.path) }) as never)
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    w.runs.push(argv)
    if (argv[0] === 'rm' && argv[1] === '-f' && argv[2] !== undefined) w.files.delete(argv[2])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } } as never
  })
  on('model.complete', () => {
    w.modelCalls += 1
    return { value: { ...w.haiku, usage: ZERO } } as never
  })
  on('ui.toast', (_$, e) => { w.toasts.push(e.text); return { value: undefined } as never })
  on('ui.status', (_$, e) => { w.statuses.push(e.text); return { value: undefined } as never })
  on('command.register', () => ({ value: undefined }) as never)
  // With an id queued, the clear switches the session before it resolves, as the host does;
  // with none, it answers { text } and clears nothing, as a hook that swallows /clear would.
  on('command.run', { command: 'clear' }, () => {
    w.clears += 1
    const next = w.clearTo.shift()
    if (next !== undefined) w.session.id = next
    return { text: '' }
  })
  on('prompt.fill', (_$, e) => {
    if (!w.hasBox) return { isFilled: false, cause: 'no_composer' } as never
    w.fills.push(e.text)
    return { isFilled: true } as never
  })
  on('prompt.submit', (_$, e) => {
    if (w.rejectSeeds && e.origin.kind === 'plugin') throw new Error('prompt refused')
    w.prompts.push(e.text)
    return { text: e.text } as never
  })
  on('tool.call', (_$, e) => ({
    result: w.staged && (e.tool === 'Write' || e.tool === 'Edit') ? { staged: true } : 'ran',
    text: w.toolText,
  }) as never)
  on('classic.Stop', () => (w.stopBlock === undefined ? {} : { block: w.stopBlock }))
  on('classic.PostToolUse', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
  return w
}

export const MARK = (id = 's1') => `/home/u/.claude/state/molt/active/${id}`
