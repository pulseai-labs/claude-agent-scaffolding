// Exact-ID, all-question structured asks (Plan Task 6 §8). OMP-only: this module snapshots an
// ask's whole input into an immutable, byte-exact question batch, maps every question onto the
// frozen native protocol (`cover:`/`select:`/`member:` IDs), and assembles an answer only from a
// complete grounded batch. Anything short of that returns undefined so the operator keeps the
// entire original ask. It never rewrites the shared `parseAsk`/`Question` seam and never lets a
// model supply a grant, an evidence ref, an option label or an operator gate.
import { createHash } from 'node:crypto'
import type { Answer, Questions } from '@oh-my-pi/pi-ai'
import type { ExtensionJudgment } from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types'
import type { EvidenceMaterial } from '../hooks/authority'
import { redact } from '../hooks/ledger'
import { acceptedChoice, acceptedNoul, validateAnswers } from './judgment'
import type { ApprovedQuestion, DecisionFrame } from './judgment'

export type AskQuestion = {
  id: string; question: string; header: string | undefined; multi: boolean
  recommended: number | undefined
  options: Array<{ id: string; label: string; description: string | undefined }>
  fingerprint: string
}
export type AskSnapshot = { inputSha256: string; questions: AskQuestion[] }
export type AskPlan = {
  request: { state: Record<string, unknown>; questions: Questions }
  snapshot: AskSnapshot
  required: Array<{ id: string; questionId: string; kind: 'coverage' | 'selection' | 'membership'; optionId: string | null }>
}
export type AskAnswer = { answers: Record<string, string>; reason: string; grantIds: string[]; evidenceIds: string[] }

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

// The plan's exact protocol IDs (Plan Task 6 §8, the mapping table). These are the implementation's
// wire contract, so they live in one place rather than being re-derived per call site.
const coverId = (id: string): string => `cover:${encodeURIComponent(id)}`
const selectId = (id: string): string => `select:${encodeURIComponent(id)}`
const memberId = (id: string, option: string): string => `member:${encodeURIComponent(id)}:${option}`

/** Verbatim text: the consumer answer map is keyed on it, so a trimmed form would not round-trip. */
function verbatim(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`an ask ${what} is empty`)
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`an ask ${what} holds a control character`)
  if (value.trim() !== value) throw new Error(`an ask ${what} would not round-trip through the consumer map`)
  return value
}

/** A label keeps every byte; only emptiness and control characters are refused here. */
function labelOf(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new Error('an ask option label is empty')
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('an ask option label holds a control character')
  return value
}

/** One frozen option: exact label bytes, an optional description, and its request-local ordinal ID. */
function freezeOption(value: unknown, index: number): AskQuestion['options'][number] {
  const label = typeof value === 'string' ? labelOf(value)
    : isObject(value) ? labelOf(value.label) : (() => { throw new Error('an ask option is neither a label nor an object') })()
  let description: string | undefined
  if (isObject(value) && value.description !== undefined) description = verbatim(value.description, 'option description')
  return { id: `o${index}`, label, description }
}

/**
 * Freeze one host question. The fingerprint covers the whole immutable representation the native
 * question is built from — text, header, multi, recommended position and every option's ordinal,
 * label and description — but never the question's identity, so a legacy digest-derived ID stays
 * authorable by the operator. `recommended` is read as a position only; it authorizes nothing.
 */
