import { describe, test, expect } from 'claude-code/testing'
import { ledgerLines, world } from './world'

// Findings of the whole-branch review (C1, I2, I3, I5, I6, I7, M1, M3), each pinned.
const AP = { AUTONOMIC_MODE: 'autopilot' }
const fork = (o: object) => ({ isAnswered: true as const, text: JSON.stringify(o) })
const STOP = { stop_hook_active: false, last_assistant_message: 'Shall I go on?', session_id: 's1' } as never

describe('C1: a tool whose permission prompt is the operator dialog is never approved', () => {
  for (const tool of ['AskUserQuestion', 'ExitPlanMode'])
    test(tool, async ($, on) => {
      const w = world(on, { env: AP })
      w.forks.push(fork({ decision: 'allow', reason: 'harmless' }))
      expect((await $.tool.check({ tool, input: {} } as never)).decision).toBe('ask')
      expect(w.forkPrompts).toEqual([])
      expect(w.notices).toEqual([])
    })
})

describe('I2: past the handoff fill the turn end is molt\'s, whatever the hook order', () => {
  test('at 70% fill: no fork, a molt ledger line', async ($, on) => {
    const w = world(on, { env: AP })
    w.usage = { tokens: 700_000, window: 1_000_000 }
    expect((await $.classic.Stop(STOP)).block).toBeUndefined()
    expect(w.forkPrompts).toEqual([])
    expect(ledgerLines(w).at(-1)).toContain(' · molt · ')
  })
  test('at 50% fill the reflex runs (control)', async ($, on) => {
    const w = world(on, { env: AP })
    w.usage = { tokens: 500_000, window: 1_000_000 }
    w.forks.push(fork({ case: 'waiting', reason: 'r' }))
    await $.classic.Stop(STOP)
    expect(w.forkPrompts).toHaveLength(1)
  })
})

describe('I3: a read-only Bash call is no change for the loop guard', () => {
  test('three pushes around read-only Bash: the fourth turn end is pain', async ($, on) => {
    const w = world(on, { env: AP })
    w.readOnly = true
    for (let i = 0; i < 3; i++) {
      w.forks.push(fork({ case: 'stalled', next_step: 'go', reason: 'r' }))
      await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
      await $.classic.Stop(STOP)
    }
    expect((await $.classic.Stop(STOP)).block).toBeUndefined()
    expect(JSON.stringify(w.notices.at(-1))).toContain('autopilot loop')
  })
})

describe('I5: the model reads that autonomic answered, and why', () => {
  test('the covered result carries context', async ($, on) => {
    const w = world(on, { env: AP })
    const QS = [{ question: 'Which colour?', header: 'C', options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }], multiSelect: false }]
    w.forks.push(fork({ covered: true, answers: { 'Which colour?': 'Blue' }, reason: 'spec §2 says blue' }))
    const r = await $.tool.call({ tool: 'AskUserQuestion', questions: QS } as never)
    expect((r.context ?? []).join('\n')).toContain('autonomic answered')
    expect((r.context ?? []).join('\n')).toContain('spec §2 says blue')
  })
})

describe('I6: a command too long to show the fork stays an ask', () => {
  test('no fork; pain', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'allow', reason: 'r' }))
    const command = `git commit -F msg ${'x'.repeat(5000)} && gh pr merge 1`
    expect((await $.tool.check({ tool: 'Bash', input: { command } } as never)).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
    expect(JSON.stringify(w.notices.at(-1))).toContain('permission for you')
  })
})

describe('I7: any tool input with a command string meets the never-approve list', () => {
  test('Monitor with a force push', async ($, on) => {
    const w = world(on, { env: AP })
    expect((await $.tool.check({ tool: 'Monitor', input: { command: 'git push -f' } } as never)).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
    expect(JSON.stringify(w.notices.at(-1))).toContain('never-approve')
  })
})

describe('M1: a question with no options goes to the operator with a ring', () => {
  test('no throw; pain; asked', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ covered: false, reason: 'free text' }))
    await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Your name?', header: 'N', multiSelect: false }] } as never)
    expect(w.asked).toBe(1)
    expect(JSON.stringify(w.notices.at(-1))).toContain('Your name?')
  })
})

describe('M3: a ledger that fails mid-run rings', () => {
  test('pain names the ledger', async ($, on) => {
    const w = world(on, { env: AP })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    w.failAppend = /ledger\.md$/
    w.forks.push(fork({ case: 'covered', answer: 'yes', reason: 'r' }))
    await $.classic.Stop(STOP)
    expect(JSON.stringify(w.notices.at(-1))).toContain('ledger')
  })
})
