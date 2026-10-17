// Exact-ID, all-question structured asks (Plan Task 6 §8, Steps 1–6). Every case drives the real
// factory through the shared fixture and asserts observable outcomes: whether the whole batch was
// answered, what the operator's dialog and the pain file show, how many native judgments ran and
// what landed in the two-write ledger. Every SDK/host import is `import type`: the CSA tree has no
// installed host package, so a value import would not resolve under plain bun.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JudgmentRequest, Question } from '@oh-my-pi/pi-ai'
import type { ExtensionJudgment } from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types'
import type { EvidenceMaterial, Grant } from '../../autonomic/hooks/authority'
import { assembleAsk, planAsk, snapshotAsk } from '../../autonomic/omp/asks'
import type { AskSnapshot } from '../../autonomic/omp/asks'
import { captureFrame, parsePolicyBundle } from '../../autonomic/omp/judgment'
import type { ApprovedQuestion, DecisionFrame, PolicyBundle } from '../../autonomic/omp/judgment'
import { fixturePolicy, fixtureUsage, neutralizeSeatRole, restoreSeatRole, routingWorld } from './judgment-world'
import type { RoutingWorld } from './judgment-world'

beforeEach(neutralizeSeatRole)
afterAll(restoreSeatRole)

const digest = (s: string): string => createHash('sha256').update(s).digest('hex')

// =====================================================================================
// The synthetic bounded evidence and the per-question approved policy
// =====================================================================================

const ASK_GRANT = 'fixture-ask'
const ASK_EVIDENCE = 'fixture-ask-evidence'
// The fixture issues this material as lease evidence (judgment-world.ts `material('fixture-brief', …)`).
const BRIEF = 'fixture-brief'
const ASK_TEXT = 'Synthetic approved task: the fixture-ask grant and its evidence cover reading the fixture worktree and answering this frozen question without a new decision.'
const REASON = `approved evidence ${BRIEF}@fixture-brief covers every question in the batch`

function askGrant(): Grant {
  return { id: ASK_GRANT, operation: 'worktree.read',
    resource: { kind: 'paths', repository: '/fixture/repo', roots: ['/fixture/tree'] },
    authorityRefs: ['fixture-approval'] }
}

type QSpec = {
  optionIds: string[]
  membership: Record<string, 'yes' | 'no'> | null
  gate?: ApprovedQuestion['operatorGate']
  requires?: Array<[string, string]>
  excludes?: Array<[string, string]>
  evidenceIds?: string[]
  grantIds?: string[]
}

// One ApprovedQuestion per input question, keyed by the snapshot's exact fingerprint. Its evidence
// material is synthetic and non-secret; its digest is computed from its own text.
function policyFor(input: unknown, specs: QSpec[]): PolicyBundle {
  const snapshot = snapshotAsk(input)
  const material: EvidenceMaterial = { ref: { id: ASK_EVIDENCE, source: join(tmpdir(), ASK_EVIDENCE),
    sha256: digest(ASK_TEXT), locator: 'fixture:ask' }, text: ASK_TEXT }
  const policy = fixturePolicy()
  policy.evidence.push(material)
  policy.approved.questions = snapshot.questions.map((q, i) => {
    const s = specs[i]!
    return { fingerprint: q.fingerprint, optionIds: s.optionIds, complete: true as const,
      evidenceIds: s.evidenceIds ?? [BRIEF, ASK_EVIDENCE], grantIds: s.grantIds ?? [ASK_GRANT],
      operatorGate: s.gate ?? 'none', membership: s.membership,
      requires: s.requires ?? [], excludes: s.excludes ?? [] }
  })
  return policy
}

// The plan's literal single-question helper (Plan Task 6 §8 Step 1).
function questionPolicy(input: unknown, optionIds: string[], membership: Record<string, 'yes' | 'no'> | null = null): PolicyBundle {
  return policyFor(input, [{ optionIds, membership }])
}

const PLAN = { questions: [{ id: 'q1', question: 'Which plan?', options: [{ label: 'Plan A' }, { label: 'Plan B' }] }] }
const TWO = { questions: [
  { id: 'q1', question: 'Which plan?', options: [{ label: 'Plan A' }, { label: 'Plan B' }] },
  { id: 'q2', question: 'Which scope?', options: [{ label: 'Core' }, { label: 'Edge' }] },
] }
const MULTI_INPUT = { questions: [{ id: 'm1', question: 'Which parts?', multi: true,
  options: [{ label: 'Alpha' }, { label: 'Beta' }, { label: 'Gamma' }] }] }
const ALL3 = ['o0', 'o1', 'o2']

function askWorld(policy: PolicyBundle, grants: Grant[] = [askGrant()]): RoutingWorld {
  return routingWorld({ grants, policy, mode: 'autopilot' })
}

// =====================================================================================
// The native batch: one answer per frozen question, built from the request it is handed
// =====================================================================================

const questionAt = (request: JudgmentRequest, id: string): Question | undefined => request.questions[id]

function criteriaOf(request: JudgmentRequest, id: string): Record<string, string | null> {
  const q = questionAt(request, id)
  if (q === undefined || q.type !== 'choice') throw new Error(`expected a choice question ${id}`)
  return q.criteria
}

// The request state narrowed for assertions (a JSON object, never read through a fabricated shape).
function stateOf(request: JudgmentRequest): Record<string, unknown> {
  const raw: unknown = request.state
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('expected an object state')
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) out[k] = v
  return out
}

const noul = (yes: number) => ({ type: 'noul' as const, noul: yes })
function choice(request: JudgmentRequest, id: string, label: string, probability = 1, confidence = 1) {
  const keys = Object.keys(criteriaOf(request, id))
  const probabilities: Record<string, number> = {}
  for (const k of keys) probabilities[k] = k === label ? probability : (1 - probability) / (keys.length - 1)
  return { type: 'choice' as const, choice: label, probabilities, confidence }
}
// Every frozen question answered positively: coverage yes, membership yes, first option selected.
function allYes(request: JudgmentRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const id of Object.keys(request.questions)) {
    const q = questionAt(request, id)!
    out[id] = q.type === 'noul' ? noul(1) : choice(request, id, Object.keys(criteriaOf(request, id))[0]!)
  }
  return out
}
const override = (request: JudgmentRequest, over: Record<string, unknown>): Record<string, unknown> => ({ ...allYes(request), ...over })
// Answer every membership question from a pinned map (1 = yes, 0 = no), so a test states the set
// it means rather than relying on a blanket yes.
function membershipAnswers(request: JudgmentRequest, questionId: string, pinned: Record<string, 'yes' | 'no'>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [option, verdict] of Object.entries(pinned)) out[member(questionId, option)] = noul(verdict === 'yes' ? 1 : 0)
  return out
}

