import { describe, test, expect } from 'claude-code/testing'
import { DEFAULT_POLICY } from '../hooks/policy'
import { LEDGER, POLICY, REC, world, COMPOSE } from './world'

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as never
const RUN = (args: string) => ({ command: 'autopilot', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as never
const SUBMIT = (kind = 'composer') => ({ text: 'go', wait: false, origin: { kind } }) as never
const rec = (w: ReturnType<typeof world>, id = 's1') => JSON.parse(w.files.get(REC(id)) ?? 'null')

describe('mode resolution (spec §1, amendment A1)', () => {
  test('first start writes the default policy; an existing one is never overwritten', async ($, on) => {
    const w = world(on, { noPolicy: true })
    await $.session.start(START)
    expect(w.files.get(POLICY)).toBe(DEFAULT_POLICY)
    w.files.set(POLICY, 'mine')
    await $.session.start(START)
    expect(w.files.get(POLICY)).toBe('mine')
  })
  test('AUTONOMIC_MODE=autopilot: autopilot, recorded with the env bell, ledger touched', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot', AUTONOMIC_BELL: 'ring' } })
    await $.session.start(START)
    expect(rec(w)).toEqual({ mode: 'autopilot', bell: 'ring', scope: [], source: 'env' })
    expect(w.statuses.at(-1)).toBe('autopilot')
    expect(w.files.has(LEDGER)).toBe(true)
  })
  test('unset: manual', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(rec(w).mode).toBe('manual')
    expect(w.statuses.at(-1)).toBe('manual')
  })
  test('an invalid value is manual and named on the status line', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'on' } })
    await $.session.start(START)
    expect(rec(w).mode).toBe('manual')
    expect(w.statuses.at(-1)).toBe('manual (AUTONOMIC_MODE="on" is not a mode)')
  })
  test('no policy: autopilot refuses', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    w.files.set(POLICY, '   ')
    await $.session.start(START)
    expect(rec(w).mode).toBe('manual')
    expect(w.statuses.at(-1)).toBe('autopilot: no policy')
  })
  test('ledger not writable: autopilot refuses', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    w.failTouch = /ledger\.md$/
    await $.session.start(START)
    expect(rec(w).mode).toBe('manual')
    expect(w.statuses.at(-1)).toBe('autopilot: ledger not writable')
  })
  test('a session record that cannot be written: autopilot refuses (PR #672 round 1)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    w.failWrite = /sessions\//
    await $.session.start(START)
    expect(w.statuses.at(-1)).toBe('autopilot: record not writable')
    const r = await $.command.run(RUN('on'))
    expect(r.text).toContain('record not writable')
  })
  test('off with a record that cannot be written says so (PR #672 round 2)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    await $.session.start(START)
    w.failWrite = /sessions\//
    const r = await $.command.run(RUN('off'))
    expect(r.text).toContain('could not be saved')
    expect(w.toasts.some(t => t.includes('could not be saved'))).toBe(true)
  })
  test('a manual session whose record cannot be written stays plain manual (control)', async ($, on) => {
    const w = world(on)
    w.failWrite = /sessions\//
    await $.session.start(START)
    expect(w.statuses.at(-1)).toBe('manual')
  })
  test('AUTONOMIC_LEDGER moves the ledger', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot', AUTONOMIC_LEDGER: '/ai/.autonomic/ledger.md' } })
    await $.session.start(START)
    expect(w.files.has('/ai/.autonomic/ledger.md')).toBe(true)
    expect(w.files.has(LEDGER)).toBe(false)
  })
  test('after a molt the record is copied from the lineage, scope and bell included', async ($, on) => {
    const w = world(on, { files: {
      [REC('s0')]: JSON.stringify({ mode: 'autopilot', bell: 'b', scope: ['/plan.md'], source: 'command' }),
      '/home/u/.claude/state/molt/lineage/s1.json': JSON.stringify({ from: 's0', chain: 's0', depth: 1, handoff: '/h.md' }),
    } })
    await $.session.start(START)
    expect(rec(w)).toEqual({ mode: 'autopilot', bell: 'b', scope: ['/plan.md'], source: 'lineage' })
  })
  test('a child with no lineage: env mode, empty scope, env bell (review focus 2)', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot', AUTONOMIC_BELL: 'b', MOLT_HANDOFF: 'parent' } })
    await $.session.start(START)
    expect(rec(w)).toEqual({ mode: 'autopilot', bell: 'b', scope: [], source: 'env' })
  })
  test('a carried scope is announced once, with the first prompt', async ($, on) => {
    const w = world(on, { files: {
      [REC('s0')]: JSON.stringify({ mode: 'autopilot', scope: ['/plan.md'], source: 'command' }),
      '/home/u/.claude/state/molt/lineage/s1.json': JSON.stringify({ from: 's0', chain: 's0', depth: 1, handoff: '/h.md' }),
    } })
    const first = await $.prompt.submit(SUBMIT('plugin'))
    expect((first.context ?? []).join('\n')).toContain('- /plan.md')
    const second = await $.prompt.submit(SUBMIT())
    expect(second.context ?? []).toEqual([])
  })
})

