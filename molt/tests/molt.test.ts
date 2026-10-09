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
    w.clearTo.push('s2')
    at(w, 67)
    await $.turn.complete(TURN(`done\nMOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(1)
    w.session.id = 's2'
    await $.classic.SessionStart(CLEAR('s2'))
    expect(JSON.parse(w.files.get('/home/u/.claude/state/molt/lineage/s2.json') ?? '{}'))
      .toEqual({ from: 's1', chain: 's1', depth: 1, handoff: H })
    expect(w.prompts.at(-1)).toContain(H)
  })
  test('a seed into a session already past the first warning carries no warning (PR #670 review)', async ($, on) => {
    const w = world(on, { files: { [H]: '# handoff' } })
    w.clearTo.push('s2')
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    w.session.id = 's2'
    at(w, 45)
    await $.classic.SessionStart(CLEAR('s2'))
    // On the host the seed may enter only after SessionStart returns, before any response
    // has measured the session's starting fill.
    const n = w.contexts.length
    await $.prompt.submit({ text: `continue from ${H}`, wait: false, origin: { kind: 'plugin' } } as never)
    expect(w.contexts.slice(n).join('\n')).not.toContain('warning')
  })
  test('a lineage record that cannot be written does not stop the seed', async ($, on) => {
    const w = world(on, { files: { [H]: '# handoff' } })
    w.failWrites = /\/lineage\//
    w.clearTo.push('s2')
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    await $.classic.SessionStart(CLEAR('s2'))
    expect(w.prompts.at(-1)).toContain(H)
  })
  test('nothing after the clear stops the seed: a refused notice write', async ($, on) => {
    const w = world(on, { files: { [H]: '# handoff' } })
    w.failNotices = true
    w.clearTo.push('s2')
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(1)          // the notice before the clear is best-effort too
    await $.classic.SessionStart(CLEAR('s2')).catch(() => undefined)
    expect(w.prompts.at(-1)).toContain(H)
  })
  test('nothing after the clear stops the seed: another plugin failing at SessionStart', async ($, on) => {
    const w = world(on, { files: { [H]: '# handoff' } })
    w.failSessionStart = true
    w.clearTo.push('s2')
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    await $.classic.SessionStart(CLEAR('s2')).catch(() => undefined)
    expect(w.prompts.at(-1)).toContain(H)
    w.failSessionStart = false
    at(w, 85)
    expect((await $.tool.call({ tool: 'Read', file_path: '/repo/a' } as never)).deny).toBeDefined()
  })
  test('a seed rejected while "resumed" is being written still leaves the warning', async ($, on) => {
    const w = world(on, { files: { [H]: '# handoff' } })
    w.rejectSeeds = true
    w.slowInfoNotices = true
    w.clearTo.push('s2')
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    await $.classic.SessionStart(CLEAR('s2'))
    for (let i = 0; i < 5; i++) await $.prompt.submit({ text: 'tick', wait: false, origin: { kind: 'sdk' } } as never)
    expect((w.notices.at(-1) as { tone?: string } | null)?.tone).toBe('warn')
  })
  test('a rejected seed leaves the warning, not "resumed"', async ($, on) => {
    const w = world(on, { files: { [H]: '# handoff' } })
    w.rejectSeeds = true
    w.slowWrites = /\/lineage\//      // the rejection lands while the lineage write is in flight
    w.clearTo.push('s2')
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    await $.classic.SessionStart(CLEAR('s2'))
    for (let i = 0; i < 5; i++) await $.prompt.submit({ text: 'tick', wait: false, origin: { kind: 'sdk' } } as never)
    expect((w.notices.at(-1) as { tone?: string } | null)?.tone).toBe('warn')
  })
  test('a staged edit of a markdown file past soft is not the handoff', async ($, on) => {
    const w = world(on, { files: { '/repo/old.md': '# old' } })
    w.staged = true
    w.clearTo.push('s2')
    at(w, 67)
    await $.classic.Stop(STOP); await $.classic.Stop(STOP)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/old.md', old_string: 'old', new_string: 'h' })
    await $.turn.complete(TURN('done'))
    await $.classic.SessionStart(CLEAR('s2'))
    expect(w.prompts.at(-1)).not.toContain('/repo/old.md')
  })
  test('a marker that names a directory does not molt', async ($, on) => {
    const w = world(on)
    w.dirs.add('/repo/docs')
    at(w, 67)
    await $.turn.complete(TURN('MOLT-HANDOFF: /repo/docs'))
    expect(w.clears).toBe(0)
  })
  test('after /compact, a markdown file written before it is not the handoff', async ($, on) => {
    const w = world(on, { files: { '/repo/old.md': '# old' } })
    at(w, 67)
    await $.tool.call({ tool: 'Write', file_path: '/repo/old.md', content: '# old' })
    await $.classic.SessionStart({ source: 'compact', session_id: 's1' } as never)
    await $.turn.complete(TURN('done'))
    expect(w.clears).toBe(0)
  })
  test('a relative marker path resolves against the cwd (review focus 4)', async ($, on) => {
    const w = world(on, { files: { [H]: '# handoff' } })
    at(w, 67)
    await $.turn.complete(TURN('MOLT-HANDOFF: docs/handoff.md'))
    expect(w.clears).toBe(1)
  })
  test('a marker below soft does not molt (minimum room)', async ($, on) => {
    const w = world(on, { files: { [H]: '# handoff' } })
    at(w, 10)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(0)
  })
  test('a marker that names no file does not molt while the Stop reflex has asks left', async ($, on) => {
    const w = world(on)
    at(w, 67)
    await $.turn.complete(TURN('MOLT-HANDOFF: /repo/typo.md'))
    expect(w.clears).toBe(0)
  })
  test('the chain and depth carry across a second molt', async ($, on) => {
    const w = world(on, { files: { [H]: '# handoff' } })
    at(w, 67)
    w.clearTo.push('s2', 's3')
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
    at(w, 67)
    await $.classic.Stop(STOP); await $.classic.Stop(STOP)
    await $.tool.call({ tool: 'Write', file_path: '/repo/h2.md', content: '# h' })
    w.clearTo.push('s2')
    await $.turn.complete(TURN('done'))
    expect(w.clears).toBe(1)
    w.session.id = 's2'
    await $.classic.SessionStart(CLEAR('s2'))
    expect(w.prompts.at(-1)).toContain('/repo/h2.md')
  })
  test('past fallback: Haiku writes the brief; molt proceeds', async ($, on) => {
    const w = world(on)
    w.haiku = { isAnswered: true, text: '## Work in progress\nx\n## Next step\nship' }
    at(w, 81)
    await $.turn.complete(TURN('done'))
    const brief = w.files.get('/home/u/.claude/state/molt/briefs/s1.md') ?? ''
    expect(brief).toContain('ship')
    expect(w.clears).toBe(1)
  })
  test('Haiku fails: a facts-only brief stands in', async ($, on) => {
    const w = world(on)
    at(w, 81)
    await $.turn.complete(TURN('done'))
    expect(w.files.get('/home/u/.claude/state/molt/briefs/s1.md')).toContain('## Files written or edited')
    expect(w.clears).toBe(1)
  })
})

describe('what never molts', () => {
  test("a subagent's turn (review focus 2)", async ($, on) => {
    const w = world(on, { files: { [H]: '#' } })
    at(w, 81)
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

describe('a /clear that never clears', () => {
  // Another plugin can answer /clear with { text }: the call resolves, and no SessionStart follows.
  test('the next prompt lifts the molt in flight; a later /clear of yours seeds nothing', async ($, on) => {
    const w = world(on, { files: { [H]: '#' } })
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(1)
    await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
    at(w, 85)
    expect((await $.tool.call({ tool: 'Read', file_path: '/repo/a' } as never)).deny).toBeDefined()
    w.session.id = 's2'
    await $.classic.SessionStart(CLEAR('s2'))
    expect(w.prompts.some(p => p.includes(H))).toBe(false)
  })
  test('a clear that never cleared is not counted as a molt', async ($, on) => {
    const w = world(on, { files: { [H]: '#' } })
    at(w, 67)
    for (let i = 0; i < 3; i++) await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(3)
    expect(w.toasts.some(t => t.includes('molt paused'))).toBe(false)
  })
  test('the next turn end lifts it too, and can molt again', async ($, on) => {
    const w = world(on, { files: { [H]: '#' } })
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(2)
  })
})

describe('loop guards', () => {
  test('manual: the third molt in a row with no message pauses', async ($, on) => {
    const w = world(on, { files: { [H]: '#' } })
    at(w, 67)
    for (const id of ['s1', 's2']) {
      w.clearTo.push(`${id}x`)
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
    at(w, 67)
    for (const id of ['s1', 's2', 's3']) {
      w.clearTo.push(`${id}x`)
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
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(0)
    expect(w.runs.some(argv => argv.join(' ').includes('ring-me'))).toBe(true)
  })
  test('autopilot: /molt now lifts a no-progress pause and the molt goes ahead', async ($, on) => {
    const w = world(on, { files: { [H]: '#', ...AUTOPILOT, '/home/u/.claude/state/molt/lineage/s1.json': '{"from":"s0","chain":"s0","depth":1,"handoff":"/h0.md"}' } })
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(0)
    await $.command.run({ command: 'molt', args: 'now', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)
    await $.prompt.submit({ text: w.fills.at(-1) ?? '', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(1)
  })
  test('autopilot: a staged write below soft is no progress', async ($, on) => {
    const w = world(on, { files: { [H]: '#', ...AUTOPILOT, '/home/u/.claude/state/molt/lineage/s1.json': '{"from":"s0","chain":"s0","depth":1,"handoff":"/h0.md"}' } })
    w.staged = true
    await $.tool.call({ tool: 'Write', file_path: '/repo/x.ts', content: 'x' })
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(0)
  })
  test('autopilot: writing and committing only the handoff past soft is no progress', async ($, on) => {
    const w = world(on, { files: { [H]: '#', ...AUTOPILOT, '/home/u/.claude/state/molt/lineage/s1.json': '{"from":"s0","chain":"s0","depth":1,"handoff":"/h0.md"}' } })
    at(w, 67)
    await $.tool.call({ tool: 'Write', file_path: H, content: '# h' })
    await $.tool.call({ tool: 'Bash', command: `git add ${H} && git commit -F /tmp/m` })
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(0)
    expect(w.runs.some(argv => argv.join(' ').includes('ring-me'))).toBe(true)
  })
  test('autopilot: with progress the molt goes ahead (control)', async ($, on) => {
    const w = world(on, { files: { [H]: '#', ...AUTOPILOT,
      '/home/u/.claude/state/molt/lineage/s1.json': '{"from":"s0","chain":"s0","depth":1,"handoff":"/h0.md"}' } })
    await $.tool.call({ tool: 'Bash', command: 'git add a && git commit -F /tmp/m' })
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(1)
  })
  test('autopilot: a head-wrapped commit is progress, so the molt goes ahead (#711)', async ($, on) => {
    const w = world(on, { files: { [H]: '#', ...AUTOPILOT,
      '/home/u/.claude/state/molt/lineage/s1.json': '{"from":"s0","chain":"s0","depth":1,"handoff":"/h0.md"}' } })
    await $.tool.call({ tool: 'Bash', command: 'if git commit -m m; then :; fi' })
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(1)
  })
  test('autopilot: a path-qualified head word committing is no progress (control)', async ($, on) => {
    const w = world(on, { files: { [H]: '#', ...AUTOPILOT,
      '/home/u/.claude/state/molt/lineage/s1.json': '{"from":"s0","chain":"s0","depth":1,"handoff":"/h0.md"}' } })
    await $.tool.call({ tool: 'Bash', command: '/x/if git commit -m m' })
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.clears).toBe(0)
    expect(w.runs.some(argv => argv.join(' ').includes('ring-me'))).toBe(true)
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
  test('arms the Stop reflex between the warnings and the command (PR #670 review)', async ($, on) => {
    const w = world(on)
    at(w, 45)
    await $.command.run(NOW)
    expect((await $.classic.Stop(STOP)).block).toContain('MOLT-HANDOFF:')
  })
  test('arms the Stop reflex below soft', async ($, on) => {
    const w = world(on)
    at(w, 10)
    await $.command.run(NOW)
    expect((await $.classic.Stop(STOP)).block).toContain('MOLT-HANDOFF:')
  })
})