const cover = (id: string) => `cover:${encodeURIComponent(id)}`
const select = (id: string) => `select:${encodeURIComponent(id)}`
const member = (id: string, option: string) => `member:${encodeURIComponent(id)}:${option}`

// The whole envelope the fixture's native callback returns; `answers` is the only substitution.
function envelope(request: JudgmentRequest, answers: Record<string, unknown>): ExtensionJudgment<typeof request.questions> {
  const result = { judgment: { api: 'openrouter-decisions', provider: 'openrouter', model: 'fixture-response', answers, usage: fixtureUsage(1, 1) },
    route: { requestId: 'fixture-request', purpose: 'extension:fixture:autonomic.ask:fixture-request',
      selected: { api: 'openrouter-decisions', provider: 'openrouter', model: 'fixture-selected' },
      questions: Object.keys(request.questions).length, cachedQuestions: 0 } }
  // The fixture callback is typed by the host extension bridge; this literal mirrors its envelope.
  return result as unknown as ExtensionJudgment<typeof request.questions>
}

function setNativeBatch(w: RoutingWorld, build: (request: JudgmentRequest) => Record<string, unknown>): void {
  w.setNative(async (request: JudgmentRequest) => envelope(request, build(request)))
}

// =====================================================================================
// Observations
// =====================================================================================

const sidecar = (w: RoutingWorld): Array<Record<string, unknown>> => {
  const path = `${w.ledgerPath}.decisions.jsonl`
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>) : []
}
const human = (w: RoutingWorld): string => existsSync(w.ledgerPath) ? readFileSync(w.ledgerPath, 'utf8') : ''
const pain = (w: RoutingWorld): string => w.painLines().join('\n')

// =====================================================================================
// Step 1 — the plan's two verbatim cases (with a positive control beside them)
// =====================================================================================

describe('the plan\'s verbatim cases (Plan Task 6 §8 Step 1)', () => {
  test('distinct IDs with duplicate question text cannot overwrite an answer', () => {
    expect(() => snapshotAsk({questions:[
      {id:'left',question:'Choose scope?',options:[{label:'Alpha'},{label:'Beta'}]},
      {id:'right',question:'Choose scope?',options:[{label:'Alpha'},{label:'Beta'}]},
    ]})).toThrow();
  });
  test('an actual repeated host ID is invalid even when question text differs', () => {
    expect(() => snapshotAsk({questions:[
      {id:'same',question:'First?',options:[{label:'Alpha'}]},
      {id:'same',question:'Second?',options:[{label:'Beta'}]},
    ]})).toThrow();
  });

  test('a valid two-question batch snapshots with both exact IDs and both option labels', () => {
    const s = snapshotAsk(TWO)
    expect(s.questions.map(q => q.id)).toEqual(['q1', 'q2'])
    expect(s.questions.map(q => q.question)).toEqual(['Which plan?', 'Which scope?'])
    expect(s.questions[0]!.options).toEqual([
      { id: 'o0', label: 'Plan A', description: undefined },
      { id: 'o1', label: 'Plan B', description: undefined },
    ])
    expect(s.inputSha256).toBe(digest(JSON.stringify(TWO)))
  })
})

// =====================================================================================
// Step 3 — snapshot: identity, labels, fingerprints
// =====================================================================================

