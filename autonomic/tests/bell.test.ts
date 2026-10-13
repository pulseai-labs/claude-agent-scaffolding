import { describe, test, expect } from 'claude-code/testing'
import { REC, world } from './world'

// autonomic rings a bell on the pain path (register.tsx `pain`) so an unattended operator
// learns a session stopped. molt stopped awaiting its copy in 0.2.3 (#665 item 4): a hung
// bell must not hold the turn-end hook for the engine's 30 s. It must still ring, with the
// same text, still bounded, still logging a failure once. The world answers the bell
// itself; `bellDelayMs` stands in for a bell that has not answered yet, and `runInits` is
// the only place a `timeoutMs` can be seen.

const sleep = (globalThis as unknown as { setTimeout: (f: (v?: unknown) => void, ms: number) => unknown }).setTimeout
const AP = { AUTONOMIC_MODE: 'autopilot', AUTONOMIC_PAIN_PATH: '/repo/.autonomic/pain.md' }
const STOP = (msg = 'Which pricing model should I build?') =>
  ({ stop_hook_active: false, last_assistant_message: msg, session_id: 's1' }) as never
const fork = (o: object) => ({ isAnswered: true as const, text: JSON.stringify(o) })
const PAIN = fork({ case: 'pain', question: 'Which pricing model?', reason: 'product ambiguity' })
const BELL = { [REC()]: '{"mode":"autopilot","bell":"ring-me"}' }

describe('the autopilot bell on the pain path (#718)', () => {
  test('a bell that has not answered does not hold the turn end', async ($, on) => {
    const w = world(on, { env: AP, files: { ...BELL } })
    w.forks.push(PAIN)
    w.bellDelayMs = 500
    await $.classic.Stop(STOP())
    expect(w.bellRuns.length).toBe(1)      // the bell still rings
    expect(w.bellFinished).toBe(false)     // and the hook did not wait on it
    await new Promise(resolve => sleep(resolve, 600))
    expect(w.bellFinished).toBe(true)      // not awaited is not the same as never run
  })

  test("the bell process is given the engine's 30 s bound, not a tighter one", async ($, on) => {
    const w = world(on, { env: AP, files: { ...BELL } })
    w.forks.push(PAIN)
    await $.classic.Stop(STOP())
    const i = w.runs.findIndex(argv => argv.join(' ').includes('ring-me'))
    expect(i).toBeGreaterThanOrEqual(0)
    // The same bound molt-v0.2.2 ran with (the engine's default when absent), stated
    // explicitly: no bell that completed before this fix is killed by it.
    expect(w.runInits[i]).toEqual({ timeoutMs: 30000 })
  })

  test('a bell that exits non-zero is logged once', async ($, on) => {
    const w = world(on, { env: AP, files: { ...BELL } })
    w.forks.push(PAIN)
    w.bellExit = 1
    await $.classic.Stop(STOP())
    await new Promise(resolve => sleep(resolve, 10))   // the bell is not awaited on the branch
    expect(w.toasts.at(-1)).toContain('autopilot: pain')
    // A non-zero exit resolves rather than rejects: nothing catches it unless ring looks.
    expect(w.runs.filter(argv => argv.join(' ').includes('bell failed exit=1')).length).toBe(1)
  })

  test('a bell that rejects is logged once', async ($, on) => {
    const w = world(on, { env: AP, files: { ...BELL } })
    w.forks.push(PAIN)
    w.failBell = true
    await $.classic.Stop(STOP())
    await new Promise(resolve => sleep(resolve, 10))
    expect(w.bellRuns.length).toBe(1)
    expect(w.toasts.at(-1)).toContain('autopilot: pain')
    expect(w.runs.filter(argv => argv.join(' ').includes('bell failed')).length).toBe(1)
  })

  test('the pain still lands: band, toast, pain file (control)', async ($, on) => {
    const w = world(on, { env: AP, files: { ...BELL } })
    w.forks.push(PAIN)
    await $.classic.Stop(STOP())
    await new Promise(resolve => sleep(resolve, 10))
    expect((w.notices.at(-1) as { text?: string } | null)?.text ?? '').toContain('autopilot: pain')
    expect(w.toasts.at(-1)).toContain('autopilot: pain')
    expect(w.files.get('/repo/.autonomic/pain.md') ?? '').toContain('pain ')
  })
})
