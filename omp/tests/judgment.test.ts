// Result validation, acceptance rules, the monotonic budget, frame capture and native judgment
// (Plan Task 4 §6 Step 1). Pure literals and the shared fixture; every SDK import is type-only.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import type { JudgmentRequest, Questions, Usage } from '@oh-my-pi/pi-ai'
import type { ExtensionJudgment } from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types'
import { acceptedChoice, acceptedNoul, captureFrame, DecisionBudget, judgeNative, parsePolicyBundle, validateAnswers } from '../../autonomic/omp/judgment'
import type { DecisionFrame, PolicyBundle } from '../../autonomic/omp/judgment'
import { shownInput } from '../../autonomic/hooks/prompts'
import { fixturePolicy, fixtureUsage, neutralizeSeatRole, restoreSeatRole, routingWorld } from './judgment-world'
import type { RoutingWorld } from './judgment-world'

beforeEach(neutralizeSeatRole)
afterAll(restoreSeatRole)

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

type PermissionQuestions = { permission: { type: 'choice'; instructions: string; criteria: { allow: null; ask: null } } }
const request = (): JudgmentRequest<PermissionQuestions> => ({
  state: { fixture: 'result-validation' },
  questions: { permission: { type: 'choice' as const, instructions: 'Fixture.', criteria: { allow: null, ask: null } } },
})
const result = (over: Record<string, unknown> = {}): ExtensionJudgment<PermissionQuestions> => ({
  judgment: { api: 'openrouter-decisions', provider: 'openrouter', model: 'fixture-response',
    answers: { permission: { type: 'choice' as const, choice: 'allow', probabilities: { allow: 1, ask: 0 }, confidence: 1 } },
    usage: fixtureUsage(1, 1) },
  route: { requestId: 'fixture-request', purpose: 'extension:fixture:autonomic.permission:fixture-request',
    selected: { api: 'openrouter-decisions', provider: 'openrouter', model: 'fixture-selected' },
    questions: 1, cachedQuestions: 0 },
  ...over,
}) as ExtensionJudgment<PermissionQuestions>

const validate = (r: unknown) => () => validateAnswers(request(), r as ExtensionJudgment<PermissionQuestions>)

