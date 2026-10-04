import { describe, test, expect } from 'claude-code/testing'
import { world } from './world'

const at = (w: ReturnType<typeof world>, percent: number) => { w.usage = { tokens: percent * 10_000, window: 1_000_000 } }
const TURN = (answer: string, extra: object = {}) =>
  ({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...extra }) as never
const STOP = { stop_hook_active: false, last_assistant_message: 'done', session_id: 's1' } as never
const CLEAR = (id: string) => ({ source: 'clear', session_id: id }) as never
const H = '/repo/docs/handoff.md'
const AUTOPILOT = { '/home/u/.claude/state/autonomic/sessions/s1.json': '{"mode":"autopilot","bell":"ring-me"}' }

describe('a molt from a marker', () => {
  test('clears, writes lineage, seeds the new session with the handoff', async ($, on) => {
    const w = world(on, { files: { [H]: '# handoff' } })
    at(w, 52)
    await $.turn.complete(TURN(`done\nMOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(1)
    w.session.id = 's2'
    await $.classic.SessionStart(CLEAR('s2'))
    expect(JSON.parse(w.files.get('/home/u/.claude/state/molt/lineage/s2.json') ?? '{}'))
      .toEqual({ from: 's1', chain: 's1', depth: 1, handoff: H })
    expect(w.prompts.at(-1)).toContain(H)
  })
  test('a relative marker path resolves against the cwd (review focus 4)', async ($, on) => {
    const w = world(on, { files: { [H]: '# handoff' } })
    await $.turn.complete(TURN('MOLT-HANDOFF: docs/handoff.md'))
    expect(w.clears).toBe(1)
  })
  test('a marker that names no file does not molt while the Stop reflex has asks left', async ($, on) => {
    const w = world(on)
    at(w, 52)
    await $.turn.complete(TURN('MOLT-HANDOFF: /repo/typo.md'))
    expect(w.clears).toBe(0)
  })
  test('the chain and depth carry across a second molt', async ($, on) => {
    const w = world(on, { files: { [H]: '# handoff' } })
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    w.session.id = 's2'
    await $.classic.SessionStart(CLEAR('s2'))
    await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
    await $.tool.call({ tool: 'Write', file_path: '/repo/x.ts', content: 'x' })
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    w.session.id = 's3'
    await $.classic.SessionStart(CLEAR('s3'))
    expect(JSON.parse(w.files.get('/home/u/.claude/state/molt/lineage/s3.json') ?? '{}'))
      .toEqual({ from: 's2', chain: 's1', depth: 2, handoff: H })
  })
})

describe('no handoff', () => {
  test('past the Stop asks: the last markdown written past soft is used', async ($, on) => {
    const w = world(on, { files: { '/repo/h2.md': '# h' } })
    at(w, 52)
    await $.classic.Stop(STOP); await $.classic.Stop(STOP)
    await $.tool.call({ tool: 'Write', file_path: '/repo/h2.md', content: '# h' })
    await $.turn.complete(TURN('done'))
    expect(w.clears).toBe(1)
    w.session.id = 's2'
    await $.classic.SessionStart(CLEAR('s2'))
    expect(w.prompts.at(-1)).toContain('/repo/h2.md')
  })
  test('past fallback: Haiku writes the brief; molt proceeds', async ($, on) => {
    const w = world(on)
    w.haiku = { isAnswered: true, text: '## Work in progress\nx\n## Next step\nship' }
    at(w, 71)
    await $.turn.complete(TURN('done'))
    const brief = w.files.get('/home/u/.claude/state/molt/briefs/s1.md') ?? ''
    expect(brief).toContain('ship')
    expect(w.clears).toBe(1)
  })
  test('Haiku fails: a facts-only brief stands in', async ($, on) => {
    const w = world(on)
    at(w, 71)
    await $.turn.complete(TURN('done'))
    expect(w.files.get('/home/u/.claude/state/molt/briefs/s1.md')).toContain('## Files written or edited')
    expect(w.clears).toBe(1)
  })
})

describe('what never molts', () => {
  test("a subagent's turn (review focus 2)", async ($, on) => {
    const w = world(on, { files: { [H]: '#' } })
    at(w, 71)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`, { agentId: 'a1' }))
    expect(w.clears).toBe(0)
  })
  test('an interrupted turn', async ($, on) => {
    const w = world(on, { files: { [H]: '#' } })
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`, { isAborted: true, reason: 'aborted' }))
    expect(w.clears).toBe(0)
  })
  test('a /clear of your own seeds nothing (review focus 3)', async ($, on) => {
    const w = world(on)
    w.session.id = 's9'
    await $.classic.SessionStart(CLEAR('s9'))
    expect(w.prompts).toEqual([])
    expect(w.runs.some(argv => argv.join(' ').includes('error'))).toBe(false)
  })
})

describe('loop guards', () => {
  test('manual: the third molt in a row with no message pauses', async ($, on) => {
    const w = world(on, { files: { [H]: '#' } })
    for (const id of ['s1', 's2']) {
      w.session.id = id
      await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
      await $.classic.SessionStart(CLEAR(`${id}x`))
    }
    w.session.id = 's3'
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(2)
    expect(w.toasts.at(-1)).toContain('molt paused')
  })
  test('manual: a message from you resets the count (control)', async ($, on) => {
    const w = world(on, { files: { [H]: '#' } })
    for (const id of ['s1', 's2', 's3']) {
      w.session.id = id
      await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
      await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
      await $.classic.SessionStart(CLEAR(`${id}x`))
    }
    expect(w.clears).toBe(3)
  })
  test('autopilot: a molt with no progress since the last one pauses and rings the bell', async ($, on) => {
    const w = world(on, { files: { [H]: '#', ...AUTOPILOT,
      '/home/u/.claude/state/molt/lineage/s1.json': '{"from":"s0","chain":"s0","depth":1,"handoff":"/h0.md"}' } })
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(0)
    expect(w.runs.some(argv => argv.join(' ').includes('ring-me'))).toBe(true)
  })
  test('autopilot: with progress the molt goes ahead (control)', async ($, on) => {
    const w = world(on, { files: { [H]: '#', ...AUTOPILOT,
      '/home/u/.claude/state/molt/lineage/s1.json': '{"from":"s0","chain":"s0","depth":1,"handoff":"/h0.md"}' } })
    await $.tool.call({ tool: 'Bash', command: 'git add a && git commit -F /tmp/m' })
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(1)
  })
})

describe('/molt now', () => {
  // The host refuses $.prompt.submit from a command.run hook (it would wait on the turn
  // the hook holds), so /molt now puts the request in the prompt box for one Enter.
  const NOW = { command: 'molt', args: 'now', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never
  test('puts the handoff request in the prompt box below soft', async ($, on) => {
    const w = world(on)
    at(w, 10)
    const r = await $.command.run(NOW)
    expect(w.fills.at(-1)).toContain('MOLT-HANDOFF:')
    expect(r.context).toBeUndefined()
  })
  test('with no prompt box, the next prompt carries the request', async ($, on) => {
    const w = world(on)
    w.hasBox = false
    at(w, 10)
    const r = await $.command.run(NOW)
    expect(r.context?.at(-1)).toContain('MOLT-HANDOFF:')
  })
  test('arms the Stop reflex below soft', async ($, on) => {
    const w = world(on)
    at(w, 10)
    await $.command.run(NOW)
    expect((await $.classic.Stop(STOP)).block).toContain('MOLT-HANDOFF:')
  })
})
