// The bounded OMP decision transaction (Plan Task 4 §6). One monotonic end-to-end deadline from
// handler entry, exact SDK result validation, operator-owned acceptance, and a native-only judge
// call — all OMP-local. Every SDK/host import is `import type`: the CSA tree has no installed host
// package, so a value import would not resolve under plain bun. No chat fallback lives here.
import type { Answer, JudgmentApi, JudgmentRequest, JudgmentResult, Questions } from '@oh-my-pi/pi-ai'
import type { ExtensionContext, ExtensionJudge, ExtensionJudgment } from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types'
import { randomUUID } from 'node:crypto'
import { evidenceRef, exactObject, opaque } from '../hooks/authority'
import type { AuthorityLease, EvidenceMaterial, Grant, PlacementFacts, PinnedAuthority } from '../hooks/authority'
import { oneLine } from '../hooks/ledger'
import { MAX_INPUT, shownInput } from '../hooks/prompts'
import { inputShape } from '../hooks/shape'
import { parseUniqueJSON } from '../hooks/strict-json'
import { sha256 } from './authority-store'

export type Consumer = 'permission' | 'ask' | 'turn-end'
export type AcceptanceClass = 'permission' | 'ask.coverage' | 'ask.selection' | 'ask.membership' | 'turn-end'
export type ChoiceAcceptance = { minProbability: number; minConfidence: number }
export type NoulAcceptance = { minYes: number; minNo: number }
export type AcceptancePolicy = {
  permission: ChoiceAcceptance
  'ask.coverage': NoulAcceptance
  'ask.selection': ChoiceAcceptance
  'ask.membership': NoulAcceptance
  'turn-end': ChoiceAcceptance
}
export type ApprovedQuestion = {
  fingerprint: string; optionIds: string[]; complete: true; evidenceIds: string[]; grantIds: string[]
  operatorGate: 'none' | 'merge-ack' | 'spec-design-plan-release' | 'product-choice' | 'credential' | 'molt-handoff' | 'unknown'
  membership: Record<string, 'yes' | 'no'> | null
  requires: Array<[string, string]>; excludes: Array<[string, string]>
}
export type ApprovedDecisions = {
  commands: Array<{ grantId: string; argv: string[]; cwd: string; evidenceIds: string[] }>
  permissions: Array<{ inputSha256: string; grantIds: string[]; decision: 'allow' | 'ask'; evidenceIds: string[] }>
  questions: ApprovedQuestion[]
  // #873 Task 5: a version-1 bundle still carries the turn-end-only `turns` and `remainingSteps`.
  // The parser requires both keys so an approved bundle keeps loading; it stores neither, and
  // nothing reads them.
  turns?: unknown
  remainingSteps?: unknown
}
export type PolicyBundle = {
  version: 1; text: string; acceptance: AcceptancePolicy
  routes: Array<{ api: string; provider: string; model: string; calibrationRef: string }>
  evidence: EvidenceMaterial[]; approved: ApprovedDecisions
}
export type ConsumerHost = {
  sessionId: string; cwd: string; sessionFile: string | undefined
  judge: ExtensionJudge | undefined
  generate: NonNullable<ExtensionContext['runEphemeralTurn']> | undefined
  asyncJobs: () => ReturnType<ExtensionContext['getAsyncJobSnapshot']>
}
export type DecisionIO = {
  capture: () => ConsumerHost
  authority: PinnedAuthority
  placement: (input: unknown, signal: AbortSignal) => Promise<PlacementFacts>
  policy: (lease: AuthorityLease) => PolicyBundle
  appendLine: (path: string, line: string) => Promise<boolean>
  ledgerPath: () => Promise<string>
  fail: (sessionId: string, reason: string) => Promise<void>
}
export type DecisionFrame = {
  id: string; consumer: Consumer; inputSha256: string; shownInput: string; inputShape: string
  host: ConsumerHost; lease: AuthorityLease; facts: PlacementFacts
  policy: PolicyBundle; budget: DecisionBudget
}
export type DecisionDraft = {
  outcome: 'allow' | 'ask' | 'answered' | 'continue' | 'waiting' | 'done' | 'pain'
  grantIds: string[]; evidenceIds: string[]
  answers: Record<string, Answer>
  route: ExtensionJudgment<Questions>['route'] | null
  response: Pick<JudgmentResult, 'api' | 'provider' | 'model' | 'usage'> | null
  payloadSource: { kind: 'deterministic' | 'candidate' | 'generation'; id: string | null }
  reason: string
}