describe('validateAnswers — exact IDs, types, labels, distributions and route facts', () => {
  test('the plan\'s malformed case: a plausible allow label with an incomplete distribution is rejected', () => {
    const req = { state: { fixture: 'result-validation' }, questions: {
      permission: { type: 'choice' as const, instructions: 'Fixture.', criteria: { allow: null, ask: null } },
    } }
    const res = {
      judgment: { api: 'openrouter-decisions', provider: 'openrouter', model: 'fixture-response',
        answers: { permission: { type: 'choice' as const, choice: 'allow', probabilities: { allow: 1 }, confidence: 1 } },
        usage: fixtureUsage(1, 1) },
      route: { requestId: 'fixture-request', purpose: 'extension:fixture:autonomic.permission:fixture-request',
        selected: { api: 'openrouter-decisions', provider: 'openrouter', model: 'fixture-selected' },
        questions: 1, cachedQuestions: 0 },
    }
    expect(() => validateAnswers(req, res as unknown as ExtensionJudgment<typeof req.questions>)).toThrow()
  })
  test('a clean result validates', () => { expect(validate(result())).not.toThrow() })
  test('a missing answer ID is rejected', () => {
    expect(validate({ ...result(), judgment: { ...result().judgment, answers: {} } })).toThrow()
  })
  test('an extra answer ID is rejected', () => {
    const j = result().judgment as { answers: Record<string, unknown> }
    expect(validate({ ...result(), judgment: { ...j, answers: { ...j.answers, other: { type: 'noul', noul: 1 } } } })).toThrow()
  })
  test('a noul answer for a choice question is rejected', () => {
    const j = result().judgment as { answers: Record<string, unknown> }
    expect(validate({ ...result(), judgment: { ...j, answers: { permission: { type: 'noul', noul: 1 } } } })).toThrow()
  })
  test('a choice answer for a noul question is rejected', () => {
    const req: JudgmentRequest<Questions> = { state: { f: 1 }, questions: { q: { type: 'noul', instructions: 'F.' } } }
    const res = { judgment: { api: 'openrouter-decisions', provider: 'p', model: 'm',
      answers: { q: { type: 'choice', choice: 'yes', probabilities: { yes: 1 }, confidence: 1 } }, usage: fixtureUsage(1, 1) },
      route: { requestId: 'r', purpose: 'p', selected: { api: 'openrouter-decisions', provider: 'p', model: 'm' }, questions: 1, cachedQuestions: 0 } }
    expect(() => validateAnswers(req, res as unknown as ExtensionJudgment<Questions>)).toThrow()
  })
  const badDistribution: Array<[string, Record<string, unknown>]> = [
    ['an unknown choice label', { choice: 'maybe', probabilities: { allow: 1, ask: 0 }, confidence: 1 }],
    ['a negative probability', { choice: 'allow', probabilities: { allow: -0.1, ask: 1.1 }, confidence: 1 }],
    ['NaN', { choice: 'allow', probabilities: { allow: NaN, ask: 1 }, confidence: 1 }],
    ['Infinity', { choice: 'allow', probabilities: { allow: Infinity, ask: 0 }, confidence: 1 }],
    ['an out-of-range probability', { choice: 'allow', probabilities: { allow: 1.5, ask: -0.5 }, confidence: 1 }],
    ['wrong distribution keys', { choice: 'allow', probabilities: { allow: 1, ask: 0, extra: 0 }, confidence: 1 }],
    ['a sum outside the tolerance', { choice: 'allow', probabilities: { allow: 0.5, ask: 0.4 }, confidence: 1 }],
    ['a confidence above 1', { choice: 'allow', probabilities: { allow: 1, ask: 0 }, confidence: 1.0001 }],
    ['a tied maximum', { choice: 'allow', probabilities: { allow: 0.5, ask: 0.5 }, confidence: 0.5 }],
  ]
  for (const [name, answer] of badDistribution) {
    test(`${name} is rejected`, () => {
      const j = result().judgment as { answers: Record<string, unknown> }
      expect(validate({ ...result(), judgment: { ...j, answers: { permission: { type: 'choice', ...answer } } } })).toThrow()
    })
  }
  const badRoute: Array<[string, unknown]> = [
    ['an unknown native API kind', { ...result().route, selected: { api: 'chat', provider: 'openrouter', model: 'fixture-selected' } }],
    ['a non-integer question count', { ...result().route, questions: 1.5 }],
    ['a negative cached count', { ...result().route, cachedQuestions: -1 }],
    ['more cached than questions', { ...result().route, cachedQuestions: 2 }],
    ['a cached count that does not match the frozen questions', { ...result().route, questions: 2, cachedQuestions: 1 }],
  ]
  for (const [name, route] of badRoute) test(`${name} is rejected`, () => { expect(validate({ ...result(), route })).toThrow() })
})

describe('acceptedChoice / acceptedNoul — operator-supplied boundaries, never a default', () => {
  const choice = (probabilities: Record<string, number>, c = 1) => ({ type: 'choice' as const, choice: 'allow', probabilities, confidence: c })
  test('accepts a unique maximum that meets the rule', () => {
    expect(acceptedChoice(choice({ allow: 0.7, ask: 0.3 }, 0.7), { minProbability: 0.5, minConfidence: 0.5 })).toBe('allow')
  })
  test('rejects the same answer when the rule is not met (boundary just above the achieved value)', () => {
    expect(acceptedChoice(choice({ allow: 0.7, ask: 0.3 }, 0.7), { minProbability: 0.7 + 1e-9, minConfidence: 0.5 })).toBeUndefined()
  })
  test('accepts at exactly the achieved value', () => {
    expect(acceptedChoice(choice({ allow: 0.7, ask: 0.3 }, 0.7), { minProbability: 0.7, minConfidence: 0.7 })).toBe('allow')
  })
  test('a tied maximum is never accepted', () => {
    expect(acceptedChoice(choice({ allow: 0.5, ask: 0.5 }, 0.5), { minProbability: 0, minConfidence: 0 })).toBeUndefined()
  })
  test('an invalid choice rule is rejected', () => {
    expect(() => acceptedChoice(choice({ allow: 1, ask: 0 }), { minProbability: 1.5, minConfidence: 0 })).toThrow()
  })
  const noul = (noul: number) => ({ type: 'noul' as const, noul })
  test('P(yes) at the minYes boundary is yes', () => { expect(acceptedNoul(noul(0.8), { minYes: 0.8, minNo: 0.8 })).toBe('yes') })
  test('P(no) at the minNo boundary is no', () => {
    expect(acceptedNoul(noul(0.2), { minYes: 0.8, minNo: 0.8 })).toBe('no') // P(no)=0.8 meets minNo
  })
  test('an overlapping rule (minYes+minNo <= 1) is rejected as invalid configuration', () => {
    // A yes-region [minYes,1] and no-region [0,1-minNo] overlap exactly when minYes+minNo <= 1.
    expect(() => acceptedNoul(noul(0.5), { minYes: 0.5, minNo: 0.5 })).toThrow()
    expect(() => acceptedNoul(noul(0.5), { minYes: -0.1, minNo: 0.5 })).toThrow()
  })
  test('a non-finite noul is rejected', () => { expect(() => acceptedNoul({ type: 'noul', noul: NaN } as never, { minYes: 0.5, minNo: 0.5 })).toThrow() })
})

