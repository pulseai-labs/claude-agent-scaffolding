import { describe, test, expect } from 'claude-code/testing'
import { parsePark, parkText } from '../hooks/parks'
import { POLICY, ledgerLines, world } from './world'
import type { World } from './world'

const AP = { AUTONOMIC_MODE: 'autopilot', AUTONOMIC_PARKS_DIR: '/parks' }
const STORE = '/home/u/.local/state/autonomic/parks'
const STORE_FILE = `${STORE}/ab12cd34ef56.json`
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
  test('a bash call run in the park store parks: the pre-check and the guard read the cwd (R1)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    w.session.cwd = STORE
    const r = await $.tool.check(BASH('cat > deadbeef0001.json'))
    expect(r.decision).toBe('deny')
    expect(String(r.reason)).toContain('operator-only state')
    expect(parks(w)).toHaveLength(1)
    expect(parks(w)[0]!.source).toBe('integrity')
  })
  test("a relative parks/… call from the store's parent parks (R1)", async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    w.session.cwd = '/home/u/.local/state/autonomic'
    const r = await $.tool.check(BASH('cat > parks/deadbeef0001.json'))
    expect(r.decision).toBe('deny')
    expect(String(r.reason)).toContain('operator-only state')
    expect(parks(w)).toHaveLength(1)
  })
  test('equivalent spellings of the park store park: //, /./ and quote splitting (R2)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    for (const file_path of [
      '/home/u/.local/state/autonomic//parks/ab12cd34ef56.json',
      '/home/u/.local/state/autonomic/./parks/ab12cd34ef56.json',
      '/home/u/.local/state/autonomic/par""ks/ab12cd34ef56.json',
    ]) {
      const r = await $.tool.check({ tool: 'Write', input: { file_path, content: '{}' } } as never)
      expect([file_path, r.decision]).toEqual([file_path, 'deny'])
      expect(String(r.reason)).toContain('operator-only state')
    }
    expect(parks(w)).toHaveLength(3)
    expect(parks(w).every(p => p.source === 'integrity')).toBe(true)
  })
  test('a `..` segment in a store path parks on Bash and Write (fix round 3 P0)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    const path = 'autonomic/x/../parks/ab12cd34ef56.json'
    for (const call of [
      BASH(`cat > ${path}`),
      { tool: 'Write', input: { file_path: path, content: '{}' } } as never,
    ]) {
      const r = await $.tool.check(call)
      expect(r.decision).toBe('deny')
      expect(String(r.reason)).toContain('operator-only state')
    }
    expect(parks(w)).toHaveLength(2)
  })
  test('a cwd that reaches the store through `..` parks on Bash and Write (fix round 3 P0)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    w.session.cwd = '/home/u/.local/state/autonomic/x/../parks'
    for (const call of [
      BASH('cat > deadbeef0001.json'),
      { tool: 'Write', input: { file_path: 'deadbeef0002.json', content: '{}' } } as never,
    ]) {
      const r = await $.tool.check(call)
      expect(r.decision).toBe('deny')
      expect(String(r.reason)).toContain('operator-only state')
    }
    expect(parks(w)).toHaveLength(2)
  })
  test('a relative ../parks/… climb from a sibling cwd parks on Bash and Write (fix round 3 P0)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    w.session.cwd = '/home/u/.local/state/autonomic/x'
    const path = '../parks/ab12cd34ef56.json'
    for (const call of [
      BASH(`cat > ${path}`),
      { tool: 'Write', input: { file_path: path, content: '{}' } } as never,
    ]) {
      const r = await $.tool.check(call)
      expect(r.decision).toBe('deny')
      expect(String(r.reason)).toContain('operator-only state')
    }
    expect(parks(w)).toHaveLength(2)
  })
  test('a leading ./ store path parks on Bash and Write (review 882d round 4 P0)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    const parent = '/home/u/.local/state/autonomic'
    for (const [path, cwd] of [
      ['./parks/ab12cd34ef56.json', parent],
      ['./../parks/ab12cd34ef56.json', `${parent}/x`],
      ['../../parks/ab12cd34ef56.json', `${parent}/a/x`],
      ['parks/ab12cd34ef56.json', parent],
      ['../parks/ab12cd34ef56.json', `${parent}/x`],
    ] as const) {
      w.session.cwd = cwd
      for (const call of [
        BASH(`cat > ${path}`),
        { tool: 'Write', input: { file_path: path, content: '{}' } } as never,
      ]) {
        const r = await $.tool.check(call)
        expect([path, r.decision]).toEqual([path, 'deny'])
        expect(String(r.reason)).toContain('operator-only state')
        expect(String(r.reason)).toContain('parked for the operator')
      }
    }
    expect(parks(w)).toHaveLength(10)
  })
  test('a leading ./ before the mark parks with an unrelated cwd (review 882d round 4 P0)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    w.session.cwd = '/repo'
    const path = './autonomic/parks/ab12cd34ef56.json'
    for (const call of [
      BASH(`cat > ${path}`),
      { tool: 'Write', input: { file_path: path, content: '{}' } } as never,
    ]) {
      const r = await $.tool.check(call)
      expect(r.decision).toBe('deny')
      expect(String(r.reason)).toContain('operator-only state')
    }
    expect(parks(w)).toHaveLength(2)
  })
  test('a leading ./ near miss does not park: ./parks-notes.md and ./../parkside/… (round 4 controls)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    const parent = '/home/u/.local/state/autonomic'
    for (const [path, cwd] of [
      ['./parks-notes.md', parent],
      ['./../parkside/a.json', `${parent}/x`],
    ] as const) {
      w.session.cwd = cwd
      for (const call of [
        BASH(`cat > ${path}`),
        { tool: 'Write', input: { file_path: path, content: '{}' } } as never,
      ]) {
        expect((await $.tool.check(call)).decision).toBe('ask')
      }
    }
    expect(parks(w)).toHaveLength(0)
  })
  test('a `..` beside the mark does not park: autonomic/x/../parks-notes.md (fix round 3 control)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    const path = 'autonomic/x/../parks-notes.md'
    for (const call of [
      BASH(`cat > ${path}`),
      { tool: 'Write', input: { file_path: path, content: '{}' } } as never,
    ]) {
      expect((await $.tool.check(call)).decision).toBe('ask')
    }
    expect(parks(w)).toHaveLength(0)
  })
  test('near misses do not park: parkside and autonomic/parks-notes.md (R2 controls)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    for (const file_path of ['/repo/parkside', '/repo/autonomic/parks-notes.md']) {
      const r = await $.tool.check({ tool: 'Write', input: { file_path, content: '{}' } } as never)
      expect([file_path, r.decision]).toEqual([file_path, 'ask'])
    }
    expect(parks(w)).toHaveLength(0)
    expect(w.forkPrompts).toEqual([])
  })
  test('a non-lane tool naming the store parks by its whole input, whatever its name (R3)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    for (const call of [
      { tool: 'NotebookEdit', input: { notebook_path: STORE_FILE, new_source: 'x' } },
      { tool: 'mcp__fs__write', input: { path: STORE_FILE, content: '{}' } },
    ]) {
      const r = await $.tool.check(call as never)
      expect(r.decision).toBe('deny')
      expect(String(r.reason)).toContain('operator-only state')
    }
    expect(parks(w)).toHaveLength(2)
  })
  test('a dialog whose input says git push but names no store gets the host verdict, never the judge (R3 control)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    const r = await $.tool.check({ tool: 'AskUserQuestion', input: { questions: [{ question: 'git push origin main?' }] } } as never)
    expect(r.decision).toBe('ask')
    expect(w.forkPrompts).toEqual([])
    expect(parks(w)).toHaveLength(0)
  })
  test('autopilot off: a call whose cwd or input names the store is untouched', async ($, on) => {
    const w = world(on)
    w.session.cwd = STORE
    expect((await $.tool.check(BASH('cat > deadbeef0001.json'))).decision).toBe('ask')
    expect((await $.tool.check({ tool: 'NotebookEdit', input: { notebook_path: STORE_FILE } } as never)).decision).toBe('ask')
    expect(parks(w)).toHaveLength(0)
  })
  test('a Read whose path names a red-line-6 shape goes to the judge (0.10.0: the file tools route)', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'allow', reason: 'a path shape, not a read of a value' }))
    const r = await $.tool.check({ tool: 'Read', input: { file_path: '/home/u/.ssh/id_ed25519' } } as never)
    expect(r.decision).toBe('allow')
    expect(w.forkPrompts).toHaveLength(1)
  })
  test('a Skill call invoking /autopilot approve parks as integrity, with no judge (Task 7a)', async ($, on) => {
    const w = world(on, { env: AP })
    const r = await $.tool.check({ tool: 'Skill', input: { skill: 'autopilot', args: 'approve abc123abc123' } } as never)
    expect(r.decision).toBe('deny')
    expect(String(r.reason)).toContain('parked for the operator')
    expect(String(r.reason)).toContain('operator-only state')
    expect(String(r.reason)).toContain('/autopilot approve')
    const written = parks(w)
    expect(written).toHaveLength(1)
    expect(written[0]!.source).toBe('integrity')
    expect(w.forkPrompts).toEqual([])
  })
  test('the leading-slash spelling, and drop, park the same way (Task 7a)', async ($, on) => {
    const w = world(on, { env: AP })
    const r = await $.tool.check({ tool: 'Skill', input: { skill: '/autopilot', args: 'drop abc123abc123' } } as never)
    expect(r.decision).toBe('deny')
    expect(String(r.reason)).toContain('/autopilot drop')
    expect(parks(w)[0]!.source).toBe('integrity')
    expect(w.forkPrompts).toEqual([])
  })
  test('a command line carrying the invocation parks too: the text route (Task 7a)', async ($, on) => {
    const w = world(on, { env: AP })
    const r = await $.tool.check(BASH('claude -p "/autopilot drop abc123abc123"'))
    expect(r.decision).toBe('deny')
    expect(String(r.reason)).toContain('/autopilot drop')
    expect(parks(w)[0]!.source).toBe('integrity')
    expect(w.forkPrompts).toEqual([])
  })
  test('the control: /autopilot parks is read-only, not an invocation (Task 7a)', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow', reason: 'host allow' }
    const r = await $.tool.check({ tool: 'Skill', input: { skill: 'autopilot', args: 'parks' } } as never)
    expect(r.decision).toBe('allow')
    expect(parks(w)).toHaveLength(0)
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

  test('a secret-shaped input parks and records a value-free summary, not the input (#683; fix round 2)', async ($, on) => {
    const w = world(on, { env: AP })
    // The first two calls are judge-bound and redaction would change them: the shared rule parks
    // them before any fork (fix round 2, C4). The third has no secret shape and is judged.
    w.forks.push(fork({ decision: 'allow', reason: 'r1' }))
    expect((await $.tool.check(BASH('GITHUB_TOKEN="verysecret" git push -u origin feat/x'))).decision).toBe('deny')
    expect((await $.tool.check(BASH('TOKEN=a\\ b git push -u origin feat/y'))).decision).toBe('deny')
    expect((await $.tool.check({ tool: 'Write', input: { file_path: '/repo/.env', content: 'API=s3cr3tvalue' } } as never)).decision).toBe('allow')
    expect(w.forkPrompts).toHaveLength(1)
    const lines = ledgerLines(w)
    for (const secret of ['verysecret', 'a\\ b', ' b ', 's3cr3tvalue', '.env']) expect([secret, lines.join('\n').includes(secret)]).toEqual([secret, false])
    expect(lines.at(-3)).toContain('Q: Bash: NAME= git push -u (+2 args) · A: parked for the operator · why: the input holds content that redaction would hide')
    expect(lines.at(-2)).toContain('Q: Bash: NAME= git push -u (+2 args) · A: parked for the operator')
    expect(lines.at(-1)).toContain('Q: Write: {file_path, content} · A: allow')
  })
})

