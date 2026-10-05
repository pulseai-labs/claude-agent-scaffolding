import { describe, test, expect } from 'claude-code/testing'
import { ledgerLines, world } from './world'

const AP = { AUTONOMIC_MODE: 'autopilot' }
const QS = [{ question: 'Which colour?', header: 'Colour', options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }], multiSelect: false }]
const ASK = { tool: 'AskUserQuestion', questions: QS } as never
const fork = (o: object) => ({ isAnswered: true as const, text: JSON.stringify(o) })

describe('the ask reflex (spec §3.2)', () => {
  test('covered: answered in place of the operator, ledger line per question', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ covered: true, answers: { 'Which colour?': 'Blue' }, reason: 'spec §2 says blue' }))
    const r = await $.tool.call(ASK)
    expect(r.result).toEqual({ questions: QS, answers: { 'Which colour?': 'Blue' } })
    expect(w.asked).toBe(0)
    expect(ledgerLines(w).at(-1)).toContain(' · ask · Q: Which colour? · A: Blue · why: spec §2 says blue')
  })
  test('not covered: the operator is asked, and pain rings', async ($, on) => {
    const w = world(on, { env: { ...AP, AUTONOMIC_BELL: 'ring-it' } })
    w.forks.push(fork({ covered: false, reason: 'open product question' }))
    await $.tool.call(ASK)
    expect(w.asked).toBe(1)
    expect(JSON.stringify(w.notices.at(-1))).toContain('Which colour?')
    expect(w.runs.some(r => (r[2] ?? '').includes('ring-it'))).toBe(true)
  })
  test('a label that is not an option: the operator is asked (review focus 4)', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ covered: true, answers: { 'Which colour?': 'blue' }, reason: 'r' }))
    await $.tool.call(ASK)
    expect(w.asked).toBe(1)
  })
  test('fork failure twice: the operator is asked', async ($, on) => {
    const w = world(on, { env: AP })
    await $.tool.call(ASK)
    expect(w.asked).toBe(1)
    expect(w.forkPrompts).toHaveLength(2)
  })
  test('manual: no fork; the operator is asked', async ($, on) => {
    const w = world(on)
    await $.tool.call(ASK)
    expect([w.asked, w.forkPrompts.length]).toEqual([1, 0])
  })
  test("a subagent's call passes through untouched", async ($, on) => {
    const w = world(on, { env: AP })
    await $.tool.call({ tool: 'AskUserQuestion', questions: QS, agentId: 'a1' } as never)
    expect([w.asked, w.forkPrompts.length]).toEqual([1, 0])
  })
  test('ledger failure: the operator is asked', async ($, on) => {
    const w = world(on, { env: AP })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    w.failAppend = /ledger\.md$/
    w.forks.push(fork({ covered: true, answers: { 'Which colour?': 'Blue' }, reason: 'r' }))
    await $.tool.call(ASK)
    expect(w.asked).toBe(1)
  })
  test('two answers are one ledger write: a failed write records neither (PR #672 round 2)', async ($, on) => {
    const w = world(on, { env: AP })
    const Q2 = [...QS, { question: 'Which size?', header: 'Size', options: [{ label: 'S', description: '' }, { label: 'L', description: '' }], multiSelect: false }]
    w.forks.push(fork({ covered: true, answers: { 'Which colour?': 'Blue', 'Which size?': 'L' }, reason: 'spec' }))
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    w.appendsLeft = 1
    await $.tool.call({ tool: 'AskUserQuestion', questions: Q2 } as never)
    expect(w.asked).toBe(0)
    expect(ledgerLines(w).filter(l => l.includes(' · ask · '))).toHaveLength(2)
    w.forks.push(fork({ covered: true, answers: { 'Which colour?': 'Red', 'Which size?': 'S' }, reason: 'spec' }))
    w.appendsLeft = 0
    await $.tool.call({ tool: 'AskUserQuestion', questions: Q2 } as never)
    expect(w.asked).toBe(1)
    expect(ledgerLines(w).filter(l => l.includes(' · ask · '))).toHaveLength(2)
    w.appendsLeft = undefined
  })
})