describe('snapshotAsk', () => {
  test('the legacy single form derives a request-local ordinal ID bound to the full input digest', () => {
    const input = { question: 'Solo?', options: [{ label: 'x' }] }
    expect(snapshotAsk(input).questions[0]!.id).toBe(`legacy:${digest(JSON.stringify(input))}:0`)
  })

  test('a legacy questions array with no IDs gets one ordinal ID per question, bound to the input digest', () => {
    const input = { questions: [{ question: 'A?', options: [{ label: 'x' }] }, { question: 'B?', options: [{ label: 'y' }] }] }
    const ids = snapshotAsk(input).questions.map(q => q.id)
    expect(ids).toEqual([`legacy:${digest(JSON.stringify(input))}:0`, `legacy:${digest(JSON.stringify(input))}:1`])
  })

  test('label bytes are retained, and the request-local option IDs are ordinals, never labels', () => {
    const s = snapshotAsk({ questions: [{ id: 'q', question: 'Which?', options: ['Alpha', { label: '  spaced  ' }] }] })
    expect(s.questions[0]!.options).toEqual([
      { id: 'o0', label: 'Alpha', description: undefined },
      { id: 'o1', label: '  spaced  ', description: undefined },
    ])
  })

  test('a header, description, multi and an in-range recommended position are kept', () => {
    const s = snapshotAsk({ questions: [{ id: 'q', question: 'Which?', header: 'H', multi: true, recommended: 1,
      options: [{ label: 'x', description: 'dx' }, { label: 'y', description: 'dy' }] }] })
    expect(s.questions[0]).toMatchObject({ header: 'H', multi: true, recommended: 1,
      options: [{ id: 'o0', label: 'x', description: 'dx' }, { id: 'o1', label: 'y', description: 'dy' }] })
  })

  test('the fingerprint binds content, not the question identity', () => {
    const at = (id: string, extra: Record<string, unknown> = {}) =>
      snapshotAsk({ questions: [{ id, question: 'Which?', options: [{ label: 'x', description: 'd' }], ...extra }] }).questions[0]!.fingerprint
    expect(at('left')).toBe(at('right'))                                     // same content, different ID
    const plain = snapshotAsk({ questions: [{ id: 'q', question: 'Which?', options: [{ label: 'x' }] }] }).questions[0]!.fingerprint
    const other = snapshotAsk({ questions: [{ id: 'q', question: 'Other?', options: [{ label: 'x', description: 'd' }] }] }).questions[0]!.fingerprint
    const reordered = snapshotAsk({ questions: [{ id: 'q', question: 'Which?', options: [{ label: 'y', description: 'd' }, { label: 'x' }] }] }).questions[0]!.fingerprint
    expect(at('q')).not.toBe(plain)                                          // a description changes the frozen content
    expect(at('q')).not.toBe(other)
    expect(at('q')).not.toBe(at('q', { multi: true }))
    expect(at('q')).not.toBe(at('q', { recommended: 0 }))
    expect(reordered).not.toBe(at('q'))                                      // option order is part of the frozen shape
    // The request-local ordinal IDs are part of the representation, so an option list that gains a
    // member changes the fingerprint.
    expect(snapshotAsk({ questions: [{ id: 'q', question: 'Which?', options: [{ label: 'x' }, { label: 'z' }] }] }).questions[0]!.fingerprint)
      .not.toBe(snapshotAsk({ questions: [{ id: 'q', question: 'Which?', options: [{ label: 'x' }] }] }).questions[0]!.fingerprint)
  })

  test('the snapshot is a clone: later mutation of the input cannot change it', () => {
    const input = { questions: [{ id: 'q', question: 'Which?', options: [{ label: 'Alpha' }] }] }
    const s = snapshotAsk(input)
    input.questions[0]!.options[0]!.label = 'Mutated'
    input.questions[0]!.question = 'Mutated?'
    expect(s.questions[0]!.question).toBe('Which?')
    expect(s.questions[0]!.options[0]!.label).toBe('Alpha')
  })

  const rejected: Array<[string, unknown]> = [
    ['a non-object input', 'junk'],
    ['a null input', null],
    ['no question at all', {}],
    ['an empty questions array', { questions: [] }],
    ['a question that is not an object', { questions: [null] }],
    ['a question with no text', { questions: [{ id: 'q', options: [{ label: 'x' }] }] }],
    ['a question whose text is only whitespace', { questions: [{ id: 'q', question: '  ', options: [{ label: 'x' }] }] }],
    ['question text the consumer map would trim', { questions: [{ id: 'q', question: 'Which? ', options: [{ label: 'x' }] }] }],
    ['an empty supplied ID', { questions: [{ id: '', question: 'Q?', options: [{ label: 'x' }] }] }],
    ['a non-string supplied ID', { questions: [{ id: 7, question: 'Q?', options: [{ label: 'x' }] }] }],
    ['no options (free text)', { questions: [{ id: 'q', question: 'Which token?' }] }],
    ['an empty options array', { questions: [{ id: 'q', question: 'Q?', options: [] }] }],
    ['an option with no label', { questions: [{ id: 'q', question: 'Q?', options: [{ description: 'd' }] }] }],
    ['an empty option label', { questions: [{ id: 'q', question: 'Q?', options: [{ label: '' }] }] }],
    ['a non-string option label', { questions: [{ id: 'q', question: 'Q?', options: [{ label: 7 }] }] }],
    ['a non-string option description', { questions: [{ id: 'q', question: 'Q?', options: [{ label: 'x', description: 7 }] }] }],
    ['duplicate label bytes within one question', { questions: [{ id: 'q', question: 'Q?', options: [{ label: 'Alpha' }, { label: 'Alpha' }] }] }],
    ['a non-boolean multi', { questions: [{ id: 'q', question: 'Q?', multi: 'yes', options: [{ label: 'x' }] }] }],
    ['an empty header', { questions: [{ id: 'q', question: 'Q?', header: '', options: [{ label: 'x' }] }] }],
    ['a recommended position past the end', { questions: [{ id: 'q', question: 'Q?', recommended: 1, options: [{ label: 'x' }] }] }],
    ['a non-integer recommended position', { questions: [{ id: 'q', question: 'Q?', recommended: 0.5, options: [{ label: 'x' }] }] }],
    ['a comma-bearing label of a multi question', { questions: [{ id: 'q', question: 'Q?', multi: true, options: [{ label: 'A, B' }, { label: 'C' }] }] }],
    ['a whitespace-padded label of a multi question', { questions: [{ id: 'q', question: 'Q?', multi: true, options: [{ label: ' C ' }, { label: 'D' }] }] }],
    ['duplicate question text across two questions', { questions: [{ id: 'a', question: 'Q?', options: [{ label: 'x' }] }, { id: 'b', question: 'Q?', options: [{ label: 'y' }] }] }],
  ]
  for (const [name, input] of rejected) {
    test(`${name} is rejected rather than silently dropped`, () => {
      expect(() => snapshotAsk(input)).toThrow()
    })
  }

  test('a comma-bearing label is fine for a single-select question (no joined representation)', () => {
    expect(snapshotAsk({ questions: [{ id: 'q', question: 'Q?', options: [{ label: 'A, B' }] }] }).questions[0]!.options[0]!.label).toBe('A, B')
  })
})

// =====================================================================================
// Step 3 — planAsk: the exact ID mapping and the required records
// =====================================================================================

