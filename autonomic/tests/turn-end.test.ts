import { describe, test, expect } from 'claude-code/testing'
import { ledgerLines, world } from './world'

const AP = { AUTONOMIC_MODE: 'autopilot' }
const STOP = (msg = 'Shall I proceed with step 3?') => ({ stop_hook_active: false, last_assistant_message: msg, session_id: 's1' }) as never
const fork = (o: object) => ({ isAnswered: true as const, text: JSON.stringify(o) })
const tool = (name = 'Edit') => ({ tool: name, file_path: '/repo/a.ts' }) as never

describe('the turn-end reflex (spec §3.1)', () => {
  test('an answer ending in a period gets one period before Proceed (#677 F8)', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ case: 'covered', question: 'Proceed?', answer: 'use ciao.', reason: 'plan' }))
    expect((await $.classic.Stop(STOP())).block).toBe('Autopilot: use ciao. Proceed.')
  })
  test('a stalled next step ending in a period gets one period (#677 F8)', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ case: 'stalled', next_step: 'run the suite.', reason: 'plan' }))
    expect((await $.classic.Stop(STOP('I wrote the file.'))).block).toBe('Autopilot: continue — run the suite.')
  })
  test('each fork is logged (#677 F4)', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ case: 'waiting', reason: 'bg' }))
    await $.classic.Stop(STOP())
    expect(w.files.get('/home/u/.claude/state/autonomic/autonomic.log') ?? '').toContain('fork turn-end session=s1')
  })
  test('molt says command: stand aside below yieldAtPercent (#677 F12)', async ($, on) => {
    const w = world(on, { env: AP, files: { '/home/u/.claude/state/molt/stage/s1': '{"stage":"command","command":20}' } })
    w.usage = { tokens: 150_000, window: 1_000_000 }
    expect((await $.classic.Stop(STOP())).block).toBeUndefined()
    expect(w.forkPrompts).toEqual([])
    expect(ledgerLines(w).at(-1)).toContain(' · molt · ')
  })
  test('molt says warn: judge the turn end even above yieldAtPercent (#677 F12)', async ($, on) => {
    const w = world(on, { env: AP, files: { '/home/u/.claude/state/molt/stage/s1': '{"stage":"warn","command":80}' } })
    w.usage = { tokens: 700_000, window: 1_000_000 }
    w.forks.push(fork({ case: 'covered', question: 'Proceed?', answer: 'yes', reason: 'plan' }))
    expect((await $.classic.Stop(STOP())).block).toBe('Autopilot: yes. Proceed.')
  })
  test('molt off: no fill fallback (#677 F12)', async ($, on) => {
    const w = world(on, { env: AP, files: { '/home/u/.claude/state/molt/stage/s1': '{"stage":"off"}' } })
    w.usage = { tokens: 700_000, window: 1_000_000 }
    w.forks.push(fork({ case: 'covered', question: 'Proceed?', answer: 'yes', reason: 'plan' }))
    expect((await $.classic.Stop(STOP())).block).toBe('Autopilot: yes. Proceed.')
  })
  test('no stage file: the yieldAtPercent fallback stands (#677 F12)', async ($, on) => {
    const w = world(on, { env: AP })
    w.usage = { tokens: 700_000, window: 1_000_000 }
    expect((await $.classic.Stop(STOP())).block).toBeUndefined()
    expect(w.forkPrompts).toEqual([])
  })
  test('an unreadable stage file is no file: the yieldAtPercent fallback stands (#677 F12)', async ($, on) => {
    const w = world(on, { env: AP, files: { '/home/u/.claude/state/molt/stage/s1': '{"stage":' } })
    w.usage = { tokens: 700_000, window: 1_000_000 }
    expect((await $.classic.Stop(STOP())).block).toBeUndefined()
    expect(w.forkPrompts).toEqual([])
  })
  test("another session's stage file never yields this one (Review Focus 1)", async ($, on) => {
    const w = world(on, { env: AP, files: { '/home/u/.claude/state/molt/stage/s0': '{"stage":"command"}' } })
    w.forks.push(fork({ case: 'covered', question: 'Proceed?', answer: 'yes', reason: 'plan' }))
    expect((await $.classic.Stop(STOP())).block).toBe('Autopilot: yes. Proceed.')
  })
  test('covered: block with the answer; ledger line with usage', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ case: 'covered', question: 'Proceed with step 3?', answer: 'yes, run step 3', reason: 'plan step 3' }))
    const r = await $.classic.Stop(STOP())
    expect(r.block).toBe('Autopilot: yes, run step 3. Proceed.')
    expect(ledgerLines(w).at(-1)).toMatch(/ · s1 · covered · Q: Proceed with step 3\? · A: yes, run step 3 · why: plan step 3 · usage: in=1000 cached=50000 out=40$/)
  })
  test('stalled: block with the next step', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ case: 'stalled', next_step: 'run the suite', reason: 'plan' }))
    expect((await $.classic.Stop(STOP('I wrote the file.'))).block).toBe('Autopilot: continue — run the suite.')
  })
  test('waiting: stop, no ledger line', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ case: 'waiting', reason: 'background suite' }))
    expect((await $.classic.Stop(STOP())).block).toBeUndefined()
    expect(ledgerLines(w)).toEqual([])
  })
  test('done: stop, ledger line, toast', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ case: 'done', reason: 'objective met' }))
    expect((await $.classic.Stop(STOP())).block).toBeUndefined()
    expect(ledgerLines(w).at(-1)).toContain(' · done · ')
    expect(w.toasts.at(-1)).toContain('done')
  })
  test('pain: stop, band, bell, pain file, ledger', async ($, on) => {
    const w = world(on, { env: { ...AP, AUTONOMIC_BELL: 'ring-it', AUTONOMIC_PAIN_PATH: '/run/r.md.autonomic-pain' } })
    w.forks.push(fork({ case: 'pain', question: 'Which pricing model?', reason: 'product ambiguity' }))
    expect((await $.classic.Stop(STOP())).block).toBeUndefined()
    expect(JSON.stringify(w.notices.at(-1))).toContain('Which pricing model?')
    expect(w.runs.some(r => r[0] === 'sh' && (r[2] ?? '').includes('ring-it'))).toBe(true)
    expect(w.files.get('/run/r.md.autonomic-pain')).toMatch(/^\S+ pain autopilot: pain — Which pricing model\?\n$/)
    expect(ledgerLines(w).at(-1)).toContain(' · pain · ')
  })
  test('manual: no fork at all', async ($, on) => {
    const w = world(on)
    await $.classic.Stop(STOP())
    expect(w.forkPrompts).toEqual([])
  })
  test('nothing to fork: stop, no pain, no ledger (review focus 1)', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push({ isAnswered: false, reason: 'nothing-to-fork' })
    expect((await $.classic.Stop(STOP())).block).toBeUndefined()
    expect(w.notices).toEqual([])
    expect(ledgerLines(w)).toEqual([])
  })
  test('one retry on junk, then pain', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push({ isAnswered: true, text: 'junk' }, fork({ case: 'stalled', next_step: 'go on', reason: 'r' }))
    expect((await $.classic.Stop(STOP())).block).toContain('go on')
    w.forks.push({ isAnswered: true, text: 'junk' }, { isAnswered: false, reason: 'api-error' })
    await $.tool.call(tool())
    expect((await $.classic.Stop(STOP())).block).toBeUndefined()
    expect(JSON.stringify(w.notices.at(-1))).toContain('fork failed')
  })
  test('the fork prompt quotes only the tail', async ($, on) => {
    const w = world(on, { env: AP })
    w.forks.push(fork({ case: 'waiting', reason: 'r' }))
    await $.classic.Stop(STOP(`${'a'.repeat(5000)}TAIL`))
    expect(w.forkPrompts[0]).toContain('TAIL')
    expect(w.forkPrompts[0]).not.toContain('a'.repeat(4001))
  })
  test('ledger failure: manual, and the block is not returned (review focus 3)', async ($, on) => {
    const w = world(on, { env: AP })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    w.failAppend = /ledger\.md$/
    w.forks.push(fork({ case: 'covered', answer: 'yes', reason: 'r' }))
    expect((await $.classic.Stop(STOP())).block).toBeUndefined()
    expect(w.statuses.at(-1)).toBe('autopilot: ledger not writable')
  })
})

