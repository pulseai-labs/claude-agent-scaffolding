// The decision ledger (spec §1, D6): one line per decision autonomic takes in place of
// the operator. autonomic only appends; the session's own commits carry the file.

// The cases still written: `ask`, `permission`, `pain` (an OMP ask left with the operator, since
// 0.11.0) and `operator` (an OMP park approved or dropped). `covered`, `stalled`, `done`, the
// turn-end `pain` and `molt` retired with the turn-end judge in 0.11.0 (#873) and are no longer
// written; old rows stay readable, so the type keeps them.
export type LedgerCase = 'covered' | 'stalled' | 'done' | 'pain' | 'molt' | 'ask' | 'permission' | 'operator'
// Who decided (spec §9, ledger completeness): the floor, the judge, a grant, the operator's
// approval of a park, or the integrity guard. A row without it is the 0.9.1 line.
export type LedgerSource = 'floor' | 'judge' | 'grant' | 'operator' | 'integrity'
export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export function ledgerPathFor(env: string | undefined, root: string): string {
  const base = root.replace(/\/+$/, '')
  const v = (env ?? '').trim()
  if (v === '') return `${base}/.autonomic/ledger.md`
  return v.startsWith('/') ? v : `${base}/${v}`
}

// A credential never reaches the committed ledger, a notice or a pain file (PR #681):
// URL user info, NAME_TOKEN=… style assignments, --token/--password values, an
// Authorization or Bearer value — bare or quoted — and known token shapes anywhere.
const VALUE = `(?:"[^"]*"|'[^']*'|[^\\s"']+)`
const HEADER = '[A-Za-z0-9-]*(?:authorization|key|token|secret|cookie|password|session)[A-Za-z0-9-]*'
const SECRETS: ReadonlyArray<[RegExp, string]> = [
  // A quoted header loses everything up to its closing quote: spaces and ; included (round 7).
  [new RegExp(`(["'])(${HEADER}:\\s*)[^"'\\n]*`, 'gi'), '$1$2***'],
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@'],
  [new RegExp(`\\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|AUTH)[A-Za-z0-9_]*)=${VALUE}`, 'gi'), '$1=***'],
  [new RegExp(`(--?(?:token|password|passwd|secret|api-?key|auth))(=|\\s+)${VALUE}`, 'gi'), '$1$2***'],
  [/\b(Authorization:\s*)(?:\w+\s+)?[^\s"']+/gi, '$1***'],
  [/\b(Bearer)\s+[^\s"']+/gi, '$1 ***'],
  [/\b([A-Za-z0-9-]*(?:key|token|secret|cookie|password|session)[A-Za-z0-9-]*:\s*)[^\s"']+/gi, '$1***'],
  [/\b(?:gh[pousr]_|github_pat_|sk-|xox[abprs]-|glpat-)[A-Za-z0-9_-]+|\bAKIA[A-Z0-9]{16}\b/g, '***'],
]
export const redact = (s: string): string => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s)

export function oneLine(s: string, max = 300): string {
  const t = redact(s).replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

// `answerMax` lets one row type carry content longer than the default 300-character bound (the pain
// row holds up to three complete validated option texts); every other row keeps the default clamp.
export function ledgerLine(e: { time: string; session: string; kase: LedgerCase; q: string; a: string; why: string; usage?: Usage; answerMax?: number; src?: LedgerSource }): string {
  const src = e.src === undefined ? '' : ` · src: ${e.src}`
  const base = `- ${e.time} · ${e.session} · ${e.kase} · Q: ${oneLine(e.q)} · A: ${oneLine(e.a, e.answerMax ?? 300)} · why: ${oneLine(e.why)}${src}`
  const u = e.usage
  if (u === undefined) return base
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  return `${base} · usage: in=${input} cached=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens ?? 0}`
}