describe('planAsk', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  async function frameFor(input: unknown, policy: PolicyBundle, grants: Grant[] = [askGrant()]): Promise<DecisionFrame> {
    w = askWorld(policy, grants)
    return captureFrame(w.decisions, performance.now(), 'ask', input)
  }

  test('the protocol is the exact mapping table, with one required record per question and option', async () => {
    const frame = await frameFor(TWO, policyFor(TWO, [{ optionIds: ['o0'], membership: null }, { optionIds: ['o1'], membership: null }]))
    const plan = planAsk(snapshotAsk(TWO), frame)
    expect(Object.keys(plan.request.questions)).toEqual(['cover:q1', 'select:q1', 'cover:q2', 'select:q2'])
    expect(plan.request.questions[cover('q1')]).toMatchObject({ type: 'noul' })
    expect(criteriaOf(plan.request, select('q1'))).toEqual({ o0: expect.any(String), o1: expect.any(String) })
    expect(plan.required).toEqual([
      { id: cover('q1'), questionId: 'q1', kind: 'coverage', optionId: null },
      { id: select('q1'), questionId: 'q1', kind: 'selection', optionId: null },
      { id: cover('q2'), questionId: 'q2', kind: 'coverage', optionId: null },
      { id: select('q2'), questionId: 'q2', kind: 'selection', optionId: null },
    ])
  })

  test('a multi question gets one membership question per option, in input order', async () => {
    const frame = await frameFor(MULTI_INPUT, policyFor(MULTI_INPUT, [{ optionIds: ALL3, membership: { o0: 'yes', o1: 'no', o2: 'yes' } }]))
    const plan = planAsk(snapshotAsk(MULTI_INPUT), frame)
    expect(Object.keys(plan.request.questions)).toEqual([cover('m1'), member('m1', 'o0'), member('m1', 'o1'), member('m1', 'o2')])
    expect(plan.request.questions[member('m1', 'o1')]).toMatchObject({ type: 'noul' })
    expect(plan.required.map(r => r.kind)).toEqual(['coverage', 'membership', 'membership', 'membership'])
    expect(plan.required.map(r => r.optionId)).toEqual([null, 'o0', 'o1', 'o2'])
  })

  test('the frozen state carries the ground facts and no membership map', async () => {
    const policy = policyFor(MULTI_INPUT, [{ optionIds: ALL3, membership: { o0: 'no', o1: 'yes', o2: 'no' } }])
    const frame = await frameFor(MULTI_INPUT, policy)
    const plan = planAsk(snapshotAsk(MULTI_INPUT), frame)
    const state = stateOf(plan.request)
    expect(state.inputSha256).toBe(frame.inputSha256)
    expect(state.assignmentId).toBe('fixture-assignment')
    expect(state.questions).toEqual([{ id: 'm1', question: 'Which parts?', header: null, multi: true, recommended: null,
      options: [{ id: 'o0', label: 'Alpha', description: null }, { id: 'o1', label: 'Beta', description: null }, { id: 'o2', label: 'Gamma', description: null }] }])
    const serialized = JSON.stringify(state)
    expect(serialized).not.toContain('"yes"')
    expect(serialized).not.toContain('membership')
    expect(serialized).toContain(ASK_TEXT)
    expect(state.grants).toHaveLength(1)
  })

  test('a question the policy does not approve by fingerprint is not plannable', async () => {
    const frame = await frameFor(TWO, policyFor(PLAN, [{ optionIds: ['o0'], membership: null }]))
    expect(() => planAsk(snapshotAsk(TWO), frame)).toThrow(/approved question/)
  })

  test('an approved option the ask does not carry is not plannable', async () => {
    const frame = await frameFor(TWO, policyFor(TWO, [{ optionIds: ['o0', 'o7'], membership: null }, { optionIds: ['o0'], membership: null }]))
    expect(() => planAsk(snapshotAsk(TWO), frame)).toThrow(/does not carry/)
  })

  test('a question with no approved evidence or no live grant is not plannable', async () => {
    const noEvidence = await frameFor(PLAN, policyFor(PLAN, [{ optionIds: ['o0'], membership: null, evidenceIds: ['not-in-the-lease'] }]))
    expect(() => planAsk(snapshotAsk(PLAN), noEvidence)).toThrow(/approved evidence/)
    const noGrant = await frameFor(PLAN, policyFor(PLAN, [{ optionIds: ['o0'], membership: null, grantIds: ['no-such-grant'] }]))
    expect(() => planAsk(snapshotAsk(PLAN), noGrant)).toThrow(/live grant/)
  })

  test('a multi question needs membership for every option; a single-select must not carry one', async () => {
    const absent = await frameFor(MULTI_INPUT, policyFor(MULTI_INPUT, [{ optionIds: ALL3, membership: null }]))
    expect(() => planAsk(snapshotAsk(MULTI_INPUT), absent)).toThrow(/membership/)
    const partial = await frameFor(MULTI_INPUT, policyFor(MULTI_INPUT, [{ optionIds: ['o0', 'o1'], membership: { o0: 'yes', o1: 'no' } }]))
    expect(() => planAsk(snapshotAsk(MULTI_INPUT), partial)).toThrow(/membership/)
    const single = await frameFor(PLAN, policyFor(PLAN, [{ optionIds: ['o0'], membership: { o0: 'yes' } }]))
    expect(() => planAsk(snapshotAsk(PLAN), single)).toThrow(/membership/)
  })

  test('an approved question that itself carries an operator gate is not plannable', async () => {
    // parsePolicyBundle already refuses a gated bundle (bundle-level, Plan Task 6 §8 Step 6), so the
    // gate is re-checked on a captured frame that carries one: planAsk must refuse it too.
    const frame = await frameFor(PLAN, questionPolicy(PLAN, ['o0']))
    frame.policy.approved.questions[0]!.operatorGate = 'credential'
    expect(() => planAsk(snapshotAsk(PLAN), frame)).toThrow(/operator gate/)
  })

  test('coverage and selection are independent questions over the same frozen state', async () => {
    const frame = await frameFor(TWO, policyFor(TWO, [{ optionIds: ['o0'], membership: null }, { optionIds: ['o1'], membership: null }]))
    const plan = planAsk(snapshotAsk(TWO), frame)
    for (const [, q] of Object.entries(plan.request.questions)) {
      expect(q.instructions).not.toContain('if coverage')
      expect(q.instructions).not.toContain('preceding')
    }
    expect(plan.request.questions[cover('q2')]!.instructions).toContain('q2')
  })
})

// =====================================================================================
// Step 4 — assembleAsk: acceptance per question, not an average
// =====================================================================================

