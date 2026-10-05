import { describe, test, expect } from 'claude-code/testing'
import { world } from './world'

// model.fork is a noun a hook calls; the test $ has no model namespace, so the fork
// stub is exercised through the hooks (turn-end, ask and permission tests).
describe('the test kit reaches every event autonomic hooks', () => {
  test('tool.check, prompt.compose, tool.call and classic.Stop dispatch to the world', async ($, on) => {
    const w = world(on)
    expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls' } } as never)).decision).toBe('ask')
    expect((await $.prompt.compose({} as never)).sections.map(s => s.id)).toEqual(['intro'])
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
    expect(w.asked).toBe(1)
    w.stopBlock = 'beneath'
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'x', session_id: 's1' } as never)).block).toBe('beneath')
  })
})
