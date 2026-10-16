// Five-state turn end with complete grounded payloads (Plan Task 7 §9). OMP-local: it freezes a
// bounded, sanitized turn-end state from the captured decision frame, validates a generated or
// preselected payload against that state and the accepted native label, and returns the exact
// approved candidate payload when one applies.
//
// The rule the module exists to enforce: a label is a classification, never authority. `covered`
// and `stalled` may only repeat an action that already appears among the frozen policy bundle's
// approved remaining steps (or in an approved candidate) — a model may render prose, never extend
// an action. Every reason is rendered from cited evidence (`QuoteRef` offsets into a frozen
// excerpt), so no invented policy sentence can reach the ledger. Anything unprovable abstains to
// the operator.
import type { ApprovedDecisions, ApprovedTurnCandidate, DecisionFrame } from './judgment'
import type { EvidenceMaterial } from '../hooks/authority'
import { redact } from '../hooks/ledger'
import { parseUniqueJSON } from '../hooks/strict-json'
import { MAX_OPTION_TEXT, parseTurn, painOptions } from '../hooks/verdict'
import type { PainOption, TurnCase, TurnVerdict } from '../hooks/verdict'

export type WaitFact = { id: string; source: 'host-job' | 'molt'; status: string; evidenceId: string }
export type TurnEvidence = {
  lastReply: string; mode: 'autopilot'; sessionId: string; epoch: number
  assignmentId: string; generation: number; authoritySha256: string; policySha256: string
  progress: { pushes: number; changed: boolean; loopMax: number }
  waits: WaitFact[]; molt: { stage: string | null; handoff: boolean }
  candidates: ApprovedTurnCandidate[]
  remainingSteps: ApprovedDecisions['remainingSteps']
  evidence: EvidenceMaterial[]
}
export type QuoteRef = { evidenceId: string; start: number; end: number }
export type GeneratedTurnPayload = { payload: TurnVerdict; candidateId: string | null; reasonQuotes: QuoteRef[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)

/** One wait-evidence entry per real armed fact, so a `waiting` reason can cite the fact it rests on. */
function waitMaterial(fact: WaitFact): EvidenceMaterial {
  return { ref: { id: fact.evidenceId, source: `/nonexistent/fixture/${fact.evidenceId}`, sha256: '0'.repeat(64), locator: `wait:${fact.source}` },
    text: `${fact.source} ${fact.id} is ${fact.status}` }
}

/**
 * Freeze the bounded turn-end state (Plan Task 7 §9 Step 3). `reply` is the caller's tail, already
 * bounded by `tailChars`; `progress` and `molt` are the caller's live facts. Evidence is the lease's
 * material first, then the policy bundle's own material not already present by ID, then one entry per
 * real armed fact. Nothing here reads the session transcript.
 */
export function turnEvidence(frame: DecisionFrame, reply: string, progress: TurnEvidence['progress'],
  molt: TurnEvidence['molt']): TurnEvidence {
  const waits: WaitFact[] = []
  const jobs: unknown = frame.host.asyncJobs()
  if (isObj(jobs) && Array.isArray(jobs.running)) {
    for (const job of jobs.running) {
      if (!isObj(job)) continue
      const id = str(job.id), status = str(job.status)
      if (id === undefined || status === undefined) continue
      waits.push({ id: `job:${id}`, source: 'host-job', status, evidenceId: `wait:host-job:job:${id}` })
    }
  }
  if (molt.handoff) waits.push({ id: 'molt-handoff', source: 'molt', status: molt.stage ?? 'handoff', evidenceId: 'wait:molt:molt-handoff' })

  const evidence: EvidenceMaterial[] = []
  const seen = new Set<string>()
  for (const m of frame.lease.evidence) { if (!seen.has(m.ref.id)) { seen.add(m.ref.id); evidence.push(m) } }
  for (const m of frame.policy.evidence) { if (!seen.has(m.ref.id)) { seen.add(m.ref.id); evidence.push(m) } }
  for (const fact of waits) { if (!seen.has(fact.evidenceId)) { seen.add(fact.evidenceId); evidence.push(waitMaterial(fact)) } }

  return {
    lastReply: reply, mode: 'autopilot', sessionId: frame.host.sessionId, epoch: frame.lease.epoch,
    assignmentId: frame.lease.snapshot.assignmentId, generation: frame.lease.snapshot.generation,
    authoritySha256: frame.lease.binding.sha256, policySha256: frame.lease.policyDigest,
    progress, waits, molt, candidates: frame.policy.approved.turns,
    remainingSteps: frame.policy.approved.remainingSteps, evidence,
  }
}

// ---- grounding ---------------------------------------------------------------------------------

/** An approved action is actionable only while its grants and evidence are still live in this frame. */
function isLive(state: TurnEvidence, frame: DecisionFrame, grantIds: readonly string[], evidenceIds: readonly string[]): boolean {
  const grants = new Set(frame.lease.snapshot.grants.map(g => g.id))
  return grantIds.length > 0 && grantIds.every(id => grants.has(id))
    && evidenceIds.length > 0 && evidenceIds.every(id => state.evidence.some(e => e.ref.id === id))
}

/** The exact texts of the approved remaining steps still actionable in this turn. */
function approvedStepTexts(state: TurnEvidence, frame: DecisionFrame): string[] {
  return state.remainingSteps.filter(s => isLive(state, frame, s.grantIds, s.evidenceIds)).map(s => s.text)
}

/** The approved candidates of a case whose grants and evidence are still live. */
function liveCandidates(state: TurnEvidence, frame: DecisionFrame, kase: TurnCase): ApprovedTurnCandidate[] {
  return state.candidates.filter(c => c.case === kase && isLive(state, frame, c.grantIds, c.evidenceIds))
}

/** Every string in the state must survive redaction unchanged, or nothing is sent native/generated. */
export function stateHoldsSecret(state: TurnEvidence): boolean {
  const walk = (value: unknown): boolean => Array.isArray(value) ? value.some(walk)
    : isObj(value) ? Object.values(value).some(walk)
    : typeof value === 'string' ? redact(value) !== value : false
  return walk(state)
}

// ---- payload validation --------------------------------------------------------------------------

/** The first `{` through the last `}`, exactly as shared `jsonOf` frames it, parsed without duplicates. */
function envelopeOf(text: string): unknown {
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end < start) return undefined
  try { return parseUniqueJSON(text.slice(start, end + 1)) } catch { return undefined }
}