describe('assembleAsk acceptance', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  async function settled(input: unknown, policy: PolicyBundle, over: (request: JudgmentRequest) => Record<string, unknown>,
    grants: Grant[] = [askGrant()]) {
    w = askWorld(policy, grants)
    const frame = await captureFrame(w.decisions, performance.now(), 'ask', input)
    const snapshot: AskSnapshot = snapshotAsk(input)
    const plan = planAsk(snapshot, frame)
    return { frame, plan, result: envelope(plan.request, over(plan.request)) }
  }

  test('a complete grounded batch returns exact original labels with a real evidence reason', async () => {
    const { frame, plan, result } = await settled(TWO, policyFor(TWO, [{ optionIds: ['o0'], membership: null }, { optionIds: ['o1'], membership: null }]),
      request => override(request, { [select('q2')]: choice(request, select('q2'), 'o1') }))
    const answer = assembleAsk(plan, result, frame)
    expect(answer?.answers).toEqual({ 'Which plan?': 'Plan A', 'Which scope?': 'Edge' })
    expect(answer?.grantIds).toEqual([ASK_GRANT])
    expect(answer?.evidenceIds).toEqual([BRIEF])                      // the lease-resolvable subset
    expect(answer?.reason).toBe(REASON)
  })

  test('a coverage "no" fails the whole batch', async () => {
    const { frame, plan, result } = await settled(TWO, policyFor(TWO, [{ optionIds: ['o0'], membership: null }, { optionIds: ['o0'], membership: null }]),
      request => override(request, { [cover('q2')]: noul(0) }))
    expect(assembleAsk(plan, result, frame)).toBeUndefined()
  })

  test('a selection below its own calibrated rule fails the whole batch', async () => {
    const { frame, plan, result } = await settled(PLAN, questionPolicy(PLAN, ['o0']),
      request => override(request, { [select('q1')]: choice(request, select('q1'), 'o0', 0.6, 1) }))
    expect(assembleAsk(plan, result, frame)).toBeUndefined()
  })

  test('a selection that is not evidence-supported fails the whole batch', async () => {
    const { frame, plan, result } = await settled(PLAN, questionPolicy(PLAN, ['o1']),
      request => override(request, { [select('q1')]: choice(request, select('q1'), 'o0') }))
    expect(assembleAsk(plan, result, frame)).toBeUndefined()
  })

  test('a membership verdict that contradicts the pinned complete set fails the whole batch', async () => {
    const { frame, plan, result } = await settled(MULTI_INPUT, policyFor(MULTI_INPUT, [{ optionIds: ALL3, membership: { o0: 'yes', o1: 'no', o2: 'no' } }]),
      request => override(request, { [member('m1', 'o1')]: noul(1) }))
    expect(assembleAsk(plan, result, frame)).toBeUndefined()
  })

  test('a set member outside the approved supported options fails the whole batch', async () => {
    // membershipOf (parse time) keys membership exactly on optionIds, so the divergence this guard
    // covers is a frame whose approved options were narrowed after parse: a member the question no
    // longer supports must not be assembled.
    const pinned = { o0: 'yes' as const, o1: 'yes' as const, o2: 'no' as const }
    const { frame, plan, result } = await settled(MULTI_INPUT, policyFor(MULTI_INPUT, [{ optionIds: ALL3, membership: pinned }]),
      request => override(request, membershipAnswers(request, 'm1', pinned)))
    frame.policy.approved.questions[0]!.optionIds = ['o0']
    expect(assembleAsk(plan, result, frame)).toBeUndefined()
  })

  test('approved evidence that resolves only in the pinned bundle leaves no citable reason, so the ask stands down', async () => {
    const { frame, plan, result } = await settled(PLAN, policyFor(PLAN, [{ optionIds: ['o0'], membership: null, evidenceIds: [ASK_EVIDENCE] }]),
      request => allYes(request))
    expect(assembleAsk(plan, result, frame)).toBeUndefined()
  })

  test('an ambiguous membership verdict fails rather than being read as "no"', async () => {
    const { frame, plan, result } = await settled(MULTI_INPUT, policyFor(MULTI_INPUT, [{ optionIds: ALL3, membership: { o0: 'yes', o1: 'no', o2: 'no' } }]),
      request => override(request, { [member('m1', 'o0')]: noul(0.5) }))
    expect(assembleAsk(plan, result, frame)).toBeUndefined()
  })

  test('an empty assembled set fails the whole batch', async () => {
    const pinned = { o0: 'no' as const, o1: 'no' as const, o2: 'no' as const }
    const { frame, plan, result } = await settled(MULTI_INPUT, policyFor(MULTI_INPUT, [{ optionIds: ALL3, membership: pinned }]),
      request => override(request, membershipAnswers(request, 'm1', pinned)))
    expect(assembleAsk(plan, result, frame)).toBeUndefined()
  })

  test('a requires pair whose second option is absent fails; satisfied, it passes', async () => {
    const violatedPinned = { o0: 'yes' as const, o1: 'no' as const, o2: 'yes' as const }
    const violated = await settled(MULTI_INPUT, policyFor(MULTI_INPUT, [{ optionIds: ALL3,
      membership: violatedPinned, requires: [['o0', 'o1']] }]), request => override(request, membershipAnswers(request, 'm1', violatedPinned)))
    expect(assembleAsk(violated.plan, violated.result, violated.frame)).toBeUndefined()
    const satisfiedPinned = { o0: 'yes' as const, o1: 'yes' as const, o2: 'no' as const }
    const satisfied = await settled(MULTI_INPUT, policyFor(MULTI_INPUT, [{ optionIds: ALL3,
      membership: satisfiedPinned, requires: [['o0', 'o1']] }]), request => override(request, membershipAnswers(request, 'm1', satisfiedPinned)))
    expect(assembleAsk(satisfied.plan, satisfied.result, satisfied.frame)?.answers['Which parts?']).toBe('Alpha, Beta')
  })

  test('an excludes pair that is jointly selected fails; the honest single set passes', async () => {
    const jointPinned = { o0: 'yes' as const, o1: 'yes' as const, o2: 'no' as const }
    const joint = await settled(MULTI_INPUT, policyFor(MULTI_INPUT, [{ optionIds: ALL3,
      membership: jointPinned, excludes: [['o0', 'o1']] }]), request => override(request, membershipAnswers(request, 'm1', jointPinned)))
    expect(assembleAsk(joint.plan, joint.result, joint.frame)).toBeUndefined()
    const singlePinned = { o0: 'yes' as const, o1: 'no' as const, o2: 'no' as const }
    const single = await settled(MULTI_INPUT, policyFor(MULTI_INPUT, [{ optionIds: ALL3,
      membership: singlePinned }]), request => override(request, membershipAnswers(request, 'm1', singlePinned)))
    expect(assembleAsk(single.plan, single.result, single.frame)?.answers['Which parts?']).toBe('Alpha')
  })

  test('a membership answer for an option outside the frozen questions fails the batch', async () => {
    const { frame, plan, result } = await settled(PLAN, questionPolicy(PLAN, ['o0']),
      request => override(request, { 'member:q1:o0': noul(1) }))
    expect(assembleAsk(plan, result, frame)).toBeUndefined()
  })

  const malformed: Array<[string, (request: JudgmentRequest) => Record<string, unknown>]> = [
    ['a missing coverage answer', request => { const a = allYes(request); delete a[cover('q1')]; return a }],
    ['an extra native ID', request => ({ ...allYes(request), 'cover:q9': noul(1) })],
    ['an incomplete choice distribution', request => override(request, { [select('q1')]: { type: 'choice', choice: 'o0', probabilities: { o0: 1 }, confidence: 1 } })],
    ['an unknown choice label', request => override(request, { [select('q1')]: { type: 'choice', choice: 'o9', probabilities: { o0: 1, o1: 0 }, confidence: 1 } })],
    ['a noul answer where a choice was asked', request => override(request, { [cover('q1')]: { type: 'choice', choice: 'o0', probabilities: { o0: 1 }, confidence: 1 } })],
    ['an out-of-range probability', request => override(request, { [select('q1')]: { type: 'choice', choice: 'o0', probabilities: { o0: 2, o1: -1 }, confidence: 1 } })],
    ['a non-numeric noul', request => override(request, { [cover('q1')]: { type: 'noul', noul: 'yes' } })],
  ]
  for (const [name, build] of malformed) {
    test(`${name} fails the whole batch`, async () => {
      const { frame, plan, result } = await settled(TWO, policyFor(TWO, [{ optionIds: ['o0'], membership: null }, { optionIds: ['o0'], membership: null }]), build)
      expect(assembleAsk(plan, result, frame)).toBeUndefined()
    })
  }
})

