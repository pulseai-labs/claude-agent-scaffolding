import { describe, test, expect } from 'claude-code/testing'
import { parsePark, parkText } from '../hooks/parks'
import { POLICY, ledgerLines, world } from './world'
import type { World } from './world'

const AP = { AUTONOMIC_MODE: 'autopilot', AUTONOMIC_PARKS_DIR: '/parks' }
const BASH = (command: string) => ({ tool: 'Bash', input: { command } }) as never
const fork = (o: object) => ({ isAnswered: true as const, text: JSON.stringify(o) })
// Every park file this world holds, parsed (0.10.0 Task 5): the suite's own store, ids we mint.
const parks = (w: World) => [...w.files.keys()].filter(p => /\/parks\/[a-f0-9]{12}\.json$/.test(p)).map(p => parsePark(w.files.get(p)!))

describe('the permission reflex (spec §3.3)', () => {
  test('a floor park rings once with its id and the rule it holds (#677 F9; 0.10.0)', async ($, on) => {
    const w = world(on, { env: AP })
    const r = await $.tool.check(BASH('cd /repo\nnpm test\ngit push -f origin feat/y'))
    expect(r.decision).toBe('deny')
    expect(String(r.reason)).toContain('parked for the operator')
    expect(String(r.reason)).toContain('red line 2')
    expect(JSON.stringify(w.notices.at(-1))).toContain('parked')
    expect(JSON.stringify(w.notices.at(-1))).toContain('never-approve: force-push')
  })
  test('an ask the scope covers is allowed and recorded', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'allow', reason: 'own branch push' }))
    const r = await $.tool.check(BASH('git push -u origin feat/x'))
    expect(r.decision).toBe('allow')
    expect(r.reason).toBe('autonomic: own branch push')
    expect(ledgerLines(w).at(-1)).toContain(' · permission · ')
    expect(ledgerLines(w).at(-1)).toContain(' · src: judge')
  })
  test('an unrouted ask reaches no judgment: it stands, with no fork (0.10.0: routing sends calls to the judge)', async ($, on) => {
    const w = world(on, { env: AP })
    expect((await $.tool.check(BASH('curl -X POST x'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('a routed ask the judge does not cover parks (call 1: the judge\'s ask parks too)', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'ask', reason: 'outside the task' }))
    const r = await $.tool.check(BASH('git push origin --delete feat/y'))
    expect(r.decision).toBe('deny')
    expect(String(r.reason)).toContain('the judge asked')
    expect(JSON.stringify(w.notices.at(-1))).toContain('parked')
  })
  test('the never-approve list is checked first, in code: no fork', async ($, on) => {
    const w = world(on, { env: AP })
    expect((await $.tool.check(BASH('git status && git push -f'))).decision).toBe('deny')
    expect(w.forkPrompts).toEqual([])
    expect(JSON.stringify(w.notices.at(-1))).toContain('parked')
  })
  test('a push to the default branch is never approved', async ($, on) => {
    const w = world(on, { env: AP })
    expect((await $.tool.check(BASH('git push origin main'))).decision).toBe('deny')
    expect(w.forkPrompts).toEqual([])
  })
  test('a park returns deny with the park text verbatim (Review Focus 1)', async ($, on) => {
    const w = world(on, { env: AP })
    const r = await $.tool.check(BASH('git push origin main'))
    expect(r.decision).toBe('deny')
    const written = parks(w)
    expect(written).toHaveLength(1)
    expect(r.reason).toBe(parkText(written[0]!))
    expect(String(r.reason)).toContain('Do not retry this call or an equivalent one.')
    expect(w.forkPrompts).toEqual([])
  })
  test('the file tools route: a Write naming the park store parks (integrity guard, call 3)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    const r = await $.tool.check({ tool: 'Write', input: { file_path: '/home/u/.local/state/autonomic/parks/ab12cd34ef56.json', content: '{}' } } as never)
    expect(r.decision).toBe('deny')
    expect(String(r.reason)).toContain('operator-only state')
    expect(String(r.reason)).toContain('parked for the operator')
    const written = parks(w)
    expect(written).toHaveLength(1)
    expect(written[0]!.tool).toBe('Write')
  })
  test('a Read whose path names a red-line-6 shape goes to the judge (0.10.0: the file tools route)', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'allow', reason: 'a path shape, not a read of a value' }))
    const r = await $.tool.check({ tool: 'Read', input: { file_path: '/home/u/.ssh/id_ed25519' } } as never)
    expect(r.decision).toBe('allow')
    expect(w.forkPrompts).toHaveLength(1)
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
    expect(parks(w)).toEqual([])
    expect(w.toasts.filter(t => t.includes('hard deny'))).toHaveLength(1)
  })
  test('a hard deny of a user-dialog tool rings too (PR #672 round 1)', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'deny', reason: 'settings deny' }
    expect((await $.tool.check({ tool: 'ExitPlanMode', input: {} } as never)).decision).toBe('deny')
    expect(w.toasts.filter(t => t.includes('hard deny'))).toHaveLength(1)
  })
  test('a policy removed mid-session ends autopilot: no fork, the ask stands (PR #672 round 1)', async ($, on) => {
    const w = world(on, { env: AP })
    expect((await $.tool.check(BASH('make'))).decision).toBe('ask')
    const before = w.forkPrompts.length
    w.files.delete(POLICY)
    w.forks.push(fork({ decision: 'allow', reason: 'r' }))
    expect((await $.tool.check(BASH('make'))).decision).toBe('ask')
    expect(w.forkPrompts).toHaveLength(before)
    expect(w.statuses.at(-1)).toBe('autopilot: no policy')
  })
  test('the length gate measures what the fork is shown (PR #672 round 2; 64k since 0.5.1)', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'allow', reason: 'r' }))
    const input = { file_path: '/repo/.env', list: Array.from({ length: 24000 }, () => 0) }
    expect(JSON.stringify(input).length).toBeLessThan(64000)
    expect((await $.tool.check({ tool: 'Edit', input } as never)).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('manual: no fork, the ask stands', async ($, on) => {
    const w = world(on)
    expect((await $.tool.check(BASH('git push'))).decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
  })
  test('a fork that never answers parks: the judge did not answer (Task 4)', async ($, on) => {
    const w = world(on, { env: AP })
    const r = await $.tool.check(BASH('git push origin --delete feat/y'))
    expect(r.decision).toBe('deny')
    expect(String(r.reason)).toContain('the judge did not answer')
    expect(w.forkPrompts).toHaveLength(2)
  })
  test('ledger failure: the allow is not taken (no ledger line, no decision)', async ($, on) => {
    const w = world(on, { env: AP })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    w.failAppend = /ledger\.md$/
    w.forks.push(fork({ decision: 'allow', reason: 'r' }))
    expect((await $.tool.check(BASH('git push origin --delete feat/y'))).decision).toBe('ask')
  })
  test('the never-approve check reads the real branch and default branch', async ($, on) => {
    const w = world(on, { env: AP })
    w.git.branch = 'main'
    expect((await $.tool.check(BASH('git push'))).decision).toBe('deny')
    expect(w.forkPrompts).toEqual([])
  })
})

