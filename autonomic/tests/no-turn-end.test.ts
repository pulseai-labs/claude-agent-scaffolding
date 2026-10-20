import { describe, test, expect } from 'claude-code/testing'
import { ledgerLines, world } from './world'

// #873: autonomic never judges, blocks or continues a turn end on either host. The Claude Code
// Stop handler, its fork, the molt yield and the loop guard are gone (design §2.1–2.2, §5.1).
const AP = { AUTONOMIC_MODE: 'autopilot', AUTONOMIC_BELL: 'ring-me' }
const STOP = (msg = 'Shall I proceed?') =>
  ({ stop_hook_active: false, last_assistant_message: msg, session_id: 's1' }) as never

describe('no turn-end judge on Claude Code (#873)', () => {
  test('autopilot: a reply that ends on a question is not judged, not blocked, and rings nothing', async ($, on) => {
    const w = world(on, { env: AP })
    const r = await $.classic.Stop(STOP())
    expect(r.block).toBeUndefined()
    expect(w.forkPrompts).toEqual([])
    expect(w.completes).toEqual([])
    expect(ledgerLines(w)).toEqual([])
    expect(w.notices).toEqual([])
    expect(w.bellRuns).toEqual([])
  })
  test('autopilot at 90% context fill with no molt stage file: no block and no molt ledger line', async ($, on) => {
    const w = world(on, { env: AP })
    w.usage = { tokens: 900_000, window: 1_000_000 }
    const r = await $.classic.Stop(STOP())
    expect(r.block).toBeUndefined()
    expect(ledgerLines(w)).toEqual([])
  })
})
