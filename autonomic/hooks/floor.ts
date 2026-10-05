// The code floor that yields a turn end to molt (amendment A2): exact facts, read before
// any fork. The marker regex is molt's (molt/hooks/handoff.ts MARKER_LINE), less the capture.

const MARKER_LINE = /^[ \t]*MOLT-HANDOFF:[ \t]*\S/m

export function hasMoltMarker(text: string): boolean {
  return MARKER_LINE.test(text)
}

// molt appends '<ISO time> <event>' lines to a child's MOLT_STATUS_PATH.
export function statusYields(text: string | undefined): boolean {
  const last = (text ?? '').split('\n').map(l => l.trim()).filter(Boolean).at(-1)
  if (last === undefined) return false
  const event = last.replace(/^\S+\s+/, '')
  return event === 'handoff required' || event.startsWith('handed-off ')
}
