// Reading the fork's JSON. undefined means the reply did not parse (one retry, then
// pain); a valid "not covered" sends the question to the operator.

export type Question = { question: string; header?: string; options?: ReadonlyArray<{ label: string }>; multiSelect?: boolean }
export type AskVerdict = { covered: true; answers: Record<string, string>; reason: string } | { covered: false; reason: string }
export type PermissionVerdict = { decision: 'allow' | 'ask'; red_line: 1 | 2 | 3 | 4 | 5 | 6 | null; reason: string }

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
// 0.10.0: the judge names the red line it saw (design §3). A missing or null field means none —
// 0.9.1-shaped replies still parse — and any other shape is unparseable, so decide.ts settles it
// into a park; only an "allow" with no red line ever allows (Review Focus 4).
function redLineIn(v: unknown): PermissionVerdict['red_line'] | undefined {
  if (v === undefined || v === null) return null
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 6) return v as 1 | 2 | 3 | 4 | 5 | 6
  return undefined
}

export function parsePermission(text: string): PermissionVerdict | undefined {
  const v = jsonOf(text)
  if (!isObj(v)) return undefined
  const reason = str(v.reason)
  if (reason === undefined) return undefined
  const decision = v.decision === 'allow' ? 'allow' : v.decision === 'ask' || v.decision === 'deny' ? 'ask' : undefined
  if (decision === undefined) return undefined
  const redLine = redLineIn(v.red_line)
  if (redLine === undefined) return undefined
  return { decision, red_line: redLine, reason }
}