// Review round 2 (F2). Each pin drives the real `tool.check` dispatch, the way a live call does.
describe('the store guard joins line continuations (F2/C1)', () => {
  const CONT = '\\' + '\n'   // a shell line continuation: a backslash and the newline it hides
  test('an absolute store path split across lines parks: Bash and Write', async ($, on) => {
    const w = world(on, { env: AP })
    const path = `/home/u/.local/state/autonomic/${CONT}parks/ab12cd34ef56.json`
    for (const call of [
      { tool: 'Bash', input: { command: `cat > ${path}` } },
      { tool: 'Write', input: { file_path: path, content: '{}' } },
    ]) {
      const r = await $.tool.check(call as never)
      expect([call.tool, r.decision]).toEqual([call.tool, 'deny'])
      expect(String(r.reason)).toContain('operator-only state')
    }
    expect(parks(w)).toHaveLength(2)
    expect(parks(w).every(p => p.source === 'integrity')).toBe(true)
  })
  test("a relative path split inside parks/ from the store's parent parks: Bash and Write", async ($, on) => {
    const w = world(on, { env: AP })
    w.session.cwd = STORE.replace(/\/parks$/, '')
    const path = `par${CONT}ks/ab12cd34ef56.json`
    for (const call of [
      { tool: 'Bash', input: { command: `cat > ${path}` } },
      { tool: 'Write', input: { file_path: path, content: '{}' } },
    ]) {
      const r = await $.tool.check(call as never)
      expect([call.tool, r.decision]).toEqual([call.tool, 'deny'])
      expect(String(r.reason)).toContain('operator-only state')
    }
    expect(parks(w)).toHaveLength(2)
  })
})

