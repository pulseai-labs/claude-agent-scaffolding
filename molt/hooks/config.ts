// molt's settings: the manifest's userConfig values, checked as a set. A threshold set
// that breaks soft < hard and hard + fallback <= 99 falls back to the defaults as a
// whole, and the problem is reported; it is never silently clamped.

export type MoltConfig = {
  soft: number
  hard: number
  fallback: number
  minRoom: number
  manualMaxMolts: number
  instructionsTemplate: string
  seedTemplate: string
  problems: string[]
}

export const DEFAULTS: MoltConfig = {
  soft: 50,
  hard: 65,
  fallback: 5,
  minRoom: 15,
  manualMaxMolts: 2,
  instructionsTemplate: '~/.claude/molt/instructions.md',
  seedTemplate: '~/.claude/molt/seed.md',
  problems: [],
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)

export function parseConfig(options: Readonly<Record<string, unknown>> | undefined): MoltConfig {
  const o = options ?? {}
  const problems: string[] = []
  let soft = num(o.softPercent) ?? DEFAULTS.soft
  let hard = num(o.hardPercent) ?? DEFAULTS.hard
  let fallback = num(o.fallbackMargin) ?? DEFAULTS.fallback
  if (!(soft > 0 && soft < hard && fallback > 0 && hard + fallback <= 99)) {
    problems.push(`thresholds soft=${soft} hard=${hard} fallback=+${fallback} break soft < hard and hard + fallback <= 99; ` +
      `using ${DEFAULTS.soft}/${DEFAULTS.hard}/+${DEFAULTS.fallback}`)
    soft = DEFAULTS.soft
    hard = DEFAULTS.hard
    fallback = DEFAULTS.fallback
  }
  const minRoom = num(o.minRoomPercent)
  const manualMaxMolts = num(o.manualMaxMolts)
  return {
    soft,
    hard,
    fallback,
    minRoom: minRoom !== undefined && minRoom > 0 && minRoom < 100 ? minRoom : DEFAULTS.minRoom,
    manualMaxMolts: manualMaxMolts !== undefined && manualMaxMolts >= 1 ? Math.floor(manualMaxMolts) : DEFAULTS.manualMaxMolts,
    instructionsTemplate: str(o.instructionsTemplate) ?? DEFAULTS.instructionsTemplate,
    seedTemplate: str(o.seedTemplate) ?? DEFAULTS.seedTemplate,
    problems,
  }
}
