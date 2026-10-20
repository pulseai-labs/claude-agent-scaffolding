import { describe, test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'
import { judge, register, statusReport } from '../hooks/register'
import { parsePermission } from '../hooks/verdict'
import { parsePark, serializePark } from '../hooks/parks'
import { engine$, ledgerLines, world } from './world'
import type { World } from './world'

// The /autopilot park flows, and the option sets the live harness cannot hand register (0.10.0
// Task 5). `claude plugin test` gives register the manifest's userConfig defaults only, and it
// runs the mod as its own module instance, so a saved value (a 0.9.x neverApprove, a
// decidingModel) is unreachable through a dispatch. These pins set this module's cfg through its
// own register entry with a no-op registrar and drive the exported functions with the world's
// engine double (probed under 2.1.303: the kit's $ has no engine nouns, and the host refuses an
// engine-$ call made from a test file).
const AP = { AUTONOMIC_MODE: 'autopilot', AUTONOMIC_PARKS_DIR: '/parks' }
const BASH = (command: string) => ({ tool: 'Bash', input: { command } }) as never
const RUN = (args: string) => ({ command: 'autopilot', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as never
const fork = (o: object) => ({ isAnswered: true as const, text: JSON.stringify(o) })
const noopOn = (() => {}) as unknown as On
// The host's options for this plugin: every declared key at its manifest default.
const HOST = { policyPath: '~/.claude/autonomic/policy.md', bell: '', neverApprove: 'force-push default-branch-push no-verify ai-trailer', readers: 'gh pr create; gh pr edit; gh issue create; gh issue comment' }
const reconfig = (saved: Record<string, unknown> = {}): void => { register(noopOn, { ...HOST, ...saved }) }
const parkFiles = (w: World) => [...w.files.keys()].filter(p => /\/parks\/[a-f0-9]{12}\.json$/.test(p))
const thePark = (w: World) => parsePark(w.files.get(parkFiles(w)[0]!)!)

describe('/autopilot and the park store (0.10.0 Task 5)', () => {
  test('approve releases the exact call once; a second run parks again (call 2)', async ($, on) => {
    const w = world(on, { env: AP })
    const first = await $.tool.check(BASH('git push origin main'))
    expect(first.decision).toBe('deny')
    const park = thePark(w)
    expect((await $.command.run(RUN(`approve ${park.id}`))).text).toContain(park.id)
    expect(thePark(w).approval?.by).toBe('operator')
    const released = await $.tool.check(BASH('git push origin main'))
    expect(released.decision).toBe('allow')
    expect(ledgerLines(w).at(-1)).toContain(' · src: operator')
    expect(thePark(w).approval?.usedAt).not.toBe(null)
    const again = await $.tool.check(BASH('git push origin main'))
    expect(again.decision).toBe('deny')
    expect(parkFiles(w)).toHaveLength(2)
  })
  test('an approval that almost matches parks again (Review Focus 3, end to end)', async ($, on) => {
    const w = world(on, { env: AP })
    await $.tool.check(BASH('git push origin main'))
    await $.command.run(RUN(`approve ${thePark(w).id}`))
    expect((await $.tool.check(BASH('git push origin  main'))).decision).toBe('deny')
    // A call at another cwd: `$.tool.check` takes { tool, input } alone — a second argument is
    // dropped (probed under 2.1.303; the engine builds the event from `{tool, input}`) — so the
    // call's cwd is set the way a live call's is: through the session.
    w.session.cwd = '/other'
    expect((await $.tool.check(BASH('git push origin main'))).decision).toBe('deny')
    expect(parkFiles(w)).toHaveLength(3)
  })
  test('parks lists id, what stopped it, command and cwd; an approved one says so', async ($, on) => {
    const w = world(on, { env: AP })
    expect((await $.command.run(RUN('parks'))).text).toBe('no parks')
    await $.tool.check(BASH('git push origin main'))
    const park = thePark(w)
    const listed = (await $.command.run(RUN('parks'))).text
    expect(listed).toContain(park.id)
    expect(listed).toContain('red line 1')
    expect(listed).toContain('git push origin main')
    expect(listed).toContain('/repo')
    await $.command.run(RUN(`approve ${park.id}`))
    expect((await $.command.run(RUN('parks'))).text).toContain('approved')
  })
  test('approve names an unknown id and an approved park; drop removes the park', async ($, on) => {
    const w = world(on, { env: AP })
    expect((await $.command.run(RUN('approve abcdefabcdef'))).text).toContain('no park')
    await $.tool.check(BASH('git push origin main'))
    const park = thePark(w)
    expect((await $.command.run(RUN(`approve ${park.id}`))).text).toContain(park.id)
    expect((await $.command.run(RUN(`approve ${park.id}`))).text).toContain('already approved')
    expect((await $.command.run(RUN(`drop ${park.id}`))).text).toContain(park.id)
    expect(parkFiles(w)).toHaveLength(0)
    const again = await $.tool.check(BASH('git push origin main'))
    expect(again.decision).toBe('deny')
    expect(parkFiles(w)).toHaveLength(1)
    expect((await $.command.run(RUN(`drop ${park.id}`))).text).toContain('no park')
  })
  test('a drop whose rm fails answers could not drop and keeps the park (review 882c P3)', async ($, on) => {
    const w = world(on, { env: AP })
    await $.tool.check(BASH('git push origin main'))
    const park = thePark(w)
    w.failRm = true
    expect((await $.command.run(RUN(`drop ${park.id}`))).text).toBe(`could not drop ${park.id}: the store could not be changed`)
    expect(parkFiles(w)).toHaveLength(1)
  })
  test('a word outside the twelve-hex grammar is no park, and the store is not read (Task 7a)', async ($, on) => {
    const w = world(on, { env: AP })
    await $.tool.check(BASH('git push origin main'))
    const before = parkFiles(w)
    expect(before).toHaveLength(1)
    w.lists.length = 0
    expect((await $.command.run(RUN('approve ../../x'))).text).toBe('no park ../../x')
    expect((await $.command.run(RUN('drop ../../x'))).text).toBe('no park ../../x')
    expect(w.lists).toEqual([])
    expect(parkFiles(w)).toEqual(before)
  })
  test('an approved file-tool park releases only its exact input; another path parks (Task 7a; verify-T5 3b)', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'ask', reason: 'a credential path' }))
    const first = await $.tool.check({ tool: 'Read', input: { file_path: '/home/u/.ssh/id_rsa' } } as never)
    expect(first.decision).toBe('deny')
    const park = thePark(w)
    expect(park.command).toBe(JSON.stringify({ file_path: '/home/u/.ssh/id_rsa' }))
    expect((await $.command.run(RUN(`approve ${park.id}`))).text).toContain(park.id)
    w.forks.push(fork({ decision: 'ask', reason: 'a credential path' }))
    const second = await $.tool.check({ tool: 'Read', input: { file_path: '/home/u/.aws/credentials' } } as never)
    expect(second.decision).toBe('deny')
    expect(parkFiles(w)).toHaveLength(2)
    expect(thePark(w).approval?.usedAt).toBe(null)
  })
  test('a file-tool park is listed redacted and bounded, as OMP lists it (Task 7a)', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ decision: 'ask', reason: 'a credential path' }))
    const write = { file_path: '/home/u/.aws/credentials', content: 'token = ghp_abcdefghijklmnopqrst' }
    expect((await $.tool.check({ tool: 'Write', input: write } as never)).decision).toBe('deny')
    const listed = (await $.command.run(RUN('parks'))).text
    expect(listed).toContain('/home/u/.aws/credentials')
    expect(listed).toContain('***')
    expect(listed).not.toContain('ghp_abcdefghijklmnopqrst')
  })
  test('the park file and store are created 0700/0600 by the one umask-077 write (Task 3 step 3; fix B4)', async ($, on) => {
    const w = world(on, { env: AP })
    await $.tool.check(BASH('git push origin main'))
    const file = parkFiles(w)[0]!
    const at = w.runs.findIndex(r => r[0] === 'sh' && typeof r[2] === 'string' && r[2].includes('umask 077') && r[2].includes('cat > "$1"') && r[4] === file)
    expect(at).toBeGreaterThanOrEqual(0)
    // The content reaches that one run on stdin, and no wider-mode $.fs.write created the file first.
    expect(w.runInits[at]?.stdin).toContain(`"id": "${thePark(w).id}"`)
    expect(w.writes).not.toContain(file)
  })
  test('a release whose consume write fails does not allow (fix B1)', async ($, on) => {
    const w = world(on, { env: AP })
    w.verdict = { decision: 'allow' }
    await $.tool.check(BASH('git push origin main'))
    const park = thePark(w)
    await $.command.run(RUN(`approve ${park.id}`))
    w.failWrite = new RegExp(`${park.id}\\.json$`)
    const r = await $.tool.check(BASH('git push origin main'))
    expect(r.decision).toBe('ask')
    expect(String(r.reason)).toContain('could not be marked used')
    expect(thePark(w).approval?.usedAt).toBe(null)
  })
  test('two overlapping releases of one approval: the lost claim parks the second (fix B2)', async ($, on) => {
    const w = world(on, { env: AP })
    await $.tool.check(BASH('git push origin main'))
    const park = thePark(w)
    await $.command.run(RUN(`approve ${park.id}`))
    const path = parkFiles(w)[0]!
    const approved = parsePark(w.files.get(path)!)
    expect((await $.tool.check(BASH('git push origin main'))).decision).toBe('allow')
    // The overlapping call read the store before the winner consumed it: the file still says unused.
    w.files.set(path, serializePark({ ...approved, approval: { ...approved.approval!, usedAt: null } }))
    const second = await $.tool.check(BASH('git push origin main'))
    expect(second.decision).toBe('deny')
    expect(String(second.reason)).toContain('parked for the operator')
    expect(parkFiles(w)).toHaveLength(2)
    expect(parsePark(w.files.get(path)!).approval?.usedAt).toBe(null)
  })
  test('approve reports a failed store write as not approved (fix B3)', async ($, on) => {
    const w = world(on, { env: AP })
    await $.tool.check(BASH('git push origin main'))
    const park = thePark(w)
    w.failWrite = new RegExp(`${park.id}\\.json$`)
    const text = (await $.command.run(RUN(`approve ${park.id}`))).text
    expect(text).toBe(`park ${park.id} was not approved: the store could not be written`)
    expect(thePark(w).approval).toBe(null)
  })
  test('parks lists only open parks, the same line as OMP, approved marked (fix B5)', async ($, on) => {
    const w = world(on, { env: AP })
    await $.tool.check(BASH('git push origin main'))
    const park = thePark(w)
    const line = `${park.id} · red line 1 · Bash: git push origin main · /repo`
    expect((await $.command.run(RUN('parks'))).text).toBe(`parks (1):\n${line}`)
    await $.command.run(RUN(`approve ${park.id}`))
    expect((await $.command.run(RUN('parks'))).text).toBe(`parks (1):\n${line} · approved`)
    expect((await $.tool.check(BASH('git push origin main'))).decision).toBe('allow')
    expect((await $.command.run(RUN('parks'))).text).toBe('no parks')
    // The open filter stands on its own: a used park whose claim marker is gone (a pre-fix park,
    // or a deleted marker) is still not open.
    w.files.delete(`/parks/${park.id}.used`)
    expect((await $.command.run(RUN('parks'))).text).toBe('no parks')
  })
  test('the usage names the park commands', async ($, on) => {
    world(on, { env: AP })
    const text = (await $.command.run(RUN('please'))).text
    expect(text).toContain('parks')
    expect(text).toContain('approve <id>')
    expect(text).toContain('drop <id>')
  })
})

