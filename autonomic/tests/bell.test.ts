import { describe, test, expect } from 'claude-code/testing'
import { REC, world } from './world'

// autonomic rings a bell on the pain path (register.tsx `pain`) so an unattended operator
// learns a session stopped. molt stopped awaiting its copy in 0.2.3 (#665 item 4): a hung
// bell must not hold the hook that rang it for the engine's 30 s. It must still ring, with the
// same text, still bounded, still logging a failure once. The world answers the bell
// itself; `bellDelayMs` stands in for a bell that has not answered yet, and `runInits` is
// the only place a `timeoutMs` can be seen.
//
// #873 removed the turn-end reflex, so the trigger here is the ask reflex's free-text pain: a
// question with no options rings for the operator. The bell path itself is unchanged.

const sleep = (globalThis as unknown as { setTimeout: (f: (v?: unknown) => void, ms: number) => unknown }).setTimeout
const AP = { AUTONOMIC_MODE: 'autopilot', AUTONOMIC_PAIN_PATH: '/repo/.autonomic/pain.md' }
const ASK = { tool: 'AskUserQuestion', questions: [{ question: 'Which pricing model should I build?', header: 'P', multiSelect: false }] } as never
const BELL = { [REC()]: '{"mode":"autopilot","bell":"ring-me"}' }

// Used three times: a bell that is not awaited must still get to finish.
async function wait(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  sleep(resolve, ms)
  return promise
}

describe('the autopilot bell on the pain path (#718)', () => {
  test('a bell that has not answered does not hold the hook', async ($, on) => {
    const w = world(on, { env: AP, files: { ...BELL } })
    w.bellDelayMs = 500
    await $.tool.call(ASK)
    expect(w.bellRuns.length).toBe(1)      // the bell still rings
    expect(w.bellFinished).toBe(false)     // and the hook did not wait on it
    await wait(600)
    expect(w.bellFinished).toBe(true)      // not awaited is not the same as never run
  })

  test("the bell process is given the engine's 30 s bound, not a tighter one", async ($, on) => {
    const w = world(on, { env: AP, files: { ...BELL } })
    await $.tool.call(ASK)
    const i = w.runs.findIndex(argv => argv.join(' ').includes('ring-me'))
    expect(i).toBeGreaterThanOrEqual(0)
    // The same bound molt-v0.2.2 ran with (the engine's default when absent), stated
    // explicitly: no bell that completed before this fix is killed by it.
    expect(w.runInits[i]).toEqual({ timeoutMs: 30000 })
  })

  test('a bell that exits non-zero is logged once', async ($, on) => {
    const w = world(on, { env: AP, files: { ...BELL } })
    w.bellExit = 1
    await $.tool.call(ASK)
    await wait(10)   // the bell is not awaited on the branch
    expect(w.toasts.at(-1)).toContain('autopilot: question for you')
    // A non-zero exit resolves rather than rejects: nothing catches it unless ring looks.
    expect(w.runs.filter(argv => argv.join(' ').includes('bell failed exit=1')).length).toBe(1)
  })

  test('a bell that rejects is logged once', async ($, on) => {
    const w = world(on, { env: AP, files: { ...BELL } })
    w.failBell = true
    await $.tool.call(ASK)
    await wait(10)
    expect(w.bellRuns.length).toBe(1)
    expect(w.toasts.at(-1)).toContain('autopilot: question for you')
    expect(w.runs.filter(argv => argv.join(' ').includes('bell failed')).length).toBe(1)
  })

  test('the pain still lands: band, toast, pain file (control)', async ($, on) => {
    const w = world(on, { env: AP, files: { ...BELL } })
    await $.tool.call(ASK)
    await wait(10)
    expect(JSON.stringify(w.notices.at(-1))).toContain('autopilot: question for you')
    expect(w.toasts.at(-1)).toContain('autopilot: question for you')
    expect(w.files.get('/repo/.autonomic/pain.md') ?? '').toContain('pain ')
  })
})
