// molt's settings: the manifest's userConfig values, checked as a set. A ladder that
// breaks warn < warnAgain < command < block and block + fallback <= 99 falls back to the
// defaults as a whole, and the problem is reported; it is never silently clamped.
// 0.1.0's softPercent and hardPercent are read once as commandPercent and blockPercent.

export type MoltConfig = {
  warn: number
  warnAgain: number
  command: number
  block: number
  fallback: number
  minRoom: number
  manualMaxMolts: number
  instructionsTemplate: string
  warningTemplate: string
  seedTemplate: string
  problems: string[]
}

export const DEFAULTS: MoltConfig = {
  warn: 40,
  warnAgain: 50,
  command: 65,
  block: 75,
  fallback: 5,
  minRoom: 15,
  manualMaxMolts: 2,
  instructionsTemplate: '~/.claude/molt/instructions.md',
  warningTemplate: '~/.claude/molt/warning.md',
  seedTemplate: '~/.claude/molt/seed.md',
  problems: [],
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)

export function parseConfig(options: Readonly<Record<string, unknown>> | undefined): MoltConfig {
  const o = options ?? {}
  const problems: string[] = []
  let command = num(o.commandPercent)
  if (command === undefined && num(o.softPercent) !== undefined) {
    command = num(o.softPercent)
    problems.push(`softPercent is now commandPercent (${command})`)
  }
  let block = num(o.blockPercent)
  if (block === undefined && num(o.hardPercent) !== undefined) {
    block = num(o.hardPercent)
    problems.push(`hardPercent is now blockPercent (${block})`)
  }
  let warn = num(o.warnPercent) ?? DEFAULTS.warn
  let warnAgain = num(o.warnAgainPercent) ?? DEFAULTS.warnAgain
  command = command ?? DEFAULTS.command
  block = block ?? DEFAULTS.block
  let fallback = num(o.fallbackMargin) ?? DEFAULTS.fallback
  if (!(warn > 0 && warn < warnAgain && warnAgain < command && command < block && fallback > 0 && block + fallback <= 99)) {
    problems.push(`thresholds warn=${warn} warnAgain=${warnAgain} command=${command} block=${block} fallback=+${fallback} ` +
      `break warn < warnAgain < command < block and block + fallback <= 99; ` +
      `using ${DEFAULTS.warn}/${DEFAULTS.warnAgain}/${DEFAULTS.command}/${DEFAULTS.block}/+${DEFAULTS.fallback}`)
    warn = DEFAULTS.warn
    warnAgain = DEFAULTS.warnAgain
    command = DEFAULTS.command
    block = DEFAULTS.block
    fallback = DEFAULTS.fallback
  }
  const minRoom = num(o.minRoomPercent)
  const manualMaxMolts = num(o.manualMaxMolts)
  return {
    warn,
    warnAgain,
    command,
    block,
    fallback,
    minRoom: minRoom !== undefined && minRoom > 0 && minRoom < 100 ? minRoom : DEFAULTS.minRoom,
    manualMaxMolts: manualMaxMolts !== undefined && manualMaxMolts >= 1 ? Math.floor(manualMaxMolts) : DEFAULTS.manualMaxMolts,
    instructionsTemplate: str(o.instructionsTemplate) ?? DEFAULTS.instructionsTemplate,
    warningTemplate: str(o.warningTemplate) ?? DEFAULTS.warningTemplate,
    seedTemplate: str(o.seedTemplate) ?? DEFAULTS.seedTemplate,
    problems,
  }
}
