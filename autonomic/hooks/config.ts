// autonomic's settings: the manifest's userConfig values. A bad number falls back to
// its default and the problem is reported, never silently clamped.

import type { NeverRule } from './never'
import { parseReaders } from './never'

// The coded never-approve rules (never.ts) the operator can toggle with neverApprove.
export const NEVER_RULES: readonly NeverRule[] = ['force-push', 'default-branch-push', 'branch-delete', 'rm-outside', 'no-verify', 'unreadable']

export type AutonomicConfig = {
  policyPath: string
  bell?: string
  loopMax: number
  tailChars: number
  yieldAtPercent: number
  neverApprove: NeverRule[]
  // Absent: never.ts's DEFAULT_READERS. Set only when the readers key is given (0.4.3 §3.5).
  readers?: string[][]
  problems: string[]
}

export const DEFAULTS: AutonomicConfig = {
  policyPath: '~/.claude/autonomic/policy.md',
  loopMax: 3,
  tailChars: 4000,
  yieldAtPercent: 65,
  neverApprove: [...NEVER_RULES],
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
  // An empty string is none; an absent value is all six; an unknown name is reported.
  let neverApprove: NeverRule[] = [...NEVER_RULES]
  if (typeof o.neverApprove === 'string') {
    neverApprove = []
    for (const name of o.neverApprove.split(/[\s,]+/).filter(Boolean)) {
      if ((NEVER_RULES as readonly string[]).includes(name)) { if (!neverApprove.includes(name as NeverRule)) neverApprove.push(name as NeverRule) }
      else problems.push(`neverApprove: unknown rule "${name}" (known: ${NEVER_RULES.join(' ')})`)
    }
  }
  const bell = str(o.bell)
  const base: AutonomicConfig = { policyPath: str(o.policyPath) ?? DEFAULTS.policyPath, loopMax: Math.floor(loopMax), tailChars: Math.floor(tailChars), yieldAtPercent, neverApprove, problems }
  // readers: command prefixes separated by ;. An empty string is none.
  const withReaders = typeof o.readers === 'string' ? { ...base, readers: parseReaders(o.readers) } : base
  return bell === undefined ? withReaders : { ...withReaders, bell }
}