describe('DecisionBudget — one monotonic deadline, no phase creates a fresh 25 s', () => {
  test('remaining computes each phase cutoff from the entry time', () => {
    const t = performance.now()
    const b = new DecisionBudget(t)
    expect(Math.round(b.remaining('capture') / 100)).toBe(20)  // 2000 ms
    expect(b.remaining('native')).toBeLessThanOrEqual(10_000)  // min(10000, 12000, 25000)
    expect(Math.round(b.remaining('generation') / 100)).toBe(100) // min(10000, 22000, 25000)
    expect(Math.round(b.remaining('final') / 100)).toBe(250)   // 25000
  })
  test('run returns the value of a fast call and checks again after it', async () => {
    const b = new DecisionBudget(performance.now())
    expect(await b.run('capture', async () => 7)).toBe(7)
  })
  test('run rejects when the phase allowance is already exhausted', async () => {
    const b = new DecisionBudget(performance.now() - 3000)
    await expect(b.run('capture', async () => 1)).rejects.toThrow('decision deadline')
  })
  test('a call that never settles settles at the phase allowance, not a fresh 25 s', async () => {
    const b = new DecisionBudget(performance.now() - 9_900)  // ~2.1 s of native left, not 25 s
    const t = Date.now()
    await expect(b.run('native', () => new Promise<never>(() => {}))).rejects.toThrow()
    expect(Date.now() - t).toBeLessThan(5_000)
  })
  test('cancel aborts total work; a subsequent run rejects', async () => {
    const b = new DecisionBudget(performance.now())
    b.cancel()
    await expect(b.run('capture', async () => 1)).rejects.toThrow()
  })
  test('an inherited abort rejects the phase', async () => {
    const c = new AbortController()
    const b = new DecisionBudget(performance.now(), c.signal)
    const p = b.run('capture', signal => {
      const { promise, reject } = Promise.withResolvers<number>()
      signal.addEventListener('abort', () => reject(new Error('gone')), { once: true })
      return promise
    })
    c.abort()
    await expect(p).rejects.toThrow()
  })
  test('the native phase is capped under the total as well as its own cutoff', () => {
    const b = new DecisionBudget(performance.now() - 11_000) // capture/native cutoff passed
    expect(b.remaining('native')).toBeLessThanOrEqual(1_000)
  })
})

describe('captureFrame — 64,000 JS code units, exact identity, frozen state', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  test('a shown input at the 64,000-code-unit boundary is accepted; one over is rejected', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    // A plain ASCII string renders as `"…"`: the quotes are the only extra code units, so
    // 63,998 x's are exactly 64,000 shown code units and 63,999 are 64,001.
    const ok = 'x'.repeat(63_998), over = 'x'.repeat(63_999)
    expect(shownInput(ok)).toHaveLength(64_000)
    expect(shownInput(over)).toHaveLength(64_001)
    const frame = await captureFrame(w.decisions, performance.now(), 'permission', ok)
    expect(frame.shownInput).toBe(shownInput(ok))
    expect(frame.inputSha256).toBe(sha256(JSON.stringify(ok)))
    await expect(captureFrame(w.decisions, performance.now(), 'permission', over)).rejects.toThrow()
  })
  test('a multibyte input measures code units, not bytes', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    // 21,333 × '界' is 21,333 code units but 64,000 UTF-8 bytes; it must be accepted as shown input.
    const input = '界'.repeat(21_333)
    expect(shownInput(input).length).toBeLessThan(64_000)
    const frame = await captureFrame(w.decisions, performance.now(), 'permission', input)
    expect(frame.shownInput).toBe(shownInput(input))
  })
  test('the frame carries the captured host, the lease, the facts and the derived inputShape', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    const input = { command: 'git status' }
    const frame = await captureFrame(w.decisions, performance.now(), 'permission', input)
    expect(frame.consumer).toBe('permission')
    expect(frame.host.sessionId).toBe('S1')
    expect(frame.lease.sessionId).toBe('S1')
    expect(frame.facts.worktree).toBe(w.tree)
    expect(frame.inputShape).toBe('git status')
    expect(Object.isFrozen(frame)).toBe(true)
    // Identity is the compact JSON of the judged input, not the pretty shown rendering.
    expect(frame.inputSha256).toBe(sha256(JSON.stringify(input)))
    expect(frame.inputSha256).not.toBe(sha256(frame.shownInput))
  })
})