function freezeQuestion(value: unknown, inputSha256: string, index: number): AskQuestion {
  if (!isObject(value)) throw new Error('an ask question is not an object')
  const question = verbatim(value.question, 'question text')
  const id = value.id === undefined ? `legacy:${inputSha256}:${index}` : verbatim(value.id, 'question id')
  let header: string | undefined
  if (value.header !== undefined) header = verbatim(value.header, 'question header')
  if (value.multi !== undefined && typeof value.multi !== 'boolean') throw new Error('an ask multi flag is not a boolean')
  const multi = value.multi === true
  if (!Array.isArray(value.options) || value.options.length === 0) throw new Error(`question ${id} has no options: only the operator can answer it`)
  const options = value.options.map((o, i) => freezeOption(o, i))
  if (new Set(options.map(o => o.label)).size !== options.length) throw new Error(`question ${id} repeats an option label: the answer could not be read back`)
  if (multi) {
    // A multi answer is labels joined with ", " at the shared consumer seam. A label holding a
    // comma, or one whose bytes a trim would change, cannot round-trip: it stays with the operator.
    for (const o of options) {
      if (o.label.includes(',')) throw new Error(`a label of question ${id} holds a comma: the operator answers it`)
      if (o.label.trim() !== o.label) throw new Error(`a label of question ${id} carries edge whitespace: the operator answers it`)
    }
  }
  let recommended: number | undefined
  if (value.recommended !== undefined) {
    if (typeof value.recommended !== 'number' || !Number.isSafeInteger(value.recommended) || value.recommended < 0 || value.recommended >= options.length)
      throw new Error(`question ${id} has an invalid recommended position`)
    recommended = value.recommended
  }
  const representation = JSON.stringify({ question, header: header ?? null, multi, recommended: recommended ?? null,
    options: options.map(o => ({ id: o.id, label: o.label, description: o.description ?? null })) })
  return { id, question, header, multi, recommended, options, fingerprint: createHash('sha256').update(representation).digest('hex') }
}

/**
 * The whole-batch snapshot (Plan Task 6 §8 Step 3). The input is copied as JSON before any
 * asynchronous work, so a later mutation cannot change the frozen batch or its fingerprint. A
 * malformed batch is rejected outright: it is never silently shortened to the questions that
 * happened to parse. Duplicate supplied IDs, duplicate derived IDs and duplicate question text
 * (the key of the existing consumer answer map) are all rejected.
 */
export function snapshotAsk(input: unknown): AskSnapshot {
  const json = JSON.stringify(input)
  if (json === undefined) throw new Error('the ask input is not JSON-serializable')
  const clone: unknown = JSON.parse(json)
  if (!isObject(clone)) throw new Error('the ask input is not an object')
  const inputSha256 = createHash('sha256').update(json).digest('hex')
  const list = clone.questions !== undefined ? clone.questions : typeof clone.question === 'string' ? [clone] : undefined
  if (!Array.isArray(list) || list.length === 0) throw new Error('the ask input carries no question')
  const questions = list.map((q, i) => freezeQuestion(q, inputSha256, i))
  const ids = new Set<string>(), texts = new Set<string>()
  for (const q of questions) {
    if (ids.has(q.id)) throw new Error(`duplicate question ID ${q.id}`)
    ids.add(q.id)
    if (texts.has(q.question)) throw new Error(`duplicate question text "${q.question}": the consumer answer map would be overwritten`)
    texts.add(q.question)
  }
  return { inputSha256, questions }
}

/**
 * Whether redaction would change any string the frozen batch carries. The ask consumer calls this
 * before any frame capture, state build or native call: a secret in a question text, option label,
 * description or header must abstain exactly as the permission path does, rather than send the
 * batch to judgment or let it reach the operator-visible block reason.
 */
export function holdsSecret(snapshot: AskSnapshot): boolean {
  const changed = (value: string): boolean => redact(value) !== value
  return snapshot.questions.some(q =>
    changed(q.question) || (q.header !== undefined && changed(q.header))
    || q.options.some(o => changed(o.label) || (o.description !== undefined && changed(o.description))))
}

/** The approved question for a fingerprint; exactly one, or the whole ask stays with the operator. */
function approvedFor(frame: DecisionFrame, fingerprint: string): ApprovedQuestion {
  const matches = frame.policy.approved.questions.filter(q => q.fingerprint === fingerprint)
  if (matches.length !== 1) throw new Error('the ask has no single approved question for its frozen content')
  return matches[0]!
}

/** The approved evidence an input may cite: the lease's own material, plus the digest-pinned bundle's. */
function evidenceOf(frame: DecisionFrame, id: string): EvidenceMaterial | undefined {
  return frame.lease.evidence.find(e => e.ref.id === id) ?? frame.policy.evidence.find(e => e.ref.id === id)
}

/**
 * Build the frozen native request (Plan Task 6 §8 Step 3). Every question is answered
 * independently against the same frozen state; no question refers to another's answer. Coverage,
 * selection and membership are separate questions, and each question's own approved evidence and
 * live grants must resolve here, or the whole ask returns to the operator. A model is never asked
 * to infer that permission probably existed.
 */
