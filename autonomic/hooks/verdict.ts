// Reading the fork's JSON. undefined means the reply did not parse (one retry, then
// pain); a valid "not covered" sends the question to the operator.

export const TURN_CASES = ['covered', 'stalled', 'waiting', 'done', 'pain'] as const
export type TurnCase = (typeof TURN_CASES)[number]
export type PainOption = { label: string; text: string; recommended: boolean }
export type TurnVerdict = { case: TurnCase; question?: string; answer?: string; next_step?: string; reason: string; options?: PainOption[]; credential?: string }

export type Question = { question: string; header?: string; options?: ReadonlyArray<{ label: string }>; multiSelect?: boolean }
export type AskVerdict = { covered: true; answers: Record<string, string>; reason: string } | { covered: false; reason: string }
export type PermissionVerdict = { decision: 'allow' | 'ask'; reason: string }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)

// The first { through the last }: a reply may wrap its JSON in a fence or a sentence.
export function jsonOf(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

export function parseTurn(text: string): TurnVerdict | undefined {
  const v = jsonOf(text)
  if (!isObj(v)) return undefined
  const kase = TURN_CASES.find(c => c === v.case)
  const reason = str(v.reason)
  if (kase === undefined || reason === undefined) return undefined
  const out: TurnVerdict = { case: kase, reason }
  const question = str(v.question)
  const answer = str(v.answer)
  const nextStep = str(v.next_step)
  if (question !== undefined) out.question = question
  if (answer !== undefined) out.answer = answer
  if (nextStep !== undefined) out.next_step = nextStep
  if (kase === 'covered' && answer === undefined) return undefined
  if (kase === 'stalled' && nextStep === undefined) return undefined
  if (kase === 'pain') {
    const options = painOptions(v.options)
    if (options !== undefined) out.options = options
    // 0.4.1: a credential is asked on its own line, in plain text, never as an option.
    const credential = str(v.credential)
    if (credential !== undefined) out.credential = credential
  }
  return out
}

// A pain's options (0.3.0 spec §3.2.1): 1–3 of them, each with a label and a text, at most
// one recommended. Any other shape drops them all, and the pain stands without them. A text
// is never cut: the band shows whole what a press submits, so an overlong one is a bad shape.
export const MAX_OPTION_TEXT = 300
export function painOptions(v: unknown): PainOption[] | undefined {
  if (!Array.isArray(v) || v.length === 0 || v.length > 3) return undefined
  const out: PainOption[] = []
  for (const o of v) {
    if (!isObj(o)) return undefined
    const label = str(o.label)
    const text = str(o.text)
    if (label === undefined || text === undefined || text.length > MAX_OPTION_TEXT) return undefined
    if (o.recommended !== undefined && typeof o.recommended !== 'boolean') return undefined
    out.push({ label, text, recommended: o.recommended === true })
  }
  return out.filter(o => o.recommended).length > 1 ? undefined : out
}

export function parseAsk(text: string, questions: readonly Question[]): AskVerdict | undefined {
  const v = jsonOf(text)
  if (!isObj(v)) return undefined
  const reason = str(v.reason)
  if (v.covered === false) return { covered: false, reason: reason ?? 'not covered' }
  if (v.covered !== true || !isObj(v.answers) || reason === undefined) return undefined
  const answers: Record<string, string> = {}
  for (const q of questions) {
    const a = v.answers[q.question]
    if (typeof a !== 'string') return { covered: false, reason: `no answer named for "${q.question}"` }
    const allowed = new Set((q.options ?? []).map(o => o.label))
    // A multi-select answer is labels joined by commas: a label holding a comma cannot be read back.
    if (q.multiSelect && [...allowed].some(l => l.includes(',')))
      return { covered: false, reason: `a label of "${q.question}" holds a comma: the operator answers` }
    const labels = q.multiSelect ? a.split(',').map(s => s.trim()) : [a]
    if (labels.length === 0 || labels.some(l => !allowed.has(l)))
      return { covered: false, reason: `"${a}" is not an option of "${q.question}"` }
    answers[q.question] = labels.join(', ')
  }
  return { covered: true, answers, reason }
}

// autonomic never denies: a fork's "deny" leaves the ask in place.
export function parsePermission(text: string): PermissionVerdict | undefined {
  const v = jsonOf(text)
  if (!isObj(v)) return undefined
  const reason = str(v.reason)
  if (reason === undefined) return undefined
  if (v.decision === 'allow') return { decision: 'allow', reason }
  if (v.decision === 'ask' || v.decision === 'deny') return { decision: 'ask', reason }
  return undefined
}