describe('the configured park store is the store (F2/C2)', () => {
  test('AUTONOMIC_PARKS_DIR without the mark: Bash and Write park; parks-old does not', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot', AUTONOMIC_PARKS_DIR: '/tmp/parks' } })
    for (const call of [
      { tool: 'Bash', input: { command: 'cat > /tmp/parks/ab12cd34ef56.json' } },
      { tool: 'Write', input: { file_path: '/tmp/parks/ab12cd34ef56.json', content: '{}' } },
    ]) {
      const r = await $.tool.check(call as never)
      expect([call.tool, r.decision]).toEqual([call.tool, 'deny'])
      expect(String(r.reason)).toContain('operator-only state')
    }
    expect(parks(w)).toHaveLength(2)
    const control = await $.tool.check({ tool: 'Write', input: { file_path: '/tmp/parks-old/x.json', content: '{}' } } as never)
    expect(control.decision).toBe('ask')
    expect(parks(w)).toHaveLength(2)
  })
})

describe('a judge-bound input redaction would change parks (F2/C4)', () => {
  test('a secret-shaped routed call parks with no fork', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    w.forks.push(fork({ decision: 'allow', reason: 'r' }))
    const r = await $.tool.check(BASH(`git push -u origin feat/x # ghp_${'A'.repeat(36)}`))
    expect(r.decision).toBe('deny')
    expect(String(r.reason)).toContain('redaction would hide')
    expect(w.forkPrompts).toEqual([])
    expect(parks(w)).toHaveLength(1)
    expect(parks(w)[0]!.source).toBe('integrity')
  })
})

describe('a tag push is the judge\'s, not a floor park (F3)', () => {
  test('an autopilot tag push is judged and allowed, with no park', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    w.git.branch = 'main'
    w.forks.push(fork({ decision: 'allow', reason: 'a tag push' }))
    const r = await $.tool.check(BASH('git tag -a v1 HEAD && git push origin v1'))
    expect(r.decision).toBe('allow')
    expect(w.forkPrompts).toHaveLength(1)
    expect(parks(w)).toHaveLength(0)
  })
})
