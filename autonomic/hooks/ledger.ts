// The decision ledger (spec §1, D6): one line per decision autonomic takes in place of
// the operator. autonomic only appends; the session's own commits carry the file.

export type LedgerCase = 'covered' | 'stalled' | 'done' | 'pain' | 'molt' | 'ask' | 'permission'
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

export function oneLine(s: string, max = 300): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function ledgerLine(e: { time: string; session: string; kase: LedgerCase; q: string; a: string; why: string; usage?: Usage }): string {
  const base = `- ${e.time} · ${e.session} · ${e.kase} · Q: ${oneLine(e.q)} · A: ${oneLine(e.a)} · why: ${oneLine(e.why)}`
  const u = e.usage
  if (u === undefined) return base
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  return `${base} · usage: in=${input} cached=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens ?? 0}`
}