export function planAsk(snapshot: AskSnapshot, frame: DecisionFrame): AskPlan {
  const questions: Questions = {}
  const required: AskPlan['required'] = []
  const frozen: Array<Record<string, unknown>> = []
  const approvedState: Array<Record<string, unknown>> = []
  const grantIds: string[] = []
  const evidence: Array<Record<string, unknown>> = []
  const live = new Set(frame.lease.snapshot.grants.map(g => g.id))

  for (const q of snapshot.questions) {
    const approved = approvedFor(frame, q.fingerprint)
    // A bundle can only reach a frame through parsePolicyBundle, which already refuses any gate; the
    // consumer asserts it again rather than trusting that, because the cost of being wrong is an
    // autonomously answered operator gate.
    if (approved.operatorGate !== 'none') throw new Error(`the approved question for ${q.id} carries an operator gate: ${approved.operatorGate}`)
    if (approved.evidenceIds.length === 0) throw new Error(`the approved question for ${q.id} names no approved evidence`)
    if (approved.grantIds.length === 0) throw new Error(`the approved question for ${q.id} names no live grant`)
    for (const id of approved.grantIds) if (!live.has(id)) throw new Error(`the approved question for ${q.id} names a live grant that is not in the current lease`)
    const carried = new Set(q.options.map(o => o.id))
    for (const id of approved.optionIds) if (!carried.has(id)) throw new Error(`the approved question for ${q.id} names an option the ask does not carry`)
    for (const id of approved.evidenceIds) {
      const material = evidenceOf(frame, id)
      if (material === undefined) throw new Error(`the approved question for ${q.id} names approved evidence that does not resolve`)
      if (!evidence.some(e => e.id === id)) evidence.push({ id, locator: material.ref.locator, text: material.text })
    }
    for (const id of approved.grantIds) if (!grantIds.includes(id)) grantIds.push(id)

    questions[coverId(q.id)] = {
      type: 'noul',
      instructions: `Does the supplied approved evidence already cover the complete question ${q.id}, without any operator-owned approval?`,
      criteria: { true: 'Complete already-approved routine evidence for this question.', false: 'Open, incomplete, ambiguous or operator-owned.' },
    }
    required.push({ id: coverId(q.id), questionId: q.id, kind: 'coverage', optionId: null })
    if (q.multi) {
      // A complete multi-select pins membership for EVERY frozen option, not only the supported ones.
      const membership = approved.membership
      if (membership === null || Object.keys(membership).length !== q.options.length || q.options.some(o => !Object.hasOwn(membership, o.id)))
        throw new Error(`the approved question for ${q.id} has no complete membership map`)
      for (const option of q.options) {
        questions[memberId(q.id, option.id)] = {
          type: 'noul',
          instructions: `Is option ${option.id} of question ${q.id} part of its evidence-decided complete set?`,
          criteria: { true: 'Included by supplied approved evidence.', false: 'Excluded by supplied approved evidence.' },
        }
        required.push({ id: memberId(q.id, option.id), questionId: q.id, kind: 'membership', optionId: option.id })
      }
    } else {
      if (approved.membership !== null) throw new Error(`the approved question for ${q.id} carries a membership map but is not multi-select`)
      questions[selectId(q.id)] = {
        type: 'choice',
        instructions: `Select the already-covered option for question ${q.id}; do not create a decision.`,
        criteria: Object.fromEntries(q.options.map(o => [o.id, `Exact option ${o.id}; use its supplied label, description and evidence.`])),
      }
      required.push({ id: selectId(q.id), questionId: q.id, kind: 'selection', optionId: null })
    }
    frozen.push({ id: q.id, question: q.question, header: q.header ?? null, multi: q.multi, recommended: q.recommended ?? null,
      options: q.options.map(o => ({ id: o.id, label: o.label, description: o.description ?? null })) })
    approvedState.push({ questionId: q.id, fingerprint: q.fingerprint, optionIds: approved.optionIds,
      evidenceIds: approved.evidenceIds, grantIds: approved.grantIds, requires: approved.requires, excludes: approved.excludes })
  }

  const state = { tool: 'ask', inputSha256: frame.inputSha256, inputShape: frame.inputShape,
    assignmentId: frame.lease.snapshot.assignmentId, generation: frame.lease.snapshot.generation,
    authoritySha256: frame.lease.binding.sha256, policySha256: frame.lease.policyDigest,
    questions: frozen, approved: approvedState, grants: [...grantIds], evidence }
  return { request: { state, questions }, snapshot, required }
}

