import { describe, test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'
import { judge, register, statusReport } from '../hooks/register'
import { parsePermission } from '../hooks/verdict'
import { parsePark } from '../hooks/parks'
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
const HOST = { policyPath: '~/.claude/autonomic/policy.md', bell: '', loopMax: 3, tailChars: 4000, yieldAtPercent: 65, neverApprove: 'force-push default-branch-push no-verify ai-trailer', readers: 'gh pr create; gh pr edit; gh issue create; gh issue comment' }
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
  test('a park file is written, chmodded 600, its directory 700 (Task 3 step 3)', async ($, on) => {
    const w = world(on, { env: AP })
    await $.tool.check(BASH('git push origin main'))
    const file = parkFiles(w)[0]!
    const chmod = w.runs.find(r => r[0] === 'sh' && typeof r[2] === 'string' && r[2].includes('chmod 600') && r[2].includes('chmod 700'))
    expect(chmod).toBeDefined()
    expect(chmod![4]).toBe(file)
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