describe('the molt floor and blocks beneath (amendment A2, plan decision 4)', () => {
  test('a MOLT-HANDOFF line: no fork, no block, a molt ledger line', async ($, on) => {
    const w = world(on, { env: AP })
    expect((await $.classic.Stop(STOP('done\nMOLT-HANDOFF: /h.md'))).block).toBeUndefined()
    expect(w.forkPrompts).toEqual([])
    expect(ledgerLines(w).at(-1)).toContain(' · molt · ')
  })
  test("a child's status file past the command: no fork", async ($, on) => {
    const w = world(on, { env: { ...AP, MOLT_STATUS_PATH: '/run/r.md.molt-status' }, files: { '/run/r.md.molt-status': 'T warned 40\nT handoff required\n' } })
    await $.classic.Stop(STOP())
    expect(w.forkPrompts).toEqual([])
  })
  test('a status file at a warning only: the reflex runs (control)', async ($, on) => {
    const w = world(on, { env: { ...AP, MOLT_STATUS_PATH: '/run/s' }, files: { '/run/s': 'T warned 40\n' } })
    w.forks.push(fork({ case: 'waiting', reason: 'r' }))
    await $.classic.Stop(STOP())
    expect(w.forkPrompts).toHaveLength(1)
  })
  test('a block beneath: kept as is, no fork', async ($, on) => {
    const w = world(on, { env: AP })
    w.stopBlock = 'molt: write your handoff now'
    expect((await $.classic.Stop(STOP())).block).toBe('molt: write your handoff now')
    expect(w.forkPrompts).toEqual([])
  })
})

