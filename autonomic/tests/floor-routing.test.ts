import { describe, test, expect } from 'claude-code/testing'
import { ledgerLines, world } from './world'

const AP = { AUTONOMIC_MODE: 'autopilot' }
const BASH = (command: string) => ({ tool: 'Bash', input: { command } }) as never
const fork = (o: object) => ({ isAnswered: true as const, text: JSON.stringify(o) })
const REPLY = "gh api repos/o/r/pulls/1/comments/2/replies -f body='we do not push here'"

describe('0.5.1 routing: an ask (spec §6)', () => {
  test('an own-words match asks the operator; no fork', async ($, on) => {
    const w = world(on, { env: AP })
    expect((await $.tool.check(BASH('git push -f origin feat/x'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
    expect(JSON.stringify(w.notices.at(-1))).toContain('never-approve')
  })
  test('a text-only match goes to the fork, with the floor block', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'allow', reason: 'a reply, no push' }))
    expect((await $.tool.check(BASH(REPLY))).decision).toBe('allow')
    expect(w.forkPrompts[0]).toContain('<floor>')
    expect(w.forkPrompts[0]).toContain('- force-push:')
  })
  test('the fork asks: the ask stands and pain rings', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'ask', reason: 'unclear' }))
    expect((await $.tool.check(BASH(REPLY))).decision).toBe('ask')
    expect(JSON.stringify(w.notices.at(-1))).toContain('permission for you')
  })
  test('detached HEAD: a push to a named branch still asks, as in 0.5.0 (#766)', async ($, on) => {
    const w = world(on, { env: AP })
    w.git.branch = undefined
    expect((await $.tool.check(BASH('git push -u origin record/x'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('a branch delete asks, merged or not: merged-delete routing is #764 (PR #763 round 5)', async ($, on) => {
    const w = world(on, { env: AP })
    for (const c of ['git branch -D record/x', 'git push origin --delete feat/x'])
      expect([c, (await $.tool.check(BASH(c))).decision]).toEqual([c, 'ask'])
    expect(w.forkPrompts).toEqual([])
    expect(w.runs.some(r => r.includes('merge-base') || r.includes('ls-remote'))).toBe(false)
  })
  test('a 30k Write is judged whole', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'allow', reason: 'report write' }))
    const r = await $.tool.check({ tool: 'Write', input: { file_path: '/repo/r.md', content: 'x'.repeat(30000) } } as never)
    expect(r.decision).toBe('allow')
    expect(w.forkPrompts[0]).toContain('x'.repeat(30000))
  })
  test('an input over 64k asks: no call is allowed with an unseen part (PR #763)', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'allow', reason: 'r' }))
    expect((await $.tool.check({ tool: 'Write', input: { file_path: '/repo/r.md', content: 'x'.repeat(70000) } } as never)).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
    expect(JSON.stringify(w.notices.at(-1))).toContain('input too long to judge')
  })
  test('bypass: a text-only finding in an input over 64k asks; no fork (PR #763)', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    w.forks.push(fork({ decision: 'allow', reason: 'r' }))
    const command = `gh api x -f body='do not push -f' && echo ${'y'.repeat(70000)}`
    expect((await $.tool.check(BASH(command))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('a long SubagentHandback is judged', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'allow', reason: 'report' }))
    expect((await $.tool.check({ tool: 'SubagentHandback', input: { message: 'r'.repeat(12000) } } as never)).decision).toBe('allow')
    expect(w.forkPrompts).toHaveLength(1)
  })
})

describe('0.5.1 routing: the bypass floor (spec §6)', () => {
  test('an own-words match turns the allow into an ask; no fork', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    expect((await $.tool.check(BASH('git push -f origin feat/x'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('a text-only match the fork allows keeps the allow, recorded', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    w.forks.push(fork({ decision: 'allow', reason: 'a reply, no push' }))
    expect((await $.tool.check(BASH(REPLY))).decision).toBe('allow')
    expect(ledgerLines(w).at(-1)).toContain(' · permission · ')
    expect(ledgerLines(w).at(-1)).toContain('allow')
  })
  test('a text-only match the fork does not allow becomes an ask with a ring', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    w.forks.push(fork({ decision: 'ask', reason: 'unclear' }))
    const r = await $.tool.check(BASH(REPLY))
    expect(r.decision).toBe('ask')
    expect(r.reason).toContain('force-push')
    expect(JSON.stringify(w.notices.at(-1))).toContain('permission for you')
  })
  test('a fork that fails twice becomes an ask', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    expect((await $.tool.check(BASH(REPLY))).decision).toBe('ask')
  })
  test('a command with no finding keeps the allow; no fork', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    expect((await $.tool.check(BASH('git push -u origin record/x'))).decision).toBe('allow')
    expect(w.forkPrompts).toEqual([])
  })
})
