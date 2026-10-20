// The molt stage file's reader: /autopilot status names the session's current stage. The
// turn-end yield helpers retired with the judge in 0.11.0 (#873); nothing reads a stage to
// decide a stop any more.

// molt 0.2.1's stage file: { stage, … }. Anything unreadable is no file.
const STAGES: Record<string, true> = { below: true, warn: true, warnAgain: true, command: true, block: true, fallback: true, off: true }
export function parseStage(text: string | undefined): string | undefined {
  try {
    const v = JSON.parse(text ?? '') as { stage?: unknown } | null
    return typeof v?.stage === 'string' && STAGES[v.stage] === true ? v.stage : undefined
  } catch {
    return undefined
  }
}