/**
 * Assemble an answer only from a complete grounded batch (Plan Task 6 §8 Step 4). Every coverage
 * answer must be an accepted "yes"; every selection must pass its own calibrated rule AND name an
 * approved supported option; every membership verdict must resolve and equal the pinned complete
 * membership. Any mismatch, empty multi set, missing/extra ID or violated constraint returns
 * undefined — never a partial answer, never an averaged confidence, never a fabricated reason. The
 * reason cites only the resolved approved evidence that this batch actually used.
 */
export function assembleAsk(plan: AskPlan, result: ExtensionJudgment<Questions>, frame: DecisionFrame): AskAnswer | undefined {
  // The SDK result is validated before any confidence is interpreted (Plan Task 6 §8 Step 4); a
  // malformed/extra/missing answer is a failed batch, never a partial one.
  try { validateAnswers(plan.request, result) } catch { return undefined }
  const acceptance = frame.policy.acceptance
  const answers = result.judgment.answers as Record<string, Answer | undefined>
  const answered = new Map<string, string[]>()
  const grantIds: string[] = []
  const evidenceIds: string[] = []
  const cited: Array<{ id: string; locator: string }> = []
  const citable = new Set(frame.lease.evidence.map(e => e.ref.id))
  for (const q of plan.snapshot.questions) {
    const approved = approvedFor(frame, q.fingerprint)
    const coverage = answers[coverId(q.id)]
    if (coverage === undefined || acceptedNoul(coverage, acceptance['ask.coverage']) !== 'yes') return undefined
    if (q.multi) {
      const chosen: string[] = []
      for (const option of q.options) {
        const answer = answers[memberId(q.id, option.id)]
        const verdict = answer === undefined ? undefined : acceptedNoul(answer, acceptance['ask.membership'])
        const pinned = approved.membership?.[option.id]
        // An unresolved verdict is never read as "no": the whole batch stands down.
        if (verdict === undefined || pinned === undefined || verdict !== pinned) return undefined
        if (verdict === 'yes') chosen.push(option.id)
      }
      if (chosen.length === 0) return undefined
      for (const id of chosen) if (!approved.optionIds.includes(id)) return undefined
      for (const [a, b] of approved.requires) if (chosen.includes(a) && !chosen.includes(b)) return undefined
      for (const [a, b] of approved.excludes) if (chosen.includes(a) && chosen.includes(b)) return undefined
      answered.set(q.id, chosen)
    } else {
      const answer = answers[selectId(q.id)]
      const choice = answer === undefined ? undefined : acceptedChoice(answer, acceptance['ask.selection'])
      if (choice === undefined || !approved.optionIds.includes(choice)) return undefined
      answered.set(q.id, [choice])
    }
    for (const id of approved.grantIds) if (!grantIds.includes(id)) grantIds.push(id)
    for (const id of approved.evidenceIds) {
      const material = evidenceOf(frame, id)
      if (material === undefined) return undefined
      // The audit record may only cite evidence that resolves in the current lease (Task 5's
      // taskEvidence pattern), so the digest-pinned bundle's own material stays out of the record.
      if (!citable.has(id)) continue
      if (!evidenceIds.includes(id)) { evidenceIds.push(id); cited.push({ id, locator: material.ref.locator }) }
    }
  }
  // A reason must cite the real evidence this batch used; with nothing citable there is nothing to
  // stand on, so the whole ask stays with the operator.
  if (cited.length === 0) return undefined
  // The operator sees the exact original label bytes in stable input order, never an internal ID.
  const rendered: Record<string, string> = {}
  for (const q of plan.snapshot.questions) {
    const byId = new Map(q.options.map(o => [o.id, o.label]))
    rendered[q.question] = (answered.get(q.id) ?? []).map(id => byId.get(id)!).join(', ')
  }
  return { answers: rendered, reason: `approved evidence ${cited.map(c => `${c.id}@${c.locator}`).join(', ')} covers every question in the batch`,
    grantIds, evidenceIds }
}