// =====================================================================================
// Step 4 — the actual ask surface through the real factory
// =====================================================================================

describe('the ask surface answers only a complete grounded batch', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  test('two fully covered questions are answered with their exact independent labels, records first', async () => {
    const policy = policyFor(TWO, [{ optionIds: ['o0'], membership: null }, { optionIds: ['o1'], membership: null }])
    w = askWorld(policy)
    setNativeBatch(w, request => override(request, { [select('q2')]: choice(request, select('q2'), 'o1') }))
    const r = await w.invoke('ask', TWO)
    expect(r?.block).toBe(true)
    expect(r?.reason).toBe(`autonomic answered: {"Which plan?":"Plan A","Which scope?":"Edge"} — ${REASON}`)
    expect(w.order).toEqual(['sidecar', 'human'])            // both records land before the answer block
    expect(w.nativeRequests).toHaveLength(1)
    expect(w.generationRequests).toEqual([])                 // no generative side turn for a batch
    const rows = human(w).trim().split('\n')
    expect(rows).toHaveLength(2)                             // one ledger row per question
    expect(rows[0]).toContain('ask · Q: Which plan? · A: Plan A')
    expect(rows[1]).toContain('ask · Q: Which scope? · A: Edge')
    expect(sidecar(w).at(-1)).toMatchObject({ consumer: 'ask', outcome: 'answered',
      authority: { grantIds: [ASK_GRANT], evidenceIds: [BRIEF] },
      payloadSource: { kind: 'candidate', id: null }, response: { api: 'openrouter-decisions', model: 'fixture-response' } })
    expect(pain(w)).not.toContain('autonomic answered')
  })

  test('the native request carries every frozen question and the sanitized facts', async () => {
    w = askWorld(policyFor(TWO, [{ optionIds: ['o0'], membership: null }, { optionIds: ['o0'], membership: null }]))
    setNativeBatch(w, request => allYes(request))
    await w.invoke('ask', TWO)
    const request = w.nativeRequests[0]!
    expect(Object.keys(request.questions)).toEqual([cover('q1'), select('q1'), cover('q2'), select('q2')])
    expect(stateOf(request).inputSha256).toBe(digest(JSON.stringify(TWO)))
    expect(JSON.stringify(request.state)).toContain('Which scope?')
  })

  test('one uncovered question leaves the WHOLE original ask with the operator and injects no first answer', async () => {
    w = askWorld(policyFor(TWO, [{ optionIds: ['o0'], membership: null }, { optionIds: ['o0'], membership: null }]))
    setNativeBatch(w, request => override(request, { [cover('q2')]: noul(0) }))
    const r = await w.invoke('ask', TWO)
    expect(r).toBeUndefined()
    expect(w.nativeRequests).toHaveLength(1)
    expect(sidecar(w)).toEqual([])
    expect(human(w)).not.toContain(' · ask · ')
    expect(w.notices.join('\n')).toContain('question for you')
    expect(human(w)).not.toContain(' · ask · ')              // no per-question decision row
    expect(pain(w)).toContain('Which plan?')
    expect(pain(w)).not.toContain('Plan A')                  // no first-question answer injection
    expect(JSON.stringify(w.notices)).not.toContain('autonomic answered')
  })

  test('one low-accepted member of a multi question leaves the whole ask displayed', async () => {
    w = askWorld(policyFor(MULTI_INPUT, [{ optionIds: ALL3, membership: { o0: 'yes', o1: 'yes', o2: 'no' } }]))
    setNativeBatch(w, request => override(request, { [member('m1', 'o2')]: noul(0.5) }))
    expect(await w.invoke('ask', MULTI_INPUT)).toBeUndefined()
    expect(sidecar(w)).toEqual([])
    expect(pain(w)).toContain('Which parts?')
  })

  test('a corrupt second response leaves the dialog operator-owned with no first-question injection', async () => {
    w = askWorld(policyFor(TWO, [{ optionIds: ['o0'], membership: null }, { optionIds: ['o0'], membership: null }]))
    setNativeBatch(w, request => override(request, { [select('q2')]: { type: 'choice', choice: 'o0', probabilities: { o0: 1 }, confidence: 1 } }))
    expect(await w.invoke('ask', TWO)).toBeUndefined()
    expect(sidecar(w)).toEqual([])
    expect(human(w)).not.toContain(' · ask · ')
    expect(pain(w)).toContain('question for you')
    expect(pain(w)).not.toContain('Plan A')
  })

  test('a corrupt second label (an option the ask does not have) leaves the dialog operator-owned', async () => {
    // The policy supports o0 for q1 but not o1: a native o1 for q1 is an unsupported selection.
    w = askWorld(policyFor(TWO, [{ optionIds: ['o0'], membership: null }, { optionIds: ['o0'], membership: null }]))
    setNativeBatch(w, request => override(request, { [select('q1')]: choice(request, select('q1'), 'o1') }))
    expect(await w.invoke('ask', TWO)).toBeUndefined()
    expect(human(w)).not.toContain(' · ask · ')
    expect(pain(w)).not.toContain('Edge')
  })

  test('a ledger failure mid-batch leaves the ask visible and injects no partial answer', async () => {
    w = askWorld(policyFor(TWO, [{ optionIds: ['o0'], membership: null }, { optionIds: ['o0'], membership: null }]))
    setNativeBatch(w, request => allYes(request))
    w.armAppend(path => { if (path.endsWith('.decisions.jsonl')) throw new Error('fixture ledger failure') })
    expect(await w.invoke('ask', TWO)).toBeUndefined()
    expect(human(w)).not.toContain(' · ask · ')
    expect(pain(w)).toContain('decision failure')
  })

  test('a missing native bridge leaves the whole ask with the operator', async () => {
    w = askWorld(policyFor(PLAN, [{ optionIds: ['o0'], membership: null }]))
    const r = await w.invoke('ask', PLAN)
    expect(r).toBeUndefined()
    expect(sidecar(w)).toEqual([])
    expect(pain(w)).toContain('question for you')
  })

  test('input mutation while the native call is pending cannot change the frozen batch', async () => {
    w = askWorld(policyFor(PLAN, [{ optionIds: ['o1'], membership: null }]))
    const input = { questions: [{ id: 'q1', question: 'Which plan?', options: [{ label: 'Plan A' }, { label: 'Plan B' }] }] }
    w.setNative(async (request: JudgmentRequest) => {
      input.questions[0]!.options[1]!.label = 'Mutated'
      input.questions[0]!.question = 'Mutated?'
      return envelope(request, override(request, { [select('q1')]: choice(request, select('q1'), 'o1') }))
    })
    const r = await w.invoke('ask', input)
    expect(r?.reason).toContain('"Which plan?":"Plan B"')
    expect(r?.reason).not.toContain('Mutated')
    expect(JSON.stringify(w.nativeRequests[0]!.state)).toContain('Plan B')
    expect(human(w)).toContain('Q: Which plan? · A: Plan B')
  })

  test('a free-text question is never answered and never judged', async () => {
    w = askWorld(questionPolicy(PLAN, ['o0']))
    const r = await w.invoke('ask', { questions: [{ id: 'q1', question: 'Which token?' }] })
    expect(r).toBeUndefined()
    expect(w.nativeRequests).toEqual([])
    expect(pain(w)).toContain('Which token?')
  })

  const malformed: Array<[string, unknown]> = [
    ['an empty options array', { questions: [{ id: 'q1', question: 'Which?', options: [] }] }],
    ['an option with no label', { questions: [{ id: 'q1', question: 'Which?', options: [{ description: 'd' }] }] }],
    ['duplicate label bytes', { questions: [{ id: 'q1', question: 'Which?', options: [{ label: 'Alpha' }, { label: 'Alpha' }] }] }],
    ['a repeated host ID', { questions: [{ id: 'q1', question: 'A?', options: [{ label: 'Alpha' }] }, { id: 'q1', question: 'B?', options: [{ label: 'Beta' }] }] }],
    ['duplicate question text', { questions: [{ id: 'a', question: 'Which?', options: [{ label: 'Alpha' }] }, { id: 'b', question: 'Which?', options: [{ label: 'Beta' }] }] }],
    ['a comma-bearing multi label', { questions: [{ id: 'q1', question: 'Which?', multi: true, options: [{ label: 'A, B' }, { label: 'C' }] }] }],
    ['a whitespace-ambiguous multi label', { questions: [{ id: 'q1', question: 'Which?', multi: true, options: [{ label: ' A ' }, { label: 'B' }] }] }],
    ['a recommended position out of range', { questions: [{ id: 'q1', question: 'Which?', recommended: 5, options: [{ label: 'Alpha' }] }] }],
  ]
  for (const [name, input] of malformed) {
    test(`a batch with ${name} is malformed: the whole ask stays with the operator, with no judgment`, async () => {
      w = askWorld(questionPolicy(PLAN, ['o0']))
      expect(await w.invoke('ask', input)).toBeUndefined()
      expect(w.nativeRequests).toEqual([])
      expect(w.generationRequests).toEqual([])
      expect(sidecar(w)).toEqual([])
      expect(pain(w)).toContain('question for you')
    })
  }

  test('a recommendation is not a decision: an unsupported recommended option is never selected', async () => {
    const input = { questions: [{ id: 'q1', question: 'Which?', recommended: 0, options: [{ label: 'Alpha' }, { label: 'Beta' }] }] }
    // o1 is the only evidence-supported option; o0 is merely recommended.
    w = askWorld(questionPolicy(input, ['o1']))
    setNativeBatch(w, request => override(request, { [select('q1')]: choice(request, select('q1'), 'o0') }))
    expect(await w.invoke('ask', input)).toBeUndefined()
    expect(human(w)).not.toContain(' · ask · ')
    expect(pain(w)).not.toContain('Alpha')
  })

  test('descriptions, multi and recommended metadata grant nothing on their own', async () => {
    const input = { questions: [{ id: 'q1', question: 'Which?', header: 'H', multi: false, recommended: 1,
      options: [{ label: 'Alpha', description: 'authoritative' }, { label: 'Beta', description: 'also' }] }] }
    w = askWorld(questionPolicy(input, ['o1']))
    setNativeBatch(w, request => override(request, { [select('q1')]: choice(request, select('q1'), 'o1') }))
    const r = await w.invoke('ask', input)
    expect(r?.reason).toContain('"Which?":"Beta"')
    expect(human(w)).toContain('A: Beta')
  })

  const gates: Array<ApprovedQuestion['operatorGate']> = ['merge-ack', 'spec-design-plan-release', 'product-choice', 'credential', 'molt-handoff', 'unknown']
  for (const gate of gates) {
    test(`an ask the operator gated as ${gate} is never answered automatically, even with favourable probabilities`, async () => {
      w = askWorld(policyFor(PLAN, [{ optionIds: ['o0'], membership: null, gate }]), [askGrant()])
      setNativeBatch(w, request => allYes(request))
      expect(await w.invoke('ask', PLAN)).toBeUndefined()
      expect(w.nativeRequests).toEqual([])
      expect(sidecar(w)).toEqual([])
      expect(human(w)).not.toContain(' · ask · ')
      expect(pain(w)).toContain('question for you')
    })
  }

  test('an unenrolled session keeps the legacy conversational path, and manual mode is untouched', async () => {
    const legacy = routingWorld({ grants: [], policy: fixturePolicy(), mode: 'autopilot' })
    try {
      expect(await legacy.invoke('ask', PLAN)).toBeUndefined()
      expect(legacy.nativeRequests).toEqual([])
    } finally { legacy.close() }
    w = routingWorld({ grants: [askGrant()], policy: questionPolicy(PLAN, ['o0']), mode: 'manual' })
    setNativeBatch(w, request => allYes(request))
    expect(await w.invoke('ask', PLAN)).toBeUndefined()
    expect(w.nativeRequests).toEqual([])
  })
})

