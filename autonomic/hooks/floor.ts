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

// molt 0.2.1's stage file: { stage, … }. Anything unreadable is no file.
const STAGES = new Set(['below', 'warn', 'warnAgain', 'command', 'block', 'fallback', 'off'])
export function parseStage(text: string | undefined): string | undefined {
  try {
    const v = JSON.parse(text ?? '') as { stage?: unknown } | null
    return typeof v?.stage === 'string' && STAGES.has(v.stage) ? v.stage : undefined
  } catch {
    return undefined
  }
}
// The stage file's effective handoff command, so a live fill past it yields though molt has
// not yet rewritten the file this turn (final review I2).
export function parseStageCommand(text: string | undefined): number | undefined {
  try {
    const v = JSON.parse(text ?? '') as { command?: unknown } | null
    return typeof v?.command === 'number' && Number.isFinite(v.command) ? v.command : undefined
  } catch {
    return undefined
  }
}
export const stageYields = (stage: string | undefined): boolean => stage === 'command' || stage === 'block' || stage === 'fallback'
