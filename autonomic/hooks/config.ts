// autonomic's settings: the manifest's userConfig values. A bad number falls back to
// its default and the problem is reported, never silently clamped.

import type { NeverRule } from './never'
import { parseReaders } from './never'

// The coded never-approve rules (never.ts) the operator can toggle with neverApprove.
// 0.10.0 holds red lines 1–3 only: force-push, default-branch-push, no-verify, ai-trailer.
export const NEVER_RULES: readonly NeverRule[] = ['force-push', 'default-branch-push', 'no-verify', 'ai-trailer']
// Rule names that were on the list before 0.10.0 and are judged now. An existing neverApprove
// value that names them still loads: they are skipped, never a problem, and the status line
// says the rule is now judged (0.10.0 call 7).
export const RETIRED_RULES = ['branch-delete', 'rm-outside', 'unreadable'] as const
export type RetiredRule = (typeof RETIRED_RULES)[number]

export type AutonomicConfig = {
  policyPath: string
  bell?: string
  loopMax: number
  tailChars: number
  yieldAtPercent: number
  neverApprove: NeverRule[]
  // The retired names the operator's setting named, in the order given: the status line says
  // they are now judged. Empty when none were given.
  retired: RetiredRule[]
  // Absent: never.ts's DEFAULT_READERS. Set only when the readers key is given (0.4.3 §3.5).
  readers?: string[][]
  // The Claude Code deciding model (0.10.0 call 8). OMP's isolated side turn always runs the
  // session model, so on OMP a set value is a status line, never a problem and never policy.
  decidingModel?: string
  problems: string[]
}

export const DEFAULTS: AutonomicConfig = {
  policyPath: '~/.claude/autonomic/policy.md',
  loopMax: 3,
  tailChars: 4000,
  yieldAtPercent: 65,
  neverApprove: [...NEVER_RULES],
  retired: [],
  problems: [],
}

// The one status line a setting that named retired rules earns: absent when none were given.
export const retiredNote = (retired: readonly RetiredRule[]): string | undefined =>
  retired.length === 0 ? undefined : `retired in 0.10.0, now judged: ${retired.join(' ')}`

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
  // An empty string is none; an absent value is all four; a retired name is skipped with no
  // problem; an unknown name is reported.
  let neverApprove: NeverRule[] = [...NEVER_RULES]
  const retired: RetiredRule[] = []
  if (typeof o.neverApprove === 'string') {
    neverApprove = []
    for (const name of o.neverApprove.split(/[\s,]+/).filter(Boolean)) {
      if ((NEVER_RULES as readonly string[]).includes(name)) { if (!neverApprove.includes(name as NeverRule)) neverApprove.push(name as NeverRule) }
      else if ((RETIRED_RULES as readonly string[]).includes(name)) { if (!retired.includes(name as RetiredRule)) retired.push(name as RetiredRule) }
      else problems.push(`neverApprove: unknown rule "${name}" (known: ${NEVER_RULES.join(' ')})`)
    }
  }
  const bell = str(o.bell)
  const decidingModel = str(o.decidingModel)
  const base: AutonomicConfig = { policyPath: str(o.policyPath) ?? DEFAULTS.policyPath, loopMax: Math.floor(loopMax), tailChars: Math.floor(tailChars), yieldAtPercent, neverApprove, retired, problems, ...(decidingModel === undefined ? {} : { decidingModel }) }
  // readers: command prefixes separated by ;. An empty string is none.
  const withReaders = typeof o.readers === 'string' ? { ...base, readers: parseReaders(o.readers) } : base
  return bell === undefined ? withReaders : { ...withReaders, bell }
}