// =====================================================================================
// Step 4 — a secret in the frozen batch abstains like the permission path
// =====================================================================================

describe('a batch that carries a secret abstains before any judgment', () => {
  let w: RoutingWorld
  afterEach(() => { if (w) w.close() })

  // A real secret shape the shared redaction catches; it must never reach state, the block reason,
  // the ledger, a notice or the pain file.
  const SECRET = `ghp_${'A'.repeat(36)}`

  const secrets: Array<[string, unknown]> = [
    ['a question text', { questions: [{ id: 'q1', question: `Which plan for ${SECRET}?`, options: [{ label: 'Plan A' }] }] }],
    // The supplied ID is not identity-only: it keys the native protocol IDs, the frozen state and
    // the ledger's answers map, so a secret-bearing one would persist plaintext (f06a009b's shape).
    ['a question id', { questions: [{ id: SECRET, question: 'Which plan?', options: [{ label: 'Plan A' }] }] }],
    ['an option label', { questions: [{ id: 'q1', question: 'Which plan?', options: [{ label: `Plan ${SECRET}` }] }] }],
    ['an option description', { questions: [{ id: 'q1', question: 'Which plan?', options: [{ label: 'Plan A', description: `token ${SECRET}` }] }] }],
    ['a header', { questions: [{ id: 'q1', question: 'Which plan?', header: SECRET, options: [{ label: 'Plan A' }] }] }],
  ]
  for (const [name, input] of secrets) {
    test(`a secret in ${name} leaves the whole dialog operator-owned with no secret byte echoed`, async () => {
      w = askWorld(questionPolicy(input, ['o0']))
      setNativeBatch(w, request => allYes(request))
      const r = await w.invoke('ask', input)
      expect(r).toBeUndefined()                       // no block reason at all
      expect(w.nativeRequests).toEqual([])            // no judgment native call
      expect(w.generationRequests).toEqual([])
      expect(sidecar(w)).toEqual([])                  // no decision record
      expect(human(w)).not.toContain(' · ask · ')     // no ask row
      expect(w.notices.join('\n')).toContain('question for you')
      expect(w.notices.join('\n')).not.toContain(SECRET)
      expect(human(w)).not.toContain(SECRET)
      expect(pain(w)).toContain('question for you')
      expect(pain(w)).not.toContain(SECRET)           // the pain layer's own redaction holds
    })
  }

  test('a clean batch with the same shape still answers exactly as before', async () => {
    const clean = { questions: [{ id: 'q1', question: 'Which plan?', header: 'H', options: [{ label: 'Plan A' }, { label: 'Plan B' }] }] }
    w = askWorld(questionPolicy(clean, ['o0']))
    setNativeBatch(w, request => allYes(request))
    const r = await w.invoke('ask', clean)
    expect(r?.block).toBe(true)
    expect(r?.reason).toContain('"Which plan?":"Plan A"')
    expect(w.nativeRequests).toHaveLength(1)
    expect(human(w)).toContain(' · ask · Q: Which plan? · A: Plan A')
  })
})