const ENVELOPE_KEYS = ['payload', 'candidateId', 'reasonQuotes'] as const

function isQuoteRef(value: unknown): value is QuoteRef {
  if (!isObj(value)) return false
  if (Object.keys(value).length !== 3 || !['evidenceId', 'start', 'end'].every(k => Object.hasOwn(value, k))) return false
  return str(value.evidenceId) !== undefined && Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end)
}

/** The evidence-cited rendering: `id: excerpt[start..end]`, joined by `; `. */
export function renderReason(state: TurnEvidence, quotes: readonly QuoteRef[]): string | undefined {
  if (quotes.length === 0) return undefined
  const parts: string[] = []
  for (const q of quotes) {
    const text = state.evidence.find(e => e.ref.id === q.evidenceId)?.text
    if (text === undefined || !(q.start >= 0 && q.start < q.end && q.end <= text.length)) return undefined
    parts.push(`${q.evidenceId}: ${text.slice(q.start, q.end)}`)
  }
  return parts.join('; ')
}

/** A grounded pain option must be carried verbatim by cited evidence, and pass the shared shape. */
function groundedPainOptions(state: TurnEvidence, options: readonly PainOption[]): PainOption[] | undefined {
  const cited = state.evidence.map(e => e.text).join('\n')
  if (!options.every(o => cited.includes(o.label) && cited.includes(o.text))) return undefined
  if (!options.every(o => o.text.length <= MAX_OPTION_TEXT)) return undefined
  return painOptions(options)
}

/** A fixed-order rendering of a verdict, so two equal payloads compare equal whatever their key order. */
function normalized(verdict: TurnVerdict): string {
  const record = verdict as unknown as Record<string, unknown>
  const keys = ['case', 'question', 'answer', 'next_step', 'reason'] as const
  const parts: unknown[] = keys.filter(k => record[k] !== undefined).map(k => [k, record[k]])
  const options = verdict.options
  if (options !== undefined) parts.push(['options', options.map(o => [o.label, o.text, o.recommended])])
  if (verdict.credential !== undefined) parts.push(['credential', verdict.credential])
  return JSON.stringify(parts)
}

/** The already-approved irreversible labels: an option never recommends one of these. */
function irreversibleLabels(state: TurnEvidence): Set<string> {
  const labels = new Set<string>()
  for (const c of state.candidates) for (const label of c.irreversibleOptionLabels) labels.add(label)
  return labels
}

/**
 * Validate a generated or preselected payload against the accepted label and the frozen state
 * (Plan Task 7 §9 Step 4). `undefined` means abstain: the operator owns the stop. The accepted case,
 * required fields, byte-exact actions, cited reasons, live grants/evidence and the irreversible
 * rule are all checked here. Optional malformed pain options may drop; a missing required field
 * may not.
 */
