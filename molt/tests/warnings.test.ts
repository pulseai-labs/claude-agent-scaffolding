import { describe, test, expect } from 'claude-code/testing'
import { world } from './world'
import { OLD_DEFAULT_INSTRUCTIONS } from '../hooks/templates'

const at = (w: ReturnType<typeof world>, percent: number) => { w.usage = { tokens: percent * 10_000, window: 1_000_000 } }
const POST = { tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: 't1', session_id: 's1' } as never
const STOP = { stop_hook_active: false, last_assistant_message: 'done', session_id: 's1' } as never
const TURN = (answer: string) => ({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' }) as never
const PROMPT = { text: 'go', wait: false, origin: { kind: 'composer' } } as never
const ctx = (r: { additionalContext?: readonly string[] }) => (r.additionalContext ?? []).join('\n')
const H = '/repo/docs/handoff.md'

describe('the two warnings', () => {
  test('40%: one warning after a tool result, work not stopped', async ($, on) => {
    const w = world(on); at(w, 42)
    await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)
    const first = await $.classic.PostToolUse(POST)
    expect(ctx(first)).toContain("molt's first warning")
    expect(ctx(first)).not.toContain('write a session handoff now')
    expect((await $.classic.PostToolUse(POST)).additionalContext).toBeUndefined()
    expect((await $.classic.Stop(STOP)).block).toBeUndefined()
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
  })
  test('50%: the second warning follows the first, once', async ($, on) => {
    const w = world(on); at(w, 42)
    await $.classic.PostToolUse(POST)
    at(w, 52)
    expect(ctx(await $.classic.PostToolUse(POST))).toContain("molt's second warning")
    expect((await $.classic.PostToolUse(POST)).additionalContext).toBeUndefined()
  })
  test('straight to 50%: only the second warning, never the first after it', async ($, on) => {
    const w = world(on); at(w, 52)
    expect(ctx(await $.classic.PostToolUse(POST))).toContain("molt's second warning")
    expect((await $.classic.PostToolUse(POST)).additionalContext).toBeUndefined()
  })
  test('a jump past 65%: only the command, no stale warning after it (review focus 2)', async ($, on) => {
    const w = world(on); at(w, 30)
    await $.classic.PostToolUse(POST)
    at(w, 67)
    expect(ctx(await $.classic.PostToolUse(POST))).toContain('write a session handoff now')
    at(w, 67)
    expect((await $.classic.PostToolUse(POST)).additionalContext).toBeUndefined()
  })
  test('a turn that ends before any tool: the next prompt carries the warning', async ($, on) => {
    const w = world(on); at(w, 42)
    await $.turn.complete(TURN('done'))
    await $.prompt.submit(PROMPT)
    expect(w.contexts.join('\n')).toContain("molt's first warning")
    expect((await $.classic.PostToolUse(POST)).additionalContext).toBeUndefined()
  })
  test('past 65% with no tool result: the next prompt carries no stale warning', async ($, on) => {
    const w = world(on); at(w, 67)
    await $.turn.complete(TURN('done'))
    await $.prompt.submit(PROMPT)
    expect(w.contexts.join('\n')).not.toContain('warning')
  })
  test('below 40%: no warning (control)', async ($, on) => {
    const w = world(on); at(w, 30)
    expect((await $.classic.PostToolUse(POST)).additionalContext).toBeUndefined()
  })
  test('a root is told molt clears it; a child is told to tell its parent', async ($, on) => {
    const w = world(on, { env: { MOLT_HANDOFF: 'parent' } }); at(w, 42)
    expect(ctx(await $.classic.PostToolUse(POST))).toContain('tell your parent')
    at(w, 67)
    const cmd = ctx(await $.classic.PostToolUse(POST))
    expect(cmd).toContain('return the handoff to your parent')
    expect(cmd).not.toContain('molt then clears this session')
  })
  test('the root command text says molt clears (control)', async ($, on) => {
    const w = world(on); at(w, 67)
    const cmd = ctx(await $.classic.PostToolUse(POST))
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
    await $.classic.SessionStart(START)
    expect(w.files.get(OLD)).toContain('{{command}}')
    expect(w.files.get('/home/u/.claude/molt/warning.md')).toContain('{{stage}}')
  })
  test('an edited instructions file is never touched (review focus 5)', async ($, on) => {
    const w = world(on, { files: { [OLD]: 'my own words {{soft}}\n' } })
    await $.classic.SessionStart(START)
    expect(w.files.get(OLD)).toBe('my own words {{soft}}\n')
  })
})
