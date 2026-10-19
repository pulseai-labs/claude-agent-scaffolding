// The two-write decision attribution (Plan Task 4 §6 Step 4). It is audit output, never authority:
// a partial record is an intent, never execution proof. Both required writes must land, and the
// authority must be fresh before each write and after the last, or nothing is released.
import { ledgerLine } from '../hooks/ledger'
import type { LedgerCase, LedgerSource } from '../hooks/ledger'
import { redact } from '../hooks/ledger'
import { oneLine } from '../hooks/ledger'
import type { DecisionDraft, DecisionFrame, DecisionIO } from './judgment'

export type DecisionRecord = {
  version: 1; decisionId: string; sessionId: string; consumer: DecisionFrame['consumer']
  inputSha256: string; inputShape: string
  authority: { assignmentId: string; generation: number; sha256: string; grantIds: string[]; evidenceIds: string[] }
  route: DecisionDraft['route']; response: DecisionDraft['response']; answers: DecisionDraft['answers']
  policy: { id: string; sha256: string }
  outcome: DecisionDraft['outcome']; payloadSource: DecisionDraft['payloadSource']; reason: string
}

// Decision IDs are UUIDs; the human line reserves room for the whole `decisionId=<id>; ` prefix
// before oneLine truncates a long reason.
const DECISION_ID_ROOM = 64

/** Build the closed record: no inferred usage or state is added. */
function recordFor(frame: DecisionFrame, draft: DecisionDraft): DecisionRecord {
  const grantIds = leaseGrantIds(frame, draft.grantIds)
  const evidenceIds = leaseEvidenceIds(frame, draft.evidenceIds)
  return {
    version: 1, decisionId: frame.id, sessionId: frame.host.sessionId, consumer: frame.consumer,
    inputSha256: frame.inputSha256, inputShape: frame.inputShape,
    authority: { assignmentId: frame.lease.snapshot.assignmentId, generation: frame.lease.snapshot.generation,
      sha256: frame.lease.binding.sha256, grantIds, evidenceIds },
    route: draft.route, response: draft.response, answers: draft.answers,
    policy: { id: frame.lease.snapshot.policy.id, sha256: frame.lease.policyDigest },
    outcome: draft.outcome, payloadSource: draft.payloadSource, reason: redact(draft.reason),
  }
}

function leaseGrantIds(frame: DecisionFrame, ids: readonly string[]): string[] {
  const known = new Set(frame.lease.snapshot.grants.map(g => g.id))
  for (const id of ids) if (!known.has(id)) throw new Error('a referenced grant is not in the current lease')
  return [...ids]
}

function leaseEvidenceIds(frame: DecisionFrame, ids: readonly string[]): string[] {
  const known = new Set(frame.lease.evidence.map(e => e.ref.id))
  for (const id of ids) if (!known.has(id)) throw new Error('a referenced evidence ID is not in the current lease')
  return [...ids]
}

/**
 * Both human and JSONL writes under the final phase, with a freshness check before each write and
 * after the last. On any required-write failure or timeout, publish manual/failure and never act.
 */
export async function commitDecision(io: DecisionIO, frame: DecisionFrame, draft: DecisionDraft,
  rows: readonly { kase: LedgerCase; q: string; a: string; answerMax?: number; src?: LedgerSource }[]): Promise<void> {
  const session = frame.host.sessionId
  try {
    const record = recordFor(frame, draft)
    const redactedReason = oneLine(draft.reason, 300 - DECISION_ID_ROOM)
    const time = new Date().toISOString()
    const humanLines = rows.map(r => ledgerLine({ time, session, kase: r.kase, q: r.q, a: r.a,
      // A row type may carry content past the default bound (the pain row holds complete option texts).
      ...(r.answerMax === undefined ? {} : { answerMax: r.answerMax }),
      // Who decided the call (spec §9): absent on a 0.9.1-shaped row, so those stay byte-identical.
      ...(r.src === undefined ? {} : { src: r.src }),
      why: `decisionId=${frame.id}; ${redactedReason}` }))
    await frame.budget.run('final', async signal => {
      const path = await io.ledgerPath()
      frame.budget.check()
      if (!frame.lease.fresh()) throw new Error('stale authority')
      signal.throwIfAborted()
      if (!(await io.appendLine(`${path}.decisions.jsonl`, JSON.stringify(record)))) throw new Error('decision attribution not writable')
      frame.budget.check()
      if (!frame.lease.fresh()) throw new Error('stale authority')
      if (!(await io.appendLine(path, humanLines.join('\n')))) throw new Error('ledger not writable')
      frame.budget.check()
      if (!frame.lease.fresh()) throw new Error('stale after ledger')
    })
  } catch (err) {
    // Any failure — validation, write or timeout — publishes manual/failure and never authorizes
    // action. Bound the notification by remaining time; it may publish, never release.
    await notifyFailure(io, frame, session, err)
    throw err
  }
}

async function notifyFailure(io: DecisionIO, frame: DecisionFrame, session: string, err: unknown): Promise<void> {
  try { await io.fail(session, oneLine(`decision not recorded: ${String(err)}`, 200)) } catch { /* failure publishing is best effort; the caller abstains regardless */ }
  try { frame.budget.cancel() } catch { /* a cancelled budget cannot change the outcome */ }
}