describe('judgeNative — one host call, lease checked before and after', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })
  const frameFor = async (): Promise<DecisionFrame> => captureFrame(w.decisions, performance.now(), 'permission', { command: 'git status' })

  test('passes the exact purpose, native-only and the remaining native budget to the host', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    let seen: { purpose?: string; nativeOnly?: boolean; timeoutMs?: number; signal?: AbortSignal } = {}
    w.setNative(async (req, opts) => { seen = opts; return result() as never })
    await judgeNative(await frameFor(), request())
    expect(seen.purpose).toBe('autonomic.permission')
    expect(seen.nativeOnly).toBe(true)
    expect(seen.timeoutMs).toBeLessThanOrEqual(10_000)
    expect(seen.signal).toBeInstanceOf(AbortSignal)
  })
  test('the purpose is namespaced to the frame\'s own consumer, not a fixed one', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    let seen = ''
    w.setNative(async (req, opts) => { seen = opts.purpose; return result() as never })
    const frame = await captureFrame(w.decisions, performance.now(), 'turn-end', { lastReply: 'x' })
    await judgeNative(frame, request())
    expect(seen).toBe('autonomic.turn-end')
  })
  test('a selected tuple absent from the policy routes is rejected', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    w.setNative(async () => ({ ...result(), route: { ...result().route, selected: { api: 'openrouter-decisions', provider: 'other', model: 'other' } } }) as never)
    await expect(judgeNative(await frameFor(), request())).rejects.toThrow()
  })
  test('a policy route whose calibrationRef has no matching evidence disables capture', async () => {
    const policy: PolicyBundle = { ...fixturePolicy(), evidence: [] }
    w = routingWorld({ grants: [], policy })
    await expect(frameFor()).rejects.toThrow()
  })
  test('a revoked authority during the native call is caught before the result is returned', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    w.setNative(async () => { w.revoke(); return result() as never })
    await expect(judgeNative(await frameFor(), request())).rejects.toThrow()
  })
  test('no host judge is a hard failure, never a chat fallback', async () => {
    w = routingWorld({ grants: [], policy: fixturePolicy() })
    await expect(judgeNative(await frameFor(), request())).rejects.toThrow()
  })
})

describe('parsePolicyBundle — malformed or unapproved policy disables the route', () => {
  test('a well-formed bundle round-trips', () => { expect(parsePolicyBundle(JSON.stringify(fixturePolicy())).version).toBe(1) })
  test('unknown keys, a bad acceptance range and a duplicate key are rejected', () => {
    const p = fixturePolicy()
    expect(() => parsePolicyBundle(JSON.stringify({ ...p, extra: 1 }))).toThrow()
    expect(() => parsePolicyBundle(JSON.stringify({ ...p, acceptance: { ...p.acceptance, permission: { minProbability: 2, minConfidence: 0 } } }))).toThrow()
    expect(() => parsePolicyBundle('{"version":1,"version":1}')).toThrow()
  })
  test('a route with a calibrationRef that has no evidence is rejected', () => {
    const p = fixturePolicy()
    expect(() => parsePolicyBundle(JSON.stringify({ ...p, evidence: [] }))).toThrow()
  })
})

describe('fixtureUsage', () => {
  test('is synthetic: token counts only, zero cost', () => {
    const u: Usage = fixtureUsage(3, 2)
    expect(u).toEqual({ input: 3, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })
  })
})
