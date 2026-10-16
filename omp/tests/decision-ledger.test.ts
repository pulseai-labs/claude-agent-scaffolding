// The two-write decision transaction (Plan Task 4 §6 Steps 1 and 4): real append writer, real temp
// files, a real frame from the real fixture. Every case asserts the observable outcome — what lands
// on disk, whether `io.fail` published manual/failure, and whether the caller may act — never the
// shape of the code that produced it.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitDecision } from '../../autonomic/omp/decision-ledger'
import { captureFrame, DecisionBudget } from '../../autonomic/omp/judgment'
import type { DecisionDraft, DecisionFrame, DecisionIO } from '../../autonomic/omp/judgment'
import { clockShift, fixturePolicy, neutralizeSeatRole, restoreSeatRole, routingWorld } from './judgment-world'
import type { RoutingWorld } from './judgment-world'

beforeEach(neutralizeSeatRole)
afterAll(restoreSeatRole)

const rows = [{ kase: 'permission' as const, q: 'Bash: git status', a: 'allow original call' }]
const draft = (over: Partial<DecisionDraft> = {}): DecisionDraft => ({
  outcome: 'allow', grantIds: [], evidenceIds: [], answers: {},
  route: null, response: null, payloadSource: { kind: 'deterministic', id: null }, reason: 'the fixture grant covers it', ...over,
})

type Acted = 'released' | 'abstained'
// The caller contract from Step 4: after commitDecision, check the budget and the lease freshly
// before acting. Anything changed while logging means abstain.
async function act(io: DecisionIO, frame: DecisionFrame, d: DecisionDraft): Promise<Acted> {
  try {
    await commitDecision(io, frame, d, rows)
  } catch {
    return 'abstained'
  }
  frame.budget.check()
  if (!frame.lease.fresh()) throw new Error('stale authority')
  return 'released'
}

function jsonl(w: RoutingWorld): Array<Record<string, unknown>> {
  const path = `${w.ledgerPath}.decisions.jsonl`
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)
}
const human = (w: RoutingWorld): string => existsSync(w.ledgerPath) ? readFileSync(w.ledgerPath, 'utf8') : ''
const frameOf = (w: RoutingWorld, input: unknown = { command: 'git status' }) => captureFrame(w.decisions, performance.now(), 'permission', input)
const withAppend = (w: RoutingWorld, appendLine: DecisionIO['appendLine']): DecisionIO => ({ ...w.decisions, appendLine })

describe('commitDecision — both writes land, one record, one human row', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  test('the JSONL record carries the plan schema, the lease-derived policy identity and the decisionId in the human row', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const frame = await frameOf(w)
    expect(await act(w.decisions, frame, draft())).toBe('released')
    const record = jsonl(w).at(-1)!
    expect(record).toMatchObject({ version: 1, decisionId: frame.id, sessionId: 'S1', consumer: 'permission',
      inputSha256: frame.inputSha256, inputShape: 'git status',
      authority: { assignmentId: 'fixture-assignment', generation: 1, sha256: frame.lease.binding.sha256 },
      policy: { id: frame.lease.snapshot.policy.id, sha256: frame.lease.policyDigest },
      outcome: 'allow', payloadSource: { kind: 'deterministic', id: null } })
    expect(human(w)).toContain(' · permission · ')
    expect(human(w)).toContain(`decisionId=${frame.id}`)
  })

  test('a native route and response are attributed, but the native usage is not billed again', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const frame = await frameOf(w)
    const d = draft({ route: { requestId: 'r', purpose: 'extension:x:autonomic.permission:r',
      selected: { api: 'openrouter-decisions', provider: 'openrouter', model: 'fixture-selected' }, questions: 1, cachedQuestions: 0 },
      response: { api: 'openrouter-decisions', provider: 'openrouter', model: 'fixture-response', usage: { input: 5, output: 2 } as never } })
    expect(await act(w.decisions, frame, d)).toBe('released')
    expect(jsonl(w).at(-1)!.response).toMatchObject({ model: 'fixture-response' })
    expect(human(w)).not.toContain('usage: in=')
  })

  test('a grant ID outside the current lease is refused', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const frame = await frameOf(w)
    expect(await act(w.decisions, frame, draft({ grantIds: ['not-in-lease'] }))).toBe('abstained')
    expect(w.notices.join('\n')).toContain('decision failure')
  })

  test('an evidence ID outside the current lease is refused', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const frame = await frameOf(w)
    expect(await act(w.decisions, frame, draft({ evidenceIds: ['not-in-lease'] }))).toBe('abstained')
  })
})

