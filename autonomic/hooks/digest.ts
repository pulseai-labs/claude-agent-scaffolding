import { oneLine, redact } from './ledger'
import { inputShape } from './shape'

// The turn digest (0.4.0 spec §3.2): what happened in a session since the fork's transcript
// was sent. One redacted line per entry, kept in memory and shown only to the permission and
// ask forks. Nothing here reaches disk.

export const DIGEST_MAX_ENTRIES = 12
export const DIGEST_ENTRY_CHARS = 400
export const DIGEST_TOTAL_CHARS = 4000
export const TOOL_TAIL_CHARS = 300

export type Origin = { kind: string; name?: string; asUser?: true }

export function originLabel(o: Origin): string {
  // A pain-band press is submitted asUser: it is the operator's choice (PR #694 F3).
  if (o.kind === 'composer' || o.kind === 'bridge' || o.asUser === true) return 'operator'
  if (o.kind === 'plugin') return `plugin ${o.name ?? 'unknown'}`
  return o.kind
}

// redact() takes quadratic time on a long run without spaces (a 1 MB result took minutes), so
// only a bounded window of the text is redacted. The word the window's edge cuts is dropped:
// a credential cut off from its prefix is never shown in part.
const WINDOW_CHARS = 4 * DIGEST_ENTRY_CHARS
// Whitespace collapses first (linear), so padding cannot push a credential's prefix out of the
// window and leave its value behind (PR #694 R5-B).
function head(raw: string): string {
  const text = raw.replace(/\s+/g, ' ')
  if (text.length <= WINDOW_CHARS) return text
  return `${text.slice(0, WINDOW_CHARS).replace(/\S*$/, '')}…`
}
function end(raw: string): string {
  const text = raw.replace(/\s+/g, ' ')
  if (text.length <= WINDOW_CHARS) return text
  return text.slice(-WINDOW_CHARS).replace(/^\S*/, '')
}

export function promptEntry(origin: Origin, text: string): string {
  return oneLine(`prompt (${originLabel(origin)}): ${head(text)}`, DIGEST_ENTRY_CHARS)
}

// The tail is cut after redaction, so a cut never splits a credential out of its pattern.
function tail(text: string | undefined): string {
  if (text === undefined || text.trim() === '') return '(no text)'
  const t = redact(end(text)).replace(/\s+/g, ' ').trim()
  // The window was one word, and the edge cut it: say so rather than show a bare "result:".
  if (t === '') return '(one long token)'
  return t.length > TOOL_TAIL_CHARS ? `…${t.slice(-TOOL_TAIL_CHARS)}` : t
}

export function toolEntry(tool: string, input: unknown, r: { text?: string; deny?: string; isError?: true }): string {
  const what = inputShape(input)
  const status = r.deny !== undefined ? `denied: ${r.deny}` : r.isError ? `error: ${tail(r.text)}` : `result: ${tail(r.text)}`
  return oneLine(`tool ${tool}${what === '' ? '' : ` ${what}`} → ${status}`, DIGEST_ENTRY_CHARS)
}

export function pushEntry(entries: readonly string[], entry: string): string[] {
  return [...entries, entry].slice(-DIGEST_MAX_ENTRIES)
}

// Newest last; the oldest entries go first when the block would pass its bound.
export function renderDigest(entries: readonly string[]): string {
  const out: string[] = []
  let total = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] ?? ''
    if (total + e.length + 1 > DIGEST_TOTAL_CHARS) break
    out.unshift(e)
    total += e.length + 1
  }
  return out.join('\n')
}
