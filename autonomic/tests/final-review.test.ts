import { describe, test, expect } from 'claude-code/testing'
import { world } from './world'

// Findings of the whole-branch review (C1, I5, I6, I7, M1, M3), each pinned. I2 and I3 covered
// the turn-end reflex and the loop guard, which #873 removed.
const AP = { AUTONOMIC_MODE: 'autopilot' }
const fork = (o: object) => ({ isAnswered: true as const, text: JSON.stringify(o) })

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

describe('I6 (0.5.1 D3): a long command up to 64k characters is judged whole', () => {
  test('the fork judges; its prompt holds the whole command', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'allow', reason: 'r' }))
    const command = `git commit -F msg ${'x'.repeat(5000)} && gh pr merge 1`
    expect((await $.tool.check({ tool: 'Bash', input: { command } } as never)).decision).toBe('allow')
    expect(w.forkPrompts[0]).toContain('x'.repeat(5000))
  })
})

describe('I7: any tool input with a command string meets the never-approve list', () => {
  test('Monitor with a force push parks (0.10.0: a floor match denies)', async ($, on) => {
    const w = world(on, { env: AP })
    const r = await $.tool.check({ tool: 'Monitor', input: { command: 'git push -f' } } as never)
    expect(r.decision).toBe('deny')
    expect(String(r.reason)).toContain('parked for the operator')
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
    w.forks.push(fork({ decision: 'allow', red_line: null, reason: 'r' }))
    await $.tool.check({ tool: 'Bash', input: { command: 'git commit -F msg && gh pr merge 1' } } as never)
    expect(JSON.stringify(w.notices.at(-1))).toContain('ledger')
  })
})