export type DecisionPhase = 'capture' | 'native' | 'generation' | 'final'

// Serialization roundoff tolerance for a finite distribution. Never an action threshold.
export const PROBABILITY_SUM_TOLERANCE = 1e-6
const CUTOFFS: Record<DecisionPhase, number> = { capture: 2000, native: 12000, generation: 22000, final: 25000 }
const TOTAL_MS = 25_000
const PHASE_CAP = 10_000
// The SDK's native judgment APIs, exhaustively. A provider name is not a native kind check.
const JUDGMENT_API: Record<JudgmentApi, true> = { typesafe: true, 'openrouter-decisions': true }

const inUnit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

// Local so a task worker needs no private host import. Races the phase allowance and, crucially,
// settles even when the callee ignores the abort signal.
async function racePhase<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, inherited: AbortSignal): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error('decision deadline')
  const deadline = performance.now() + ms
  const child = new AbortController()
  const signal = AbortSignal.any([inherited, child.signal])
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    signal.throwIfAborted()
    const stopped = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error('decision cancelled'))
      signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => child.abort(), ms)
    })
    const value = await Promise.race([fn(signal), stopped])
    signal.throwIfAborted()
    if (performance.now() >= deadline) throw new Error('decision deadline')
    return value
  } finally {
    clearTimeout(timer)
    if (abort) signal.removeEventListener('abort', abort)
    child.abort()
  }
}

/** One monotonic 25-second window from handler entry. No phase creates a fresh deadline. */
export class DecisionBudget {
  readonly signal: AbortSignal
  private readonly entryMs: number
  private readonly controller = new AbortController()
  constructor(entryMs: number, signal?: AbortSignal) {
    if (!Number.isFinite(entryMs)) throw new Error('invalid entry time')
    this.entryMs = entryMs
    this.signal = AbortSignal.any([signal ?? new AbortController().signal, this.controller.signal])
  }
  remaining(phase: DecisionPhase): number {
    const cap = phase === 'native' || phase === 'generation' ? PHASE_CAP : TOTAL_MS
    return Math.min(cap, this.entryMs + CUTOFFS[phase] - performance.now(), this.entryMs + TOTAL_MS - performance.now())
  }
  async run<T>(phase: DecisionPhase, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const left = this.remaining(phase)
    if (left <= 0) throw new Error('decision deadline')
    const value = await racePhase(fn, left, this.signal)
    this.check()
    if (performance.now() >= this.entryMs + CUTOFFS[phase]) throw new Error('phase deadline')
    return value
  }
  check(): void {
    if (this.signal.aborted) throw new Error('decision cancelled')
    if (performance.now() >= this.entryMs + TOTAL_MS) throw new Error('decision deadline')
  }
  cancel(): void { this.controller.abort() }
}

// The input is copied as JSON before the first await, so no later mutation can change what was judged.
function jsonCopy(input: unknown): unknown {
  const json = JSON.stringify(input)
  if (json === undefined) throw new Error('the input is not JSON-serializable')
  return JSON.parse(json) as unknown
}