describe('/autopilot (spec §1)', () => {
  test('on with docs: autopilot, scope recorded, the scope message in the prompt box', async ($, on) => {
    const w = world(on, { files: { '/repo/plan.md': '#' } })
    await $.session.start(START)
    const r = await $.command.run(RUN('on plan.md'))
    expect(rec(w)).toEqual({ mode: 'autopilot', scope: ['/repo/plan.md'], source: 'command' })
    expect(w.fills.at(-1)).toContain('- /repo/plan.md')
    expect(r.text).toContain('Enter')
  })
  test('on with a missing doc changes nothing', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const r = await $.command.run(RUN('on nope.md'))
    expect(rec(w).mode).toBe('manual')
    expect(r.text).toContain('/repo/nope.md')
  })
  test('no prompt box: the scope rides the next prompt', async ($, on) => {
    const w = world(on, { files: { '/repo/plan.md': '#' } })
    w.hasBox = false
    await $.session.start(START)
    const r = await $.command.run(RUN('on plan.md'))
    expect(r.context?.join('\n')).toContain('- /repo/plan.md')
  })
  test('off beats the env for the rest of the session', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    await $.session.start(START)
    await $.command.run(RUN('off'))
    expect(rec(w)).toMatchObject({ mode: 'manual', source: 'command' })
    expect(w.statuses.at(-1)).toBe('manual')
  })
  test('on without a policy refuses and says how to fix it', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.files.set(POLICY, '')
    const r = await $.command.run(RUN('on'))
    expect(rec(w).mode).toBe('manual')
    expect(r.text).toContain('no policy')
  })
  test('status names mode, source, ledger and policy', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    await $.session.start(START)
    const r = await $.command.run(RUN('status'))
    for (const s of ['autopilot', 'env', LEDGER, POLICY]) expect(r.text).toContain(s)
  })
  test('anything else prints the usage', async ($, on) => {
    world(on)
    expect((await $.command.run(RUN('please'))).text).toContain('usage:')
  })
})

describe('policy injection (spec §1)', () => {
  test('autopilot appends one session section with the policy text', async ($, on) => {
    const w = world(on, { env: { AUTONOMIC_MODE: 'autopilot' } })
    await $.session.start(START)
    const r = await $.prompt.compose(COMPOSE)
    expect(r.sections.map(s => s.id)).toEqual(['intro', 'autonomic:policy'])
    expect(r.sections[1]).toEqual({ id: 'autonomic:policy', text: (w.files.get(POLICY) ?? '').trim(), scope: 'session' })
  })
  test('manual adds nothing', async ($, on) => {
    world(on)
    expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.id)).toEqual(['intro'])
  })
})
