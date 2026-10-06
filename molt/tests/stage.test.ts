import { describe, test, expect } from 'claude-code/testing'
import { world } from './world'

const at = (w: ReturnType<typeof world>, percent: number) => { w.usage = { tokens: percent * 10_000, window: 1_000_000 } }
const POST = { tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: 't1', session_id: 's1' } as never
const RUN = (args: string) => ({ command: 'molt', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as never
const STAGE = (id = 's1') => `/home/u/.claude/state/molt/stage/${id}`
const stage = (w: ReturnType<typeof world>, id = 's1') => JSON.parse(w.files.get(STAGE(id)) ?? 'null')

describe('the stage file (molt 0.2.1, autonomic #677 F12)', () => {
  test('a measurement writes the stage and the effective thresholds', async ($, on) => {
    const w = world(on); at(w, 42)
    await $.classic.PostToolUse(POST)
    expect(stage(w)).toMatchObject({ stage: 'warn', command: 65, block: 75, fallback: 80 })
    at(w, 66)
    await $.classic.PostToolUse(POST)
    expect(stage(w).stage).toBe('command')
  })
  test('/molt off writes off; /molt on writes the measured stage again', async ($, on) => {
    const w = world(on); at(w, 42)
    await $.classic.PostToolUse(POST)
    await $.command.run(RUN('off'))
    expect(stage(w).stage).toBe('off')
    await $.command.run(RUN('on'))
    expect(stage(w).stage).toBe('warn')
  })
  test('/molt now publishes the command stage at any fill', async ($, on) => {
    const w = world(on); at(w, 10)
    await $.command.run(RUN('now'))
    expect(stage(w).stage).toBe('command')
  })
  test('a clear resets the new session to below', async ($, on) => {
    const w = world(on); at(w, 66)
    await $.classic.PostToolUse(POST)
    await $.classic.SessionStart({ source: 'compact', session_id: 's1', cwd: '/repo' } as never)
    expect(stage(w).stage).toBe('below')
  })
  test('a failed write never stops the warning', async ($, on) => {
    const w = world(on); at(w, 42)
    w.failWrites = /\/stage\//
    const r = await $.classic.PostToolUse(POST)
    expect((r.additionalContext ?? []).join('\n')).toContain("molt's first warning")
  })
})