describe('commitDecision — required-write failure is operator handling, never a release', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  test('a human-ledger append that fails publishes manual/failure and releases nothing', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const frame = await frameOf(w)
    const io = withAppend(w, async path => path !== w.ledgerPath)
    expect(await act(io, frame, draft())).toBe('abstained')
    expect(w.notices.join('\n')).toContain('decision failure')
  })

  test('a sidecar append that fails publishes manual/failure and writes no human row', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const frame = await frameOf(w)
    const io = withAppend(w, async path => !path.endsWith('.decisions.jsonl'))
    expect(await act(io, frame, draft())).toBe('abstained')
    expect(w.notices.join('\n')).toContain('decision failure')
    expect(human(w)).not.toContain(`decisionId=${frame.id}`)
  })

  test('a token-shaped canary in the input and reason never reaches either file', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const frame = await frameOf(w, { command: `gh api --token ${token} repos/o/r` })
    const canary = draft({ reason: `the operator token ${token} is configured` })
    expect(await act(w.decisions, frame, canary)).toBe('released')
    const all = `${human(w)}\n${JSON.stringify(jsonl(w))}`
    expect(all).not.toContain(token)
    expect(all).toContain('***')
    expect(all).toContain(`decisionId=${frame.id}`)
  })

  test('an append that never settles fails the final phase, publishes manual/failure and releases nothing', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const frame = await frameOf(w)
    // Advance the clock so the final allowance is short; the never-settling append then settles at
    // the real-timer deadline, not after the whole 25 s window.
    const restore = clockShift(24_900)
    try {
      const io = withAppend(w, () => new Promise<boolean>(() => {}))
      const t = Date.now()
      expect(await act(io, frame, draft())).toBe('abstained')
      expect(Date.now() - t).toBeLessThan(5_000)
    } finally { restore() }
    expect(w.notices.join('\n')).toContain('decision failure')
  })
})

describe('commitDecision — a change while logging leaves stale authority', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  test('the snapshot replaced during the append makes the final freshness check fail', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const frame = await frameOf(w)
    const io = withAppend(w, async (path, line) => { if (path === w.ledgerPath) w.replace(); return w.decisions.appendLine(path, line) })
    expect(await act(io, frame, draft())).toBe('abstained')
    expect(w.notices.join('\n')).toContain('decision failure')
  })

  test('the snapshot revoked during the append makes the final freshness check fail', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const frame = await frameOf(w)
    const io = withAppend(w, async (path, line) => { if (path === w.ledgerPath) w.revoke(); return w.decisions.appendLine(path, line) })
    expect(await act(io, frame, draft())).toBe('abstained')
  })

  test('a late append after the deadline cannot make the caller act', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const frame = await frameOf(w)
    // The clock advances past the final window while the append is in flight, so the phase
    // deadline settles first. The write still lands (a late intent row), but the caller abstains.
    let restore: (() => void) | undefined
    const io = withAppend(w, async (path, line) => { restore ??= clockShift(30_000); return w.decisions.appendLine(path, line) })
    try {
      expect(await act(io, frame, draft())).toBe('abstained')
      expect(restore).toBeDefined()
      expect(w.notices.join('\n')).toContain('decision failure')
      // The partial sidecar row is an intent, never execution proof.
      expect(jsonl(w).every(r => r.outcome !== undefined)).toBe(true)
    } finally { restore?.() }
  })
})