describe('the loop guard (spec §3.1)', () => {
  test('after loopMax pushes with no change, the next turn end is pain', async ($, on) => {
    const w = world(on, { env: AP })
    for (let i = 0; i < 3; i++) {
      w.forks.push(fork({ case: 'stalled', next_step: 'go', reason: 'r' }))
      expect((await $.classic.Stop(STOP())).block).toBeDefined()
    }
    expect((await $.classic.Stop(STOP())).block).toBeUndefined()
    expect(JSON.stringify(w.notices.at(-1))).toContain('autopilot loop')
  })
  test('a change resets the count; a read does not', async ($, on) => {
    const w = world(on, { env: AP })
    for (let i = 0; i < 3; i++) {
      w.forks.push(fork({ case: 'stalled', next_step: 'go', reason: 'r' }))
      await $.tool.call(tool(i === 2 ? 'Edit' : 'Read'))
      await $.classic.Stop(STOP())
    }
    w.forks.push(fork({ case: 'stalled', next_step: 'go', reason: 'r' }))
    expect((await $.classic.Stop(STOP())).block).toBeDefined()
  })
  test('a denied tool call is no change', async ($, on) => {
    const w = world(on, { env: AP })
    w.toolDeny = 'seat-mods: no'
    for (let i = 0; i < 3; i++) {
      w.forks.push(fork({ case: 'stalled', next_step: 'go', reason: 'r' }))
      await $.tool.call(tool())
      await $.classic.Stop(STOP())
    }
    expect((await $.classic.Stop(STOP())).block).toBeUndefined()
  })
  test("the operator's prompt resets the count", async ($, on) => {
    const w = world(on, { env: AP })
    for (let i = 0; i < 3; i++) {
      w.forks.push(fork({ case: 'stalled', next_step: 'go', reason: 'r' }))
      await $.classic.Stop(STOP())
    }
    await $.prompt.submit({ text: 'keep going', wait: false, origin: { kind: 'composer' } } as never)
    w.forks.push(fork({ case: 'stalled', next_step: 'go', reason: 'r' }))
    expect((await $.classic.Stop(STOP())).block).toBeDefined()
  })
})
