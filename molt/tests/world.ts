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
  clears: number
  toasts: string[]
  statuses: Array<string | undefined>
  usage: { tokens?: number; window: number; percent?: number }
  breakdown?: { isAutoCompactEnabled: boolean; autoCompactThreshold?: number; rawMaxTokens: number }
  session: { id: string; cwd: string }
  messages: unknown[]
  haiku: { isAnswered: true; text: string } | { isAnswered: false; reason: 'empty-reply' }
  modelCalls: number
  toolText: string             // what every tool call's result text is
  stopBlock?: string           // a block another plugin beneath molt returns at Stop
}

const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export function world(on: On, opts: { env?: Record<string, string>; files?: Record<string, string> } = {}): World {
  const w: World = {
    files: new Map(Object.entries(opts.files ?? {})),
    runs: [], prompts: [], clears: 0, toasts: [], statuses: [],
    usage: { tokens: 100_000, window: 1_000_000 },
    session: { id: 's1', cwd: '/repo' },
    messages: [],
    haiku: { isAnswered: false, reason: 'empty-reply' },
    modelCalls: 0,
    toolText: 'ok',
  }
  mock.env(on, { HOME: '/home/u', ...(opts.env ?? {}) })
  mock.store(on)
  on('session.id', () => ({ value: w.session.id }) as never)
  on('session.cwd', () => ({ value: w.session.cwd }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { ...w.usage, breakdown: w.breakdown }, rateLimits: [] } }) as never)
  on('session.messages', () => ({ value: w.messages }) as never)
  on('fs.read', (_$, e) => {
    const text = w.files.get(e.path)
    return (text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }) as never
  })
  on('fs.write', (_$, e) => { w.files.set(e.path, e.text); return { value: undefined } as never })
  on('fs.exists', (_$, e) => ({ value: w.files.has(e.path) }) as never)
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
  on('command.run', { command: 'clear' }, () => { w.clears += 1; return { text: '' } })
  on('prompt.submit', (_$, e) => { w.prompts.push(e.text); return { text: e.text } as never })
  on('tool.call', () => ({ result: 'ran', text: w.toolText }) as never)
  on('classic.Stop', () => (w.stopBlock === undefined ? {} : { block: w.stopBlock }))
  on('classic.PostToolUse', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
  return w
}

export const MARK = (id = 's1') => `/home/u/.claude/state/molt/active/${id}`