describe('commitDecision — the two-write order and freshness checks are load-bearing', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  test('the sidecar is written before the human row', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const frame = await frameOf(w)
    const order: string[] = []
    const io = withAppend(w, async (path, line) => { order.push(path.endsWith('.decisions.jsonl') ? 'sidecar' : 'human'); return w.decisions.appendLine(path, line) })
    expect(await act(io, frame, draft())).toBe('released')
    expect(order).toEqual(['sidecar', 'human'])
  })

  test('a lease that is already stale before any write releases nothing and writes nothing', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const frame = await frameOf(w)
    w.revoke()
    expect(await act(w.decisions, frame, draft())).toBe('abstained')
    expect(human(w)).not.toContain(`decisionId=${frame.id}`)
  })

  test('a budget that is already elapsed releases nothing', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const frame = await frameOf(w)
    const restore = clockShift(30_000)
    try { expect(await act(w.decisions, frame, draft())).toBe('abstained') } finally { restore() }
    expect(human(w)).not.toContain(`decisionId=${frame.id}`)
  })
})

// A plain budget check for completeness: an elapsed budget rejects.
describe('DecisionBudget.check', () => {
  test('rejects once the total window has elapsed', () => {
    expect(() => new DecisionBudget(performance.now() - 30_000).check()).toThrow()
  })
})

// F1: the fixture must never write a real seat's pain file. A real fail path through the fixture
// points AUTONOMIC_PAIN_PATH at a file inside its own temp root, and one outside it is untouched.
describe('the fixture isolates the pain path', () => {
  test('a fail path writes its pain line to the fixture-local path, not the ambient one', async () => {
    const outside = join(tmpdir(), `real-pain-${process.pid}-${Date.now()}`)
    const saved = process.env.AUTONOMIC_PAIN_PATH
    process.env.AUTONOMIC_PAIN_PATH = outside
    const world = routingWorld({ grants: [], policy: fixturePolicy() })
    try {
      expect(world.painPath.startsWith(world.root + '/')).toBe(true)   // fixture-local, inside its temp root
      expect(process.env.AUTONOMIC_PAIN_PATH).toBe(world.painPath)     // the ambient value was overridden
      await world.decisions.fail('S1', 'fixture fail path')
      expect(readFileSync(world.painPath, 'utf8')).toContain('fixture fail path')
      expect(existsSync(outside)).toBe(false)                          // the ambient path received nothing
    } finally {
      // Close the world FIRST (it restores the value it captured), then restore the ambient value.
      world.close()
      if (saved === undefined) delete process.env.AUTONOMIC_PAIN_PATH; else process.env.AUTONOMIC_PAIN_PATH = saved
    }
  })

  test('close restores the ambient pain path exactly', () => {
    const saved = process.env.AUTONOMIC_PAIN_PATH
    process.env.AUTONOMIC_PAIN_PATH = '/tmp/ambient-pain-marker'
    const world = routingWorld({ grants: [], policy: fixturePolicy() })
    world.close()
    expect(process.env.AUTONOMIC_PAIN_PATH).toBe('/tmp/ambient-pain-marker')
    if (saved === undefined) delete process.env.AUTONOMIC_PAIN_PATH; else process.env.AUTONOMIC_PAIN_PATH = saved
  })
})

// F2: an automatic fall to manual is a mode change. It must abort outstanding frames, so a frame
// captured before the fall no longer passes freshness and commitDecision abstains.
describe('an automatic fall to manual aborts outstanding frames', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  test('a decision-failure fall makes an outstanding frame stale and commitDecision abstains', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    // Drive a handler that resolves the session record (modeOf → save, no autopilot) so live holds S1,
    // then capture a fresh frame and trigger the automatic fall to manual.
    await w.handlers.get('before_agent_start')?.({ systemPrompt: ['BASE'] }, w.ctx)
    const frame = await frameOf(w)
    expect(frame.lease.fresh()).toBe(true)
    await w.decisions.fail('S1', 'reproducing the verifier probe')
    expect(frame.lease.fresh()).toBe(false)
    expect(await act(w.decisions, frame, draft())).toBe('abstained')
  })

  test('the switch control still makes an outstanding frame stale (unchanged)', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    await w.handlers.get('before_agent_start')?.({ systemPrompt: ['BASE'] }, w.ctx)
    const frame = await frameOf(w)
    expect(frame.lease.fresh()).toBe(true)
    await w.switchTo('S2', 'new')
    expect(frame.lease.fresh()).toBe(false)
    expect(await act(w.decisions, frame, draft())).toBe('abstained')
  })
})
