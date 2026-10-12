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
  test('detached HEAD: a push to a named feature branch reaches the fork with no floor block', async ($, on) => {
    const w = world(on, { env: AP })
    w.git.branch = undefined
    w.forks.push(fork({ decision: 'allow', reason: 'own branch' }))
    expect((await $.tool.check(BASH('git push -u origin record/x'))).decision).toBe('allow')
    expect(w.forkPrompts[0]).not.toContain('<floor>')
  })
  test('a merged local delete goes to the fork', async ($, on) => {
    const w = world(on, { env: AP })
    w.git.merged = ['refs/heads/record/x']
    w.forks.push(fork({ decision: 'allow', reason: 'merged cleanup' }))
    expect((await $.tool.check(BASH('git branch -D record/x'))).decision).toBe('allow')
    expect(w.runs.some(r => r.join(' ') === 'git -C /repo merge-base --is-ancestor refs/heads/record/x refs/remotes/origin/main')).toBe(true)
    expect(w.forkPrompts[0]).toContain('- branch-delete (merged):')
    expect(w.forkPrompts[0]).toContain('Judge it as cleanup')
    expect(w.forkPrompts[0]).not.toContain('If the call does what such a rule names')
  })
  test('a remote delete reads the tip from the remote, and goes to the fork when that tip is merged', async ($, on) => {
    const w = world(on, { env: AP })
    const tip = 'a'.repeat(40)
    w.git.remoteTips = { 'refs/heads/feat/x': tip }
    w.git.merged = [tip]
    w.forks.push(fork({ decision: 'allow', reason: 'merged cleanup' }))
    expect((await $.tool.check(BASH('git push origin --delete feat/x'))).decision).toBe('allow')
    expect(w.runs.some(r => r.join(' ') === 'timeout 10 git -C /repo ls-remote --symref origin HEAD refs/heads/feat/x')).toBe(true)
    // The tip is checked against the remote's live default tip, not a tracking ref (PR #763 review).
    expect(w.runs.some(r => r.join(' ') === `git -C /repo merge-base --is-ancestor ${tip} ${'c'.repeat(40)}`)).toBe(true)
  })
  test('a stale tracking ref is not trusted: the remote tip decides (PR #131 review)', async ($, on) => {
    const w = world(on, { env: AP })
    w.git.remoteTips = { 'refs/heads/feat/x': 'b'.repeat(40) }
    w.git.merged = ['refs/remotes/origin/feat/x']
    expect((await $.tool.check(BASH('git push origin --delete feat/x'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('a remote that does not answer keeps the delete with the operator', async ($, on) => {
    const w = world(on, { env: AP })
    w.git.merged = ['refs/remotes/origin/feat/x']
    expect((await $.tool.check(BASH('git push origin --delete feat/x'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('a merged delete beside a text-only delete: the fork sees both (PR #763 round 2)', async ($, on) => {
    const w = world(on, { env: AP })
    w.git.merged = ['refs/heads/merged']
    w.forks.push(fork({ decision: 'ask', reason: 'victim' }))
    expect((await $.tool.check(BASH("herdr pane run p 'git branch -D victim'; git branch -D merged"))).decision).toBe('ask')
    expect(w.forkPrompts[0]).toContain('- branch-delete (merged):')
    expect(w.forkPrompts[0]).toContain('- branch-delete: ? (+4 args)')
    expect(w.forkPrompts[0]).toContain('If the call does what such a rule names')
  })
  test("a local delete in another repo uses that repo's default branch (PR #763 round 2)", async ($, on) => {
    const w = world(on, { env: AP })
    w.git.merged = ['refs/heads/topic']
    w.forks.push(fork({ decision: 'allow', reason: 'cleanup' }))
    expect((await $.tool.check(BASH('git -C /other branch -D topic'))).decision).toBe('allow')
    expect(w.runs.some(r => r.join(' ') === 'git -C /other symbolic-ref --short refs/remotes/origin/HEAD')).toBe(true)
    expect(w.runs.some(r => r.join(' ') === 'git -C /other merge-base --is-ancestor refs/heads/topic refs/remotes/origin/main')).toBe(true)
  })
  test('a local delete whose repo has no known default branch asks (PR #763 round 2)', async ($, on) => {
    const w = world(on, { env: AP })
    w.git.merged = ['refs/heads/topic']
    w.git.originHead = undefined
    expect((await $.tool.check(BASH('git branch -D topic'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('deleting the default branch is never cleanup, even when merged (PR #763 review)', async ($, on) => {
    const w = world(on, { env: AP })
    w.git.merged = ['refs/heads/main']
    expect((await $.tool.check(BASH('git branch -D main'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('an unmerged delete asks; no fork', async ($, on) => {
    const w = world(on, { env: AP })
    expect((await $.tool.check(BASH('git branch -D record/x'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('merge and delete in one call still asks: the branch is not merged yet (Known limit)', async ($, on) => {
    const w = world(on, { env: AP })
    expect((await $.tool.check(BASH('gh pr merge 1 --merge && git branch -D record/x'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('one unmerged branch keeps the whole delete with the operator', async ($, on) => {
    const w = world(on, { env: AP })
    w.git.merged = ['refs/heads/a']
    expect((await $.tool.check(BASH('git branch -D a b'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('a long Write is judged on its head and tail', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'allow', reason: 'report write' }))
    const r = await $.tool.check({ tool: 'Write', input: { file_path: '/repo/r.md', content: 'x'.repeat(30000) } } as never)
    expect(r.decision).toBe('allow')
    expect(w.forkPrompts[0]).toMatch(/characters cut/)
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
  test('a merged delete alone still goes to the fork; its ask becomes an ask (D2)', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    w.git.merged = ['refs/heads/record/x']
    w.forks.push(fork({ decision: 'ask', reason: 'not this task' }))
    expect((await $.tool.check(BASH('git branch -D record/x'))).decision).toBe('ask')
    expect(w.forkPrompts).toHaveLength(1)
    expect(w.forkPrompts[0]).toContain('- branch-delete (merged):')
  })
  test('a command with no finding keeps the allow; no fork', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    w.git.branch = undefined
    expect((await $.tool.check(BASH('git push -u origin record/x'))).decision).toBe('allow')
    expect(w.forkPrompts).toEqual([])
  })
})
