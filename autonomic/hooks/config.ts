// autonomic's settings: the manifest's userConfig values. A bad number falls back to
// its default and the problem is reported, never silently clamped.

export type AutonomicConfig = {
  policyPath: string
  bell?: string
  loopMax: number
  tailChars: number
  yieldAtPercent: number
  problems: string[]
}

export const DEFAULTS: AutonomicConfig = {
  policyPath: '~/.claude/autonomic/policy.md',
  loopMax: 3,
  tailChars: 4000,
  yieldAtPercent: 65,
  problems: [],
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)

export function parseConfig(options: Readonly<Record<string, unknown>> | undefined): AutonomicConfig {
  const o = options ?? {}
  const problems: string[] = []
  let loopMax = num(o.loopMax) ?? DEFAULTS.loopMax
  if (loopMax < 1) { problems.push(`loopMax=${loopMax} is below 1; using ${DEFAULTS.loopMax}`); loopMax = DEFAULTS.loopMax }
  let tailChars = num(o.tailChars) ?? DEFAULTS.tailChars
  if (tailChars < 500) { problems.push(`tailChars=${tailChars} is below 500; using ${DEFAULTS.tailChars}`); tailChars = DEFAULTS.tailChars }
  let yieldAtPercent = num(o.yieldAtPercent) ?? DEFAULTS.yieldAtPercent
  if (yieldAtPercent < 1 || yieldAtPercent > 99) { problems.push(`yieldAtPercent=${yieldAtPercent} is outside 1-99; using ${DEFAULTS.yieldAtPercent}`); yieldAtPercent = DEFAULTS.yieldAtPercent }
  const bell = str(o.bell)
  const base = { policyPath: str(o.policyPath) ?? DEFAULTS.policyPath, loopMax: Math.floor(loopMax), tailChars: Math.floor(tailChars), yieldAtPercent, problems }
  return bell === undefined ? base : { ...base, bell }
}