describe('options the harness cannot inject: driven through the exported functions (0.10.0 Task 5)', () => {
  test('(c)+(d): a 0.9.x value loads with no problem, stays autopilot, and the status names the retired rule (Review Focus 2)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    try {
      reconfig({ neverApprove: 'force-push branch-delete rm-outside' })
      const text = await statusReport(engine$(w), 's1')
      expect(text.split('\n')[0]).toBe('autopilot (source: env)')
      expect(text).toContain('never-approve: force-push')
      expect(text).toContain('retired in 0.10.0, now judged: branch-delete rm-outside')
      expect(text).not.toContain('settings:')
    } finally { reconfig() }
  })
  test('a stored loopMax, tailChars and yieldAtPercent load with no problem and are listed as retired once (0.11.0)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    try {
      reconfig({ loopMax: 3, tailChars: 4000, yieldAtPercent: 95 })
      const text = await statusReport(engine$(w), 's1')
      expect(text.match(/retired in 0\.11\.0/g) ?? []).toHaveLength(1)
      expect(text).toContain('retired in 0.11.0 (the turn end is no longer judged): loopMax tailChars yieldAtPercent')
      expect(text).not.toContain('yieldAtPercent:')
      expect(text).not.toContain('settings:')
    } finally { reconfig() }
  })
  test('decidingModel: the judge asks that model with $.model.complete, not the fork (call 8)', async ($, on) => {
    const w = world(on, { env: AP })
    try {
      reconfig({ decidingModel: 'claude-sonnet-5-5' })
      w.forks.push(fork({ decision: 'allow', red_line: null, reason: 'r' }))
      const j = await judge(engine$(w), 'permission', 'PROMPT', parsePermission)
      expect('v' in j && j.v.decision).toBe('allow')
      expect(w.completes).toEqual([{ model: 'claude-sonnet-5-5', prompt: 'PROMPT' }])
      expect(w.forkPrompts).toEqual([])
    } finally { reconfig() }
  })
})
