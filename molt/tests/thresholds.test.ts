import { describe, test, expect } from 'claude-code/testing'
import { world } from './world'

const at = (w: ReturnType<typeof world>, percent: number) => { w.usage = { tokens: percent * 10_000, window: 1_000_000 } }
const POST = { tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: 't1', session_id: 's1' } as never
const STOP = (text: string) => ({ stop_hook_active: false, last_assistant_message: text, session_id: 's1' }) as never
const RUN = (args: string) =>
  ({ command: 'molt', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as never

describe('below soft', () => {
  test('nothing gates, nudges or blocks', async ($, on) => {
    const w = world(on); at(w, 40)
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
    expect((await $.classic.PostToolUse(POST)).additionalContext).toBeUndefined()
    expect((await $.classic.Stop(STOP('done'))).block).toBeUndefined()
  })
  test('no figure: nothing gates (review focus 1)', async ($, on) => {
    const w = world(on); w.usage = { window: 0 }
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
    expect((await $.classic.Stop(STOP('done'))).block).toBeUndefined()
  })
})

describe('past soft', () => {
  test('one nudge after a tool result, never two', async ($, on) => {
    const w = world(on); at(w, 52)
    await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)
    const first = await $.classic.PostToolUse(POST)
    expect(first.additionalContext?.join('\n')).toContain('MOLT-HANDOFF:')
    const second = await $.classic.PostToolUse(POST)
    expect(second.additionalContext).toBeUndefined()
  })
  test('Stop blocks twice with the instruction, then lets the turn end', async ($, on) => {
    const w = world(on); at(w, 52)
    expect((await $.classic.Stop(STOP('done'))).block).toContain('MOLT-HANDOFF:')
    expect((await $.classic.Stop(STOP('done'))).block).toContain('MOLT-HANDOFF:')
    expect((await $.classic.Stop(STOP('done'))).block).toBeUndefined()
  })
  test('a reply that carries the marker is not blocked', async ($, on) => {
    const w = world(on, { files: { '/r/h.md': '#' } }); at(w, 52)
    expect((await $.classic.Stop(STOP('ok\nMOLT-HANDOFF: /r/h.md'))).block).toBeUndefined()
  })
  test('a /clear of your own resets the stage: no figure afterwards gates nothing', async ($, on) => {
    const w = world(on); at(w, 80)
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeDefined()
    w.session.id = 's2'
    await $.classic.SessionStart({ source: 'clear', session_id: 's2' } as never)
    w.usage = { window: 1_000_000 }
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
  })
  test('after /compact the nudge and both Stop asks come back', async ($, on) => {
    const w = world(on); at(w, 52)
    expect((await $.classic.Stop(STOP('done'))).block).toContain('MOLT-HANDOFF:')
    expect((await $.classic.Stop(STOP('done'))).block).toContain('MOLT-HANDOFF:')
    expect((await $.classic.Stop(STOP('done'))).block).toBeUndefined()
    await $.classic.SessionStart({ source: 'compact', session_id: 's1' } as never)
    expect((await $.classic.Stop(STOP('done'))).block).toContain('MOLT-HANDOFF:')
  })
  test('a marker that names a directory is blocked like a missing file', async ($, on) => {
    const w = world(on); w.dirs.add('/r/docs'); at(w, 52)
    expect((await $.classic.Stop(STOP('ok\nMOLT-HANDOFF: /r/docs'))).block).toContain('/r/docs')
  })
  test('a marker that names a missing file is blocked with its path (review focus 4)', async ($, on) => {
    const w = world(on); at(w, 52)
    expect((await $.classic.Stop(STOP('ok\nMOLT-HANDOFF: /r/typo.md'))).block).toContain('/r/typo.md does not exist')
  })
  test("another plugin's block is kept, and molt's text is added to it", async ($, on) => {
    const w = world(on); at(w, 52)
    w.stopBlock = 'Autopilot: proceed.'
    const r = await $.classic.Stop(STOP('done'))
    expect(r.block).toStartWith('Autopilot: proceed.')
    expect(r.block).toContain('MOLT-HANDOFF:')
  })
  test('reads still run past soft (control for the hard gate)', async ($, on) => {
    const w = world(on); at(w, 60)
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
  })
})

describe('past hard', () => {
  test('a read is refused with the hard note; the handoff tools run', async ($, on) => {
    const w = world(on); at(w, 66)
    const r = await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)
    expect(r.deny).toContain("past molt's hard threshold")
    expect((await $.tool.call({ tool: 'Write', file_path: '/r/h.md', content: 'x' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'git add h.md && git commit -F /tmp/m' } as never)).deny).toBeUndefined()
  })
  test("a subagent's call is never gated (review focus 2)", async ($, on) => {
    const w = world(on); at(w, 66)
    const r = await $.tool.call({ tool: 'Read', file_path: '/r/a', agentId: 'a1' } as never)
    expect(r.deny).toBeUndefined()
  })
  test('/molt off lifts the gate', async ($, on) => {
    const w = world(on); at(w, 66)
    await $.command.run(RUN('off'))
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
  })
  test('/molt off also silences the nudge and the Stop reflex', async ($, on) => {
    const w = world(on); at(w, 66)
    await $.command.run(RUN('off'))
    expect((await $.classic.PostToolUse(POST)).additionalContext).toBeUndefined()
    expect((await $.classic.Stop(STOP('done'))).block).toBeUndefined()
  })
  test('unmeasured tool output counts toward the gate', async ($, on) => {
    const w = world(on); at(w, 64)
    w.toolText = 'x'.repeat(4 * 20_000)
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/b' } as never)).deny).toContain("past molt's hard threshold")
  })
})