export function validateTurnPayload(value: unknown, accepted: TurnCase, state: TurnEvidence, frame: DecisionFrame): TurnVerdict | undefined {
  const envelope = typeof value === 'string' ? envelopeOf(value) : value
  if (!isObj(envelope) || Object.keys(envelope).length !== ENVELOPE_KEYS.length || !ENVELOPE_KEYS.every(k => Object.hasOwn(envelope, k))) return undefined
  const shape = envelope.payload
  if (shape === undefined || typeof shape === 'string') return undefined
  const raw = JSON.stringify(shape)
  if (raw === undefined) return undefined
  const verdict = parseTurn(raw)
  if (verdict === undefined || verdict.case !== accepted) return undefined

  const candidateId = envelope.candidateId
  if (candidateId !== null && str(candidateId) === undefined) return undefined
  const quoted = envelope.reasonQuotes
  if (!Array.isArray(quoted) || !quoted.every(isQuoteRef)) return undefined
  if (stateHoldsSecret(state) || stateHoldsSecret(verdict)) return undefined

  const steps = approvedStepTexts(state, frame)
  const live = liveCandidates(state, frame, accepted)
  if (verdict.case === 'covered') {
    const answer = verdict.answer
    if (answer === undefined || !(steps.includes(answer) || live.some(c => c.payload.answer === answer))) return undefined
  } else if (verdict.case === 'stalled') {
    const next = verdict.next_step
    if (next === undefined || !(steps.includes(next) || live.some(c => c.payload.next_step === next))) return undefined
  } else if (verdict.case === 'waiting') {
    if (state.waits.length === 0) return undefined
  } else if (verdict.case === 'done') {
    // Grounded in approved completion evidence: at least one quote must resolve to real evidence.
    if (quoted.length === 0) return undefined
  } else {
    const irreversible = irreversibleLabels(state)
    if (verdict.options?.some(o => o.label && irreversible.has(o.label) && o.recommended)) return undefined
    const cited = state.evidence.map(e => e.text).join('\n')
    if (verdict.question !== undefined && !cited.includes(verdict.question)) return undefined
    if (verdict.credential !== undefined && !cited.includes(verdict.credential)) return undefined
    if (verdict.options !== undefined && groundedPainOptions(state, verdict.options) === undefined) return undefined
  }

  if (candidateId === null) {
    if (renderReason(state, quoted) !== verdict.reason) return undefined
  } else {
    const candidate = live.find(c => c.id === candidateId)
    // A cited candidate is an exact approved payload: a model may not write its words. Comparison is
    // field-wise because the parser normalizes key order, so raw JSON bytes are not the contract.
    if (candidate === undefined || normalized(candidate.payload) !== normalized(verdict)) return undefined
  }
  return verdict
}

// ---- generation ----------------------------------------------------------------------------------

const CONTRACT = 'Return {payload,candidateId,reasonQuotes}. Keep the accepted case. Render only supplied evidence; no tools, approvals, new steps or secret values.'

/**
 * Render an exact candidate or perform one real, isolated generation (Plan Task 7 §9 Step 4). The
 * exact unique approved candidate payload is returned first; otherwise one tool-free generation
 * renders the required fields inside the frozen evidence. A case with no approved action or no real
 * evidence returns undefined rather than asking a generator to invent one. The isolated renderer is
 * Task 2's explicit isolation option, never `history:[]`.
 */
export async function payloadForTurn(frame: DecisionFrame, accepted: TurnCase, state: TurnEvidence):
  Promise<{ verdict: TurnVerdict; source: { kind: 'deterministic' | 'candidate' | 'generation'; id: string | null } } | undefined> {
  const applicable = liveCandidates(state, frame, accepted)
  if (applicable.length === 1) return { verdict: applicable[0]!.payload, source: { kind: 'candidate', id: applicable[0]!.id } }
  const renderable = accepted === 'waiting' ? state.waits.length > 0
    : accepted === 'done' || accepted === 'pain' ? state.evidence.length > 0
    : approvedStepTexts(state, frame).length > 0 || applicable.length > 1
  if (!renderable) return undefined

  const result = await frame.budget.run('generation', signal => {
    if (!frame.host.generate) throw new Error('payload generation unavailable')
    return frame.host.generate({
      tools: false, isolated: true, dedupeReply: false, signal,
      promptText: JSON.stringify({ accepted, state, contract: CONTRACT }),
    })
  })
  frame.budget.check()
  if (!frame.lease.fresh()) return undefined
  const text = typeof result?.replyText === 'string' ? result.replyText : undefined
  if (text === undefined || text.trim() === '') return undefined
  const verdict = validateTurnPayload(text, accepted, state, frame)
  return verdict === undefined ? undefined : { verdict, source: { kind: 'generation', id: null } }
}
