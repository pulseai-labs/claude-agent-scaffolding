import { describe, test, expect } from 'claude-code/testing'
import { world } from './world'

// The autopilot loop guard is the one pause that rings a bell (register.tsx `molt`). The
// bell is how an unattended operator learns the session paused, so it must not hold the
// turn end (#665 item 4) — and it must still ring, with the same text, still logging a
// failure once. The world answers the bell itself; `bellDelayMs` stands in for a bell that
// has not answered yet, and `runInits` is the only place a `timeoutMs` can be seen.

const sleep = (globalThis as unknown as { setTimeout: (f: (v?: unknown) => void, ms: number) => unknown }).setTimeout
const at = (w: ReturnType<typeof world>, percent: number) => { w.usage = { tokens: percent * 10_000, window: 1_000_000 } }
const TURN = (answer: string, extra: object = {}) =>
  ({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...extra }) as never
const H = '/repo/docs/handoff.md'
const AUTOPILOT = { '/home/u/.claude/state/autonomic/sessions/s1.json': '{"mode":"autopilot","bell":"ring-me"}' }
const NO_PROGRESS = { '/home/u/.claude/state/molt/lineage/s1.json': '{"from":"s0","chain":"s0","depth":1,"handoff":"/h0.md"}' }
const FILES = { [H]: '#', ...AUTOPILOT, ...NO_PROGRESS }

describe('the autopilot bell (#665 item 4)', () => {
  test('a bell that has not answered does not hold the turn end', async ($, on) => {
    const w = world(on, { files: { ...FILES } })
    w.bellDelayMs = 500
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.bellRuns.length).toBe(1)      // the bell still rings
    expect(w.bellFinished).toBe(false)     // and the hook did not wait on it
    await new Promise(resolve => sleep(resolve, 600))
    expect(w.bellFinished).toBe(true)      // not awaited is not the same as never run
    expect(w.runs.some(argv => argv.join(' ').includes('pause session='))).toBe(true)
  })

  test('the bell process is given the engine\'s 30 s bound, not a tighter one', async ($, on) => {
    const w = world(on, { files: { ...FILES } })
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    const i = w.runs.findIndex(argv => argv.join(' ').includes('ring-me'))
    expect(i).toBeGreaterThanOrEqual(0)
    // The same bound molt-v0.2.2 ran with (the engine's default when absent), stated
    // explicitly: no bell that completed on 0.2.2 is killed by this fix.
    expect(w.runInits[i]).toEqual({ timeoutMs: 30000 })
  })

  test('a bell that answers still rings with the pause text (control)', async ($, on) => {
    const w = world(on, { files: { ...FILES } })
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    expect(w.bellRuns.length).toBe(1)
    // The message the bell received is the pause text the operator sees, not a look-alike.
    expect(w.bellRuns.at(0)?.at(-1)).toBe(w.toasts.at(-1))
    expect(w.bellRuns.at(0)?.at(-1) ?? '').toContain('molt paused')
    expect(w.toasts.at(-1)).toContain('molt paused')
  })

  test('a bell that fails is still logged once, and the pause still lands (control)', async ($, on) => {
    const w = world(on, { files: { ...FILES } })
    w.failBell = true
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    await new Promise(resolve => sleep(resolve, 10))   // the bell is not awaited on the branch
    expect(w.bellRuns.length).toBe(1)
    expect(w.toasts.at(-1)).toContain('molt paused')
    expect(w.runs.filter(argv => argv.join(' ').includes('bell failed')).length).toBe(1)
  })

  test('a bell that exits non-zero is logged once (R3)', async ($, on) => {
    const w = world(on, { files: { ...FILES } })
    w.bellExit = 1
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    await new Promise(resolve => sleep(resolve, 10))   // the bell is not awaited on the branch
    expect(w.toasts.at(-1)).toContain('molt paused')
    // A non-zero exit resolves rather than rejects: nothing catches it unless ring looks.
    expect(w.runs.filter(argv => argv.join(' ').includes('bell failed exit=1')).length).toBe(1)
  })

  test('a bell that outruns its bound is killed and logged once (R5)', async ($, on) => {
    const w = world(on, { files: { ...FILES } })
    w.bellDelayMs = 31_000        // past the 30 s bound ring passes; the world rejects it
    at(w, 67)
    await $.turn.complete(TURN(`MOLT-HANDOFF: ${H}`))
    await new Promise(resolve => sleep(resolve, 10))
    expect(w.bellRuns.length).toBe(1)
    expect(w.bellFinished).toBe(false)                 // killed, never answered
    expect(w.toasts.at(-1)).toContain('molt paused')
    const killed = w.runs.filter(argv => argv.join(' ').includes('bell failed'))
    expect(killed.length).toBe(1)
    expect(killed.at(0)?.join(' ') ?? '').toContain('timed out after 30000ms')
  })
})