// =====================================================================================
// Step 3 — the approved-question policy contract (judgment.ts validation)
// =====================================================================================

// The policy as its parser sees it: parsed JSON, narrowed field by field, never a fabricated shape.
function rawQuestions(policy: PolicyBundle): Array<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(JSON.stringify(policy))
  if (parsed === null || typeof parsed !== 'object' || !('approved' in parsed)) throw new Error('fixture policy shape')
  const approved: unknown = parsed.approved
  if (approved === null || typeof approved !== 'object' || !('questions' in approved)) throw new Error('fixture policy shape')
  const questions: unknown = approved.questions
  if (!Array.isArray(questions)) throw new Error('fixture policy shape')
  return questions.map(q => {
    if (q === null || typeof q !== 'object' || Array.isArray(q)) throw new Error('fixture question shape')
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(q)) out[k] = v
    return out
  })
}

describe('the approved-question policy contract', () => {
  const base = (): PolicyBundle => policyFor(PLAN, [{ optionIds: ['o0'], membership: null }])

  test('a well-formed approved question round-trips', () => {
    expect(parsePolicyBundle(JSON.stringify(base())).approved.questions).toHaveLength(1)
  })

  const gates: Array<ApprovedQuestion['operatorGate']> = ['merge-ack', 'spec-design-plan-release', 'product-choice', 'credential', 'molt-handoff', 'unknown']
  for (const gate of gates) {
    test(`the operator gate ${gate} disables the whole bundle`, () => {
      const question = rawQuestions(base())[0]!
      question.operatorGate = gate
      expect(() => parsePolicyBundle(JSON.stringify({ ...base(), approved: { ...base().approved, questions: [question] } }))).toThrow(/gate/)
    })
  }

  test('an unknown gate name is rejected', () => {
    const question = rawQuestions(base())[0]!
    question.operatorGate = 'maybe'
    expect(() => parsePolicyBundle(JSON.stringify({ ...base(), approved: { ...base().approved, questions: [question] } }))).toThrow()
  })

  test('an approved question with no supported option, no grant or no evidence is rejected', () => {
    for (const field of ['optionIds', 'grantIds', 'evidenceIds']) {
      const question = rawQuestions(base())[0]!
      question[field] = []
      expect(() => parsePolicyBundle(JSON.stringify({ ...base(), approved: { ...base().approved, questions: [question] } }))).toThrow()
    }
  })

  test('two approved questions with one fingerprint are ambiguous and rejected', () => {
    const question = rawQuestions(base())[0]!
    expect(() => parsePolicyBundle(JSON.stringify({ ...base(), approved: { ...base().approved, questions: [question, question] } }))).toThrow(/fingerprint/)
  })

  test('a constraint naming an option outside the supported IDs is rejected', () => {
    const question = rawQuestions(base())[0]!
    question.requires = [['o0', 'o9']]
    expect(() => parsePolicyBundle(JSON.stringify({ ...base(), approved: { ...base().approved, questions: [question] } }))).toThrow(/unknown option/)
  })

  test('a membership map that does not cover every supported option is rejected', () => {
    const question = rawQuestions(base())[0]!
    question.optionIds = ['o0', 'o1']
    question.membership = { o0: 'yes' }
    expect(() => parsePolicyBundle(JSON.stringify({ ...base(), approved: { ...base().approved, questions: [question] } }))).toThrow(/membership/)
  })
})