/** Capture the immutable decision frame: identity, shown input, host, lease and policy. */
export async function captureFrame(io: DecisionIO, entryMs: number, consumer: Consumer, input: unknown, signal?: AbortSignal): Promise<DecisionFrame> {
  const copy = jsonCopy(input)
  const shown = shownInput(copy)
  if (shown.length > MAX_INPUT) throw new Error('the input exceeds the 64,000-code-unit shown-input bound')
  const shapeOfInput = inputShape(copy)
  const inputSha256 = sha256(JSON.stringify(copy))
  const budget = new DecisionBudget(entryMs, signal)
  return budget.run('capture', async s => {
    const host = io.capture()
    s.throwIfAborted()
    const facts = await io.placement(copy, s)
    budget.check()
    const lease = io.authority.lease(host.sessionId, facts)
    const policy = io.policy(lease)
    return Object.freeze({ id: randomUUID(), consumer, inputSha256, shownInput: shown, inputShape: shapeOfInput,
      host, lease, facts, policy, budget })
  })
}

/** Validate an SDK judgment result before any confidence is interpreted. */
export function validateAnswers<Q extends Questions>(request: JudgmentRequest<Q>, result: ExtensionJudgment<Q>): void {
  const answers = result.judgment.answers as Record<string, unknown>
  const ids = Object.keys(request.questions)
  if (Object.keys(answers).length !== ids.length || ids.some(id => !Object.hasOwn(answers, id))) throw new Error('answer/question ID mismatch')
  for (const id of ids) validateAnswer(request.questions[id]!, answers[id], id)
  if (!Object.hasOwn(JUDGMENT_API, result.judgment.api)) throw new Error('invalid native API kind')
  const route = result.route
  if (!Object.hasOwn(JUDGMENT_API, route.selected.api)) throw new Error('the selected route is not a native API kind')
  if (!Number.isSafeInteger(route.questions) || route.questions !== ids.length) throw new Error('route question count does not match the frozen questions')
  if (!Number.isSafeInteger(route.cachedQuestions) || route.cachedQuestions < 0 || route.cachedQuestions > route.questions) throw new Error('invalid cache counts')
}

function validateAnswer(question: Questions[string], answer: unknown, id: string): void {
  if (answer === null || typeof answer !== 'object') throw new Error(`missing answer for ${id}`)
  const a = answer as Record<string, unknown>
  if (a.type !== question.type) throw new Error(`answer type does not match question ${id}`)
  if (question.type === 'choice') {
    const keys = Object.keys(question.criteria)
    if (typeof a.choice !== 'string' || !keys.includes(a.choice)) throw new Error('unknown choice label')
    const probs = a.probabilities
    if (probs === null || typeof probs !== 'object') throw new Error('missing choice distribution')
    const p = probs as Record<string, unknown>
    if (Object.keys(p).length !== keys.length || keys.some(k => !Object.hasOwn(p, k))) throw new Error('choice distribution keys do not match the criteria')
    let sum = 0, max = -Infinity, ties = 0
    for (const k of keys) {
      const v = p[k]
      if (!inUnit(v)) throw new Error('a probability is not finite in [0,1]')
      sum += v
      if (v > max) { max = v; ties = 1 } else if (v === max) ties++
    }
    if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) throw new Error('the choice distribution does not normalize')
    if (ties !== 1 || p[a.choice] !== max) throw new Error('the choice is not a unique maximum')
    if (!inUnit(a.confidence)) throw new Error('invalid choice confidence')
    return
  }
  if (question.type === 'noul') {
    if (!inUnit(a.noul)) throw new Error('invalid noul (P(yes))')
    return
  }
  // score: shaped like the SDK, checked for finite normalization; consumers here use choice/noul.
  if (typeof a.score !== 'number' || !Number.isFinite(a.score)) throw new Error('invalid score')
  const probs = a.probabilities
  if (probs === null || typeof probs !== 'object' || Object.keys(probs).length < 2) throw new Error('invalid score distribution')
  let sum = 0
  for (const v of Object.values(probs as Record<string, unknown>)) { if (!inUnit(v)) throw new Error('a score probability is not finite in [0,1]'); sum += v }
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) throw new Error('the score distribution does not normalize')
  if (!inUnit(a.confidence)) throw new Error('invalid score confidence')
}

