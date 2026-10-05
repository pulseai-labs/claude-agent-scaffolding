import { describe, test, expect } from 'claude-code/testing'
import { ledgerLines, world } from './world'

const AP = { AUTONOMIC_MODE: 'autopilot' }
const BASH = (command: string) => ({ tool: 'Bash', input: { command } }) as never
const fork = (o: object) => ({ isAnswered: true as const, text: JSON.stringify(o) })

describe('the permission reflex (spec §3.3)', () => {
  test('an ask the scope covers is allowed and recorded', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'allow', reason: 'own branch push' }))
    const r = await $.tool.check(BASH('git push -u origin feat/x'))
    expect(r.decision).toBe('allow')
    expect(r.reason).toBe('autonomic: own branch push')
    expect(ledgerLines(w).at(-1)).toContain(' · permission · ')
  })
  test('an ask the scope does not cover stays an ask, and pain rings (plan decision 2)', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'ask', reason: 'outside the task' }))
    expect((await $.tool.check(BASH('curl -X POST x'))).decision).toBe('ask')
    expect(JSON.stringify(w.notices.at(-1))).toContain('permission for you')
  })
  test('the never-approve list is checked first, in code: no fork', async ($, on) => {
    const w = world(on, { env: AP })
    expect((await $.tool.check(BASH('git status && git push -f'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
    expect(JSON.stringify(w.notices.at(-1))).toContain('never-approve')
  })
  test('a push to the default branch is never approved', async ($, on) => {
    const w = world(on, { env: AP })
    expect((await $.tool.check(BASH('git push origin main'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('allow from beneath is untouched; no fork', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    expect((await $.tool.check(BASH('ls'))).decision).toBe('allow')
    expect(w.forkPrompts).toEqual([])
  })
  test('a deny is never changed; it rings once per tool and reason', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'deny', reason: 'settings deny' }
    expect((await $.tool.check(BASH('x'))).decision).toBe('deny')
    expect((await $.tool.check(BASH('y'))).decision).toBe('deny')
    expect(w.forkPrompts).toEqual([])
    expect(w.toasts.filter(t => t.includes('hard deny'))).toHaveLength(1)
  })
  test('manual: no fork, the ask stands', async ($, on) => {
    const w = world(on)
    expect((await $.tool.check(BASH('git push'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('a fork that fails twice: the ask stands', async ($, on) => {
    const w = world(on, { env: AP })
    expect((await $.tool.check(BASH('make'))).decision).toBe('ask')
    expect(w.forkPrompts).toHaveLength(2)
  })
  test('ledger failure: the ask stands', async ($, on) => {
    const w = world(on, { env: AP })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    w.failAppend = /ledger\.md$/
    w.forks.push(fork({ decision: 'allow', reason: 'r' }))
    expect((await $.tool.check(BASH('make'))).decision).toBe('ask')
  })
  test('the never-approve check reads the real branch and default branch', async ($, on) => {
    const w = world(on, { env: AP })
    w.git.branch = 'main'
    expect((await $.tool.check(BASH('git push'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
})