describe('the bypass floor (0.1.1 §3.1)', () => {
  test('autopilot: an allowed force push parks, recorded and rung (0.10.0)', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    const r = await $.tool.check(BASH('git push -f'))
    expect(r.decision).toBe('deny')
    expect(String(r.reason)).toContain('parked for the operator')
    expect(ledgerLines(w).at(-1)).toContain('A: parked for the operator')
    expect(ledgerLines(w).at(-1)).toContain(' · src: floor')
    expect(JSON.stringify(w.notices.at(-1))).toContain('parked')
  })
  test('manual: an allow is never touched', async ($, on) => {
    const w = world(on)
    w.verdict = { decision: 'allow' }
    expect((await $.tool.check(BASH('git push -f'))).decision).toBe('allow')
  })
  test('autopilot: an allowed command with no danger word runs no git (Review Focus 2)', async ($, on) => {
    const w = world(on, { env: AP })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    w.verdict = { decision: 'allow' }
    const before = w.runs.filter(r => r[0] === 'git').length
    expect((await $.tool.check(BASH('ls -la'))).decision).toBe('allow')
    expect(w.runs.filter(r => r[0] === 'git').length).toBe(before)
  })
  test('autopilot: an allowed own-branch push is judged and stays allowed (0.10.0: routing reaches the judge)', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    w.forks.push(fork({ decision: 'allow', reason: 'an own-branch push' }))
    expect((await $.tool.check(BASH('git push -u origin feat/x'))).decision).toBe('allow')
    expect(w.forkPrompts).toHaveLength(1)
    expect(ledgerLines(w).at(-1)).toContain(' · src: judge')
  })
  test('autopilot: a deny is never changed', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'deny', reason: 'settings deny' }
    expect((await $.tool.check(BASH('git push -f'))).decision).toBe('deny')
  })
  test('autopilot: a deny from a plugin beneath tool.call rings hard deny once (#677 F7)', async ($, on) => {
    const w = world(on, { env: AP })
    w.toolDeny = 'no force-push — this seat may not run this command'
    await $.tool.call({ tool: 'Edit', file_path: '/repo/a' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/a' } as never)
    expect(w.toasts.filter(t => t.includes('hard deny'))).toHaveLength(1)
  })
  test('manual: a deny beneath tool.call rings nothing (#677 F7)', async ($, on) => {
    const w = world(on)
    w.toolDeny = 'no force-push — this seat may not run this command'
    await $.tool.call({ tool: 'Edit', file_path: '/repo/a' } as never)
    expect(w.toasts.filter(t => t.includes('hard deny'))).toHaveLength(0)
  })
  test('autopilot: the floor asks when its own check throws (final review I1)', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    w.failCwd = true
    expect((await $.tool.check(BASH('git push -f'))).decision).toBe('ask')
  })
  test("autopilot: molt's own gate past the block stage rings no hard deny (final review I3)", async ($, on) => {
    const w = world(on, { env: AP, files: { '/home/u/.claude/state/molt/stage/s1': '{"stage":"block","command":65}' } })
    w.toolDeny = "Context is at 76% of the window.\n\nContext is past molt's block threshold (75%). Only Write, Edit, Skill, git add and git commit run now."
    await $.tool.call({ tool: 'Edit', file_path: '/repo/a' } as never)
    expect(w.toasts.filter(t => t.includes('hard deny'))).toHaveLength(0)
  })
  test('autopilot: past the block stage a seat guard deny still rings (PR #681)', async ($, on) => {
    const w = world(on, { env: AP, files: { '/home/u/.claude/state/molt/stage/s1': '{"stage":"block","command":65}' } })
    w.toolDeny = 'no force-push — this seat may not run this command'
    await $.tool.call({ tool: 'Edit', file_path: '/repo/a' } as never)
    expect(w.toasts.filter(t => t.includes('hard deny'))).toHaveLength(1)
  })
})