function checkRule(rule: ChoiceAcceptance | NoulAcceptance): void {
  if ('minProbability' in rule) {
    if (!inUnit(rule.minProbability) || !inUnit(rule.minConfidence)) throw new Error('invalid choice acceptance rule')
    return
  }
  if (!inUnit(rule.minYes) || !inUnit(rule.minNo) || rule.minYes + rule.minNo <= 1) throw new Error('invalid or overlapping noul acceptance rule')
}

/** The largest uniquely-maximum label whose probability and confidence both meet the rule. */
export function acceptedChoice(answer: Answer, rule: ChoiceAcceptance): string | undefined {
  if (answer.type !== 'choice') return undefined
  checkRule(rule)
  const probs = answer.probabilities as Record<string, number>
  const keys = Object.keys(probs)
  let max = -Infinity, ties = 0
  for (const k of keys) {
    const v = probs[k] as number
    if (!Number.isFinite(v)) return undefined
    if (v > max) { max = v; ties = 1 } else if (v === max) ties++
  }
  if (ties !== 1 || probs[answer.choice] !== max) return undefined
  return max >= rule.minProbability && answer.confidence >= rule.minConfidence ? answer.choice : undefined
}

/** P(yes) is a probability, never a boolean. Overlapping rule regions are invalid. */
export function acceptedNoul(answer: Answer, rule: NoulAcceptance): 'yes' | 'no' | undefined {
  if (answer.type !== 'noul') return undefined
  checkRule(rule)
  const yes = answer.noul
  if (!Number.isFinite(yes)) throw new Error('invalid noul answer')
  const isYes = yes >= rule.minYes
  const isNo = 1 - yes >= rule.minNo
  if (isYes && isNo) return undefined
  if (isYes) return 'yes'
  if (isNo) return 'no'
  return undefined
}

function approveRoute(frame: DecisionFrame, result: ExtensionJudgment<Questions>): void {
  const selected = result.route.selected
  const route = frame.policy.routes.find(r => r.api === selected.api && r.provider === selected.provider && r.model === selected.model)
  if (route === undefined) throw new Error('the selected native route is not an approved route')
  if (!frame.policy.evidence.some(e => e.ref.id === route.calibrationRef)) throw new Error('the approval route names no calibration evidence')
}

/** One host judge invocation inside the native phase, with lease freshness checked around it. */
export async function judgeNative<Q extends Questions>(frame: DecisionFrame, request: JudgmentRequest<Q>): Promise<ExtensionJudgment<Q>> {
  const judge = frame.host.judge
  if (typeof judge !== 'function') throw new Error('the native judge bridge is unavailable')
  return frame.budget.run('native', async signal => {
    if (!frame.lease.fresh()) throw new Error('stale authority before native judgment')
    signal.throwIfAborted()
    const result = await judge(request, { purpose: `autonomic.${frame.consumer}`, nativeOnly: true, timeoutMs: frame.budget.remaining('native'), signal })
    if (!frame.lease.fresh()) throw new Error('stale authority after native judgment')
    validateAnswers(request, result)
    approveRoute(frame, result as ExtensionJudgment<Questions>)
    return result
  })
}

// ---- the effective-policy file (closed, version 1) -------------------------------------------

const GATES: Record<ApprovedQuestion['operatorGate'], true> = { none: true, 'merge-ack': true, 'spec-design-plan-release': true,
  'product-choice': true, credential: true, 'molt-handoff': true, unknown: true }
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length

function strings(value: unknown, decode: (v: unknown) => string = opaque): string[] {
  if (!Array.isArray(value)) throw new Error('expected a finite list')
  const out = value.map(decode)
  if (!unique(out)) throw new Error('duplicate list value')
  return out
}

