import { describe, test, expect } from 'claude-code/testing'
import { world, flush, requests, CLEARED, COMPACT, READ } from './world'

const at = (w: ReturnType<typeof world>, percent: number) => { w.usage = { tokens: percent * 10_000, window: 1_000_000 } }
const TURN = (answer: string, extra: object = {}) => ({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...extra }) as never
const RUN = (args: string) =>
  ({ command: 'molt', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as never

describe('below soft', () => {
  test('nothing gates, nudges or blocks', async ($, on) => {
    const w = world(on); at(w, 30)
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
    expect((await $.tool.call(READ)).context).toBeUndefined()
    await $.turn.complete(TURN('done')); await flush()
    expect(requests(w)).toEqual([])
  })
  test('no figure: nothing gates (review focus 1)', async ($, on) => {
    const w = world(on); w.usage = { window: 0 }
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
    await $.turn.complete(TURN('done')); await flush()
    expect(requests(w)).toEqual([])
  })
})

describe('past soft', () => {
  test('one nudge after a tool result, never two', async ($, on) => {
    const w = world(on); at(w, 67)
    const first = await $.tool.call(READ)
    expect(first.context?.join('\n')).toContain('MOLT-HANDOFF:')
    const second = await $.tool.call(READ)
    expect(second.context).toBeUndefined()
  })
  test('two turn ends each submit the instruction, then the third molts on the fallback brief (#929)', async ($, on) => {
    const w = world(on); at(w, 67)
    await $.turn.complete(TURN('done')); await flush()
    expect(requests(w)).toHaveLength(1)
    await $.turn.complete(TURN('done')); await flush()
    expect(requests(w)).toHaveLength(2)
    expect(w.clears).toBe(0)
    await $.turn.complete(TURN('done')); await flush()
    expect(requests(w)).toHaveLength(2)
    expect(w.clears).toBe(1)
  })
  test('no request on an interrupted turn or a subagent turn (#929)', async ($, on) => {
    const w = world(on); at(w, 67)
    await $.turn.complete(TURN('done', { isAborted: true })); await flush()
    await $.turn.complete(TURN('done', { agentId: 'a1' })); await flush()
    expect(requests(w)).toEqual([])
  })
  test('a refused request is logged and the turn end still resolves (#929)', async ($, on) => {
    const w = world(on); at(w, 67)
    w.rejectSeeds = true
    expect((await $.turn.complete(TURN('done'))).text).toBe('done')
    await flush()
    expect(requests(w)).toEqual([])
    expect(w.runs.filter(r => r.join(' ').includes('request failed'))).toHaveLength(1)
  })
  test('a reply that carries the marker is not blocked', async ($, on) => {
    const w = world(on, { files: { '/r/h.md': '#' } }); at(w, 67)
    await $.turn.complete(TURN('ok\nMOLT-HANDOFF: /r/h.md')); await flush()
    expect(requests(w)).toEqual([])
  })
  test('a /clear of your own resets the stage: no figure afterwards gates nothing', async ($, on) => {
    const w = world(on); at(w, 85)
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeDefined()
    await $.session.end(CLEARED('s1'))
    w.session.id = 's2'
    w.usage = { window: 1_000_000 }
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
  })
  test('a resume in place resets the stage too (#929)', async ($, on) => {
    const w = world(on); at(w, 85)
    expect((await $.tool.call(READ)).deny).toBeDefined()
    await $.session.end({ reason: 'resume', sessionId: 's1', resume: { sessionId: 's1' } } as never)
    w.session.id = 's2'
    w.usage = { window: 1_000_000 }
    expect((await $.tool.call(READ)).deny).toBeUndefined()
  })
  test("a subagent's compaction keeps the main window's requests spent (#929)", async ($, on) => {
    const w = world(on); at(w, 67)
    await $.turn.complete(TURN('done')); await $.turn.complete(TURN('done')); await flush()
    await $.session.compact({ trigger: 'auto', agentId: 'a1', messages: [{ role: 'user', text: 'x', toolUses: [] }] } as never)
    w.clearTo.push('s2')
    await $.turn.complete(TURN('done')); await flush()
    expect(requests(w)).toHaveLength(2)
    expect(w.clears).toBe(1)
  })
  test('after /compact the nudge and both requests come back', async ($, on) => {
    const w = world(on); at(w, 67)
    await $.turn.complete(TURN('done')); await $.turn.complete(TURN('done')); await flush()
    expect(requests(w)).toHaveLength(2)
    await $.session.compact(COMPACT)
    await $.turn.complete(TURN('done')); await flush()
    expect(requests(w)).toHaveLength(3)
    expect(w.clears).toBe(0)
  })
  test('a marker that names a directory is blocked like a missing file', async ($, on) => {
    const w = world(on); w.dirs.add('/r/docs'); at(w, 67)
    await $.turn.complete(TURN('ok\nMOLT-HANDOFF: /r/docs')); await flush()
    expect(requests(w).at(-1)).toContain('/r/docs')
  })
  test('a marker that names a missing file is blocked with its path (review focus 4)', async ($, on) => {
    const w = world(on); at(w, 67)
    await $.turn.complete(TURN('ok\nMOLT-HANDOFF: /r/typo.md')); await flush()
    expect(requests(w).at(-1)).toContain('/r/typo.md does not exist')
  })
  test('reads still run past soft (control for the hard gate)', async ($, on) => {
    const w = world(on); at(w, 70)
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
  })
})

describe('past hard', () => {
  test('a read is refused with the hard note; the handoff tools run', async ($, on) => {
    const w = world(on); at(w, 76)
    const r = await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)
    expect(r.deny).toContain("past molt's block threshold")
    expect((await $.tool.call({ tool: 'Write', file_path: '/r/h.md', content: 'x' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'git add h.md && git commit -F /tmp/m' } as never)).deny).toBeUndefined()
  })
  test("a subagent's call is never gated (review focus 2)", async ($, on) => {
    const w = world(on); at(w, 76)
    const r = await $.tool.call({ tool: 'Read', file_path: '/r/a', agentId: 'a1' } as never)
    expect(r.deny).toBeUndefined()
  })
  test('/molt off lifts the gate', async ($, on) => {
    const w = world(on); at(w, 76)
    await $.command.run(RUN('off'))
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
  })
  test('/molt off also silences the nudge and the request', async ($, on) => {
    const w = world(on); at(w, 76)
    await $.command.run(RUN('off'))
    expect((await $.tool.call(READ)).context).toBeUndefined()
    await $.turn.complete(TURN('done')); await flush()
    expect(requests(w)).toEqual([])
  })
  test('unmeasured tool output counts toward the gate', async ($, on) => {
    const w = world(on); at(w, 74)
    w.toolText = 'x'.repeat(4 * 20_000)
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/a' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Read', file_path: '/r/b' } as never)).deny).toContain("past molt's block threshold")
  })
  test('a head-wrapped add/commit sequence runs past the block (#711)', async ($, on) => {
    const w = world(on); at(w, 76)
    expect((await $.tool.call({ tool: 'Bash', command: 'if git add h.md; then git commit -F /tmp/m; fi' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: '{ git add h.md; git commit -F /tmp/m; }' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: '! git commit -F /tmp/m' } as never)).deny).toBeUndefined()
  })
  test('the gate still refuses what the walk exposes (#711 controls)', async ($, on) => {
    const w = world(on); at(w, 76)
    expect((await $.tool.call({ tool: 'Bash', command: 'if rm -rf x; then git commit -F /tmp/m; fi' } as never)).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: '/x/if git commit -F /tmp/m' } as never)).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'builtin git add h.md' } as never)).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: '{ }' } as never)).deny).toBeDefined()
  })
  test('a lone & past the block: every command in the line is checked (#711 review R1)', async ($, on) => {
    const w = world(on); at(w, 76)
    expect((await $.tool.call({ tool: 'Bash', command: 'git add f & evil' } as never)).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: '! git commit -m m & evil' } as never)).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: '{ git add f & evil; }' } as never)).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'if git add f & evil; then git commit -m m; fi' } as never)).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'git add f &evil' } as never)).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'git add f& evil' } as never)).deny).toBeDefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'git add f && git commit -F /tmp/m' } as never)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Bash', command: 'git commit -F /tmp/m 2>&1' } as never)).deny).toBeUndefined()
  })
})