describe('the bypass floor after a failure (PR #681: never toward fewer asks)', () => {
  test('a session that left autopilot because its ledger failed keeps the floor', async ($, on) => {
    const w = world(on, { env: AP })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    w.verdict = { decision: 'allow' }
    w.failAppend = /ledger\.md$/
    expect((await $.tool.check(BASH('git push -f'))).decision).toBe('deny')
    expect(w.statuses.at(-1)).toContain('ledger not writable')
    expect((await $.tool.check(BASH('git push -f origin main'))).decision).toBe('deny')
  })
  test('/autopilot off turns the floor off', async ($, on) => {
    const w = world(on, { env: AP })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await $.command.run({ command: 'autopilot', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)
    w.verdict = { decision: 'allow' }
    expect((await $.tool.check(BASH('git push -f'))).decision).toBe('allow')
  })
  test('the floor records no credential (PR #681 round 4)', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    await $.tool.check(BASH('git push -f https://user:ghp_SECRET@github.com/o/r.git feat/y'))
    expect(ledgerLines(w).join('\n')).not.toContain('ghp_SECRET')
    expect(JSON.stringify(w.notices)).not.toContain('ghp_SECRET')
    expect(w.toasts.join('\n')).not.toContain('ghp_SECRET')
  })
  test('both never-approve paths record the shape, not the command (PR #681 round 8)', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    await $.tool.check(BASH('SERVICE_TOKEN=alpha\\ beta git push -f origin feat/y'))
    w.verdict = { decision: 'ask' }
    await $.tool.check(BASH('git push -f https://u:t0k@x.test/r.git feat/y'))
    const all = [...ledgerLines(w), JSON.stringify(w.notices), ...w.toasts].join('\n')
    for (const secret of ['alpha', 'beta', 't0k']) expect(all).not.toContain(secret)
    expect(ledgerLines(w).at(-1)).toContain('Bash: git push -f (+2 args)')
  })

  test('an allowed ask records a value-free summary, not the input (#683)', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'allow', reason: 'r1' }), fork({ decision: 'allow', reason: 'r2' }), fork({ decision: 'allow', reason: 'r3' }))
    await $.tool.check(BASH('GITHUB_TOKEN="verysecret" git push -u origin feat/x'))
    await $.tool.check(BASH('TOKEN=a\\ b git push -u origin feat/y'))
    await $.tool.check({ tool: 'Write', input: { file_path: '/repo/.env', content: 'API=s3cr3tvalue' } } as never)
    const lines = ledgerLines(w)
    for (const secret of ['verysecret', 'a\\ b', ' b ', 's3cr3tvalue', '.env']) expect([secret, lines.join('\n').includes(secret)]).toEqual([secret, false])
    expect(lines.at(-3)).toContain('Q: Bash: NAME= git push -u (+2 args) · A: allow')
    expect(lines.at(-2)).toContain('Q: Bash: NAME= git push -u (+2 args) · A: allow')
    expect(lines.at(-1)).toContain('Q: Write: {file_path, content} · A: allow')
  })
})