function acceptance(value: unknown): AcceptancePolicy {
  const o = exactObject(value, ['permission', 'ask.coverage', 'ask.selection', 'ask.membership', 'turn-end'])
  const choice = (v: unknown): ChoiceAcceptance => {
    const c = exactObject(v, ['minProbability', 'minConfidence'])
    const rule = { minProbability: unit(c.minProbability), minConfidence: unit(c.minConfidence) }
    checkRule(rule); return rule
  }
  const noul = (v: unknown): NoulAcceptance => {
    const n = exactObject(v, ['minYes', 'minNo'])
    const rule = { minYes: unit(n.minYes), minNo: unit(n.minNo) }
    checkRule(rule); return rule
  }
  return { permission: choice(o.permission), 'ask.coverage': noul(o['ask.coverage']), 'ask.selection': choice(o['ask.selection']),
    'ask.membership': noul(o['ask.membership']), 'turn-end': choice(o['turn-end']) }
}

function unit(value: unknown): number {
  if (!inUnit(value)) throw new Error('expected a probability in [0,1]')
  return value
}

function route(value: unknown): PolicyBundle['routes'][number] {
  const o = exactObject(value, ['api', 'provider', 'model', 'calibrationRef'])
  const api = opaque(o.api)
  if (!Object.hasOwn(JUDGMENT_API, api)) throw new Error('a policy route names a non-native API')
  return { api, provider: opaque(o.provider), model: opaque(o.model), calibrationRef: opaque(o.calibrationRef) }
}

function material(value: unknown): EvidenceMaterial {
  const o = exactObject(value, ['ref', 'text'])
  if (typeof o.text !== 'string') throw new Error('invalid policy evidence text')
  return { ref: evidenceRef(o.ref), text: o.text }
}

function question(value: unknown): ApprovedQuestion {
  const o = exactObject(value, ['fingerprint', 'optionIds', 'complete', 'evidenceIds', 'grantIds', 'operatorGate', 'membership', 'requires', 'excludes'])
  if (o.complete !== true) throw new Error('an approved question must be complete')
  const optionIds = strings(o.optionIds)
  if (optionIds.length === 0) throw new Error('an approved question names no supported option')
  const gate = opaque(o.operatorGate)
  if (!Object.hasOwn(GATES, gate)) throw new Error('unknown operator gate')
  // Only a gate-free question may be answered autonomously (Plan Task 6 §8): a bundle that carries
  // any operator gate is unavailable to every consumer rather than silently auto-answering it.
  if (gate !== 'none') throw new Error(`an approved question carries the operator gate ${gate}`)
  const evidenceIds = strings(o.evidenceIds)
  if (evidenceIds.length === 0) throw new Error('an approved question names no approved evidence')
  const grantIds = strings(o.grantIds)
  if (grantIds.length === 0) throw new Error('an approved question names no grant reference')
  const membership = o.membership === null ? null : membershipOf(o.membership, optionIds)
  return { fingerprint: opaque(o.fingerprint), optionIds, complete: true,
    evidenceIds, grantIds, operatorGate: gate as ApprovedQuestion['operatorGate'], membership,
    requires: pairs(o.requires, optionIds), excludes: pairs(o.excludes, optionIds) }
}

function membershipOf(value: unknown, optionIds: readonly string[]): Record<string, 'yes' | 'no'> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid membership map')
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length !== optionIds.length || optionIds.some(id => !Object.hasOwn(value as object, id))) throw new Error('incomplete membership map')
  for (const [, v] of entries) if (v !== 'yes' && v !== 'no') throw new Error('invalid membership value')
  return Object.fromEntries(entries) as Record<string, 'yes' | 'no'>
}

function pairs(value: unknown, optionIds: readonly string[]): Array<[string, string]> {
  if (!Array.isArray(value)) throw new Error('expected a finite list of pairs')
  return value.map(p => {
    if (!Array.isArray(p) || p.length !== 2) throw new Error('expected an option-ID pair')
    const [a, b] = p.map(opaque)
    if (!optionIds.includes(a) || !optionIds.includes(b)) throw new Error('a constraint names an unknown option')
    return [a, b]
  })
}

