import { describe, test, expect } from 'claude-code/testing'
import { world, flush, requests, STARTED, READ } from './world'
import { OLD_DEFAULT_INSTRUCTIONS } from '../hooks/templates'

const at = (w: ReturnType<typeof world>, percent: number) => { w.usage = { tokens: percent * 10_000, window: 1_000_000 } }
const TURN = (answer: string) => ({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' }) as never
const PROMPT = { text: 'go', wait: false, origin: { kind: 'composer' } } as never
const ctx = (r: { context?: readonly string[] }) => (r.context ?? []).join('\n')
const H = '/repo/docs/handoff.md'

describe('the two warnings', () => {
  test('40%: one warning after a tool result, work not stopped', async ($, on) => {
    const w = world(on); at(w, 42)
    const first = await $.tool.call(READ)
    expect(ctx(first)).toContain("molt's first warning")
    expect(ctx(first)).not.toContain('write a session handoff now')
    expect((await $.tool.call(READ)).context).toBeUndefined()
    await $.turn.complete(TURN('done')); await flush()
    expect(requests(w)).toEqual([])
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
  })
  test("a subagent's tool result and a refused call carry no warning (#929)", async ($, on) => {
    const w = world(on); at(w, 42)
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a', agentId: 'a1' } as never)).context).toBeUndefined()
    at(w, 80)
    expect((await $.tool.call(READ)).deny).toBeDefined()
    at(w, 42)
    expect(ctx(await $.tool.call(READ))).toContain("molt's first warning")
  })
  test('50%: the second warning follows the first, once', async ($, on) => {
    const w = world(on); at(w, 42)
    await $.tool.call(READ)
    at(w, 52)
    expect(ctx(await $.tool.call(READ))).toContain("molt's second warning")
    expect((await $.tool.call(READ)).context).toBeUndefined()
  })
  test('straight to 50%: only the second warning, never the first after it', async ($, on) => {
    const w = world(on); at(w, 52)
    expect(ctx(await $.tool.call(READ))).toContain("molt's second warning")
    expect((await $.tool.call(READ)).context).toBeUndefined()
  })
  test('a jump past 65%: only the command, no stale warning after it (review focus 2)', async ($, on) => {
    const w = world(on); at(w, 30)
    await $.tool.call(READ)
    at(w, 67)
    expect(ctx(await $.tool.call(READ))).toContain('write a session handoff now')
    at(w, 67)
    expect((await $.tool.call(READ)).context).toBeUndefined()
  })
  test('a turn that ends before any tool: the next prompt carries the warning', async ($, on) => {
    const w = world(on); at(w, 42)
    await $.turn.complete(TURN('done'))
    await $.prompt.submit(PROMPT)
    expect(w.contexts.join('\n')).toContain("molt's first warning")
    expect((await $.tool.call(READ)).context).toBeUndefined()
  })
  test('a prompt refused beneath molt: the warning rides the next prompt that enters (PR #670 review)', async ($, on) => {
    const w = world(on); at(w, 42)
    await $.turn.complete(TURN('done'))
    w.dropPrompts = true
    await $.prompt.submit(PROMPT)
    w.dropPrompts = false
    await $.prompt.submit(PROMPT)
    expect(w.contexts.join('\n')).toContain("molt's first warning")
  })
  test('past 65% with no tool result: the next prompt carries no stale warning', async ($, on) => {
    const w = world(on); at(w, 67)
    await $.turn.complete(TURN('done'))
    await $.prompt.submit(PROMPT)
    expect(w.contexts.join('\n')).not.toContain('warning')
  })
  test('below 40%: no warning (control)', async ($, on) => {
    const w = world(on); at(w, 30)
    expect((await $.tool.call(READ)).context).toBeUndefined()
  })
  test('a root is told molt clears it; a child is told to tell its parent', async ($, on) => {
    const w = world(on, { env: { MOLT_HANDOFF: 'parent' } }); at(w, 42)
    expect(ctx(await $.tool.call(READ))).toContain('tell your parent')
    at(w, 67)
    const cmd = ctx(await $.tool.call(READ))
    expect(cmd).toContain('return the handoff to your parent')
    expect(cmd).not.toContain('molt then clears this session')
  })
  test('the root command text says molt clears (control)', async ($, on) => {
    const w = world(on); at(w, 67)
    const cmd = ctx(await $.tool.call(READ))
    expect(cmd).toContain('molt then clears this session')
    expect(cmd).not.toContain('tell your parent')
  })
})

describe('handing off at a warning', () => {
  test('a marker at 45% molts (decision 1)', async ($, on) => {
    const w = world(on, { files: { [H]: '#' } }); w.clearTo.push('s2'); at(w, 45)
    await $.turn.complete(TURN(`done\nMOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(1)
  })
  test('no marker at 45%: no Stop ask and no fallback', async ($, on) => {
    const w = world(on); at(w, 45)
    await $.turn.complete(TURN('done'))
    expect(w.clears).toBe(0)
    expect(w.modelCalls).toBe(0)
  })
})

describe('templates on first start', () => {
  const START = { source: 'startup', session_id: 's1' } as never
  const OLD = '/home/u/.claude/molt/instructions.md'
  test('a byte-identical 0.1.0 default instructions file is replaced (decision 4)', async ($, on) => {
    const w = world(on, { files: { [OLD]: `${OLD_DEFAULT_INSTRUCTIONS}\n` } })
    await $.session.start(STARTED)
    expect(w.files.get(OLD)).toContain('{{command}}')
    expect(w.files.get('/home/u/.claude/molt/warning.md')).toContain('{{stage}}')
  })
  test('an edited instructions file is never touched (review focus 5)', async ($, on) => {
    const w = world(on, { files: { [OLD]: 'my own words {{soft}}\n' } })
    await $.session.start(STARTED)
    expect(w.files.get(OLD)).toBe('my own words {{soft}}\n')
  })
})