function approved(value: unknown): ApprovedDecisions {
  const o = exactObject(value, ['commands', 'permissions', 'questions', 'turns', 'remainingSteps'])
  const list = (v: unknown, decode: (x: unknown) => unknown): unknown[] => (Array.isArray(v) ? v.map(decode) : (() => { throw new Error('expected a finite list') })())
  const commands = list(o.commands, v => {
    const c = exactObject(v, ['grantId', 'argv', 'cwd', 'evidenceIds'])
    if (typeof c.cwd !== 'string' || !c.cwd.startsWith('/')) throw new Error('command cwd must be absolute')
    return { grantId: opaque(c.grantId), argv: strings(c.argv), cwd: c.cwd, evidenceIds: strings(c.evidenceIds) }
  }) as ApprovedDecisions['commands']
  const permissions = list(o.permissions, v => {
    const p = exactObject(v, ['inputSha256', 'grantIds', 'decision', 'evidenceIds'])
    if (p.decision !== 'allow' && p.decision !== 'ask') throw new Error('invalid approved permission decision')
    const grantIds = strings(p.grantIds)
    if (grantIds.length === 0) throw new Error('an approved permission needs a grant reference')
    return { inputSha256: hex(p.inputSha256), grantIds, decision: p.decision, evidenceIds: strings(p.evidenceIds) }
  }) as ApprovedDecisions['permissions']
  // #873 Task 5: a version-1 bundle still carries the turn-end-only fields. `turns` may hold any
  // array entries (a legacy candidate included) and `remainingSteps` keeps its exact shape check;
  // neither is stored or read, so an unchanged approved bundle keeps the permission and ask lanes on.
  if (!Array.isArray(o.turns)) throw new Error('expected a finite list')
  list(o.remainingSteps, v => {
    const s = exactObject(v, ['id', 'text', 'grantIds', 'evidenceIds'])
    return { id: opaque(s.id), text: opaque(s.text), grantIds: strings(s.grantIds), evidenceIds: strings(s.evidenceIds) }
  })
  const questions = list(o.questions, question) as ApprovedQuestion[]
  // Two approved questions for one frozen fingerprint would make the match ambiguous (Plan Task 6 §8).
  if (new Set(questions.map(q => q.fingerprint)).size !== questions.length) throw new Error('duplicate approved fingerprint')
  return { commands, permissions, questions }
}

function hex(value: unknown): string {
  const v = opaque(value)
  if (!/^[a-f0-9]{64}$/.test(v)) throw new Error('invalid SHA256')
  return v
}

/**
 * Parse the version-1 effective-policy bundle. Unknown/duplicate keys, malformed values, an
 * overlapping acceptance rule, a non-native route, a route whose calibration Ref has no evidence,
 * and incomplete question membership all disable the route. Cross-references to the lease's grants
 * and evidence are resolved by the consumer against the current lease, not here.
 */
export function parsePolicyBundle(text: string): PolicyBundle {
  const o = exactObject(parseUniqueJSON(text), ['version', 'text', 'acceptance', 'routes', 'evidence', 'approved'])
  if (o.version !== 1) throw new Error('unsupported policy version')
  const policy: PolicyBundle = { version: 1, text: opaque(o.text), acceptance: acceptance(o.acceptance),
    routes: listOf(o.routes, route), evidence: listOf(o.evidence, material), approved: approved(o.approved) }
  if (!unique(policy.evidence.map(e => e.ref.id))) throw new Error('duplicate policy evidence ID')
  for (const r of policy.routes) if (!policy.evidence.some(e => e.ref.id === r.calibrationRef)) throw new Error('a policy route names no calibration evidence')
  return policy
}

function listOf<T>(value: unknown, decode: (v: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('expected a finite list')
  return value.map(decode)
}

// Exported for consumers that log a bounded one-line form of a record field.
export { oneLine }
export type { Grant }
