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
// Settings that retired with the turn-end judge in 0.11.0 (design #873 §5.1). A stored value
// loads: it is skipped, never a problem, and the status line names it as retired.
export const RETIRED_SETTINGS = ['loopMax', 'tailChars', 'yieldAtPercent'] as const
export type RetiredSetting = (typeof RETIRED_SETTINGS)[number]

export type AutonomicConfig = {
  policyPath: string
  bell?: string
  neverApprove: NeverRule[]
  // The retired names the operator's setting named, in the order given: the status line says
  // they are now judged. Empty when none were given.
  retired: RetiredRule[]
  // The retired turn-end settings present in the stored config, in RETIRED_SETTINGS order.
  retiredSettings: RetiredSetting[]
  // The model a judgment asks through `$.model.complete` when set (0.10.0 call 8); that call
  // sees the prompt alone. Absent: the judge forks the session's own model, as before. OMP's
  // isolated side turn always runs the session model, so on OMP a set value is a status line,
  // never a problem and never policy.
  decidingModel?: string
  // Absent: never.ts's DEFAULT_READERS. Set only when the readers key is given (0.4.3 §3.5).
  readers?: string[][]
  problems: string[]
}

export const DEFAULTS: AutonomicConfig = {
  policyPath: '~/.claude/autonomic/policy.md',
  neverApprove: [...NEVER_RULES],
  retired: [],
  retiredSettings: [],
  problems: [],
}

// The one status line a setting that named retired rules earns: absent when none were given.
export const retiredNote = (retired: readonly RetiredRule[]): string | undefined =>
  retired.length === 0 ? undefined : `retired in 0.10.0, now judged: ${retired.join(' ')}`

// The status line a stored turn-end setting earns: absent when none was stored.
export const retiredSettingsNote = (retired: readonly string[]): string | undefined =>
  retired.length === 0 ? undefined : `retired in 0.11.0 (the turn end is no longer judged): ${retired.join(' ')}`

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)

export function parseConfig(options: Readonly<Record<string, unknown>> | undefined): AutonomicConfig {
  const o = options ?? {}
  const problems: string[] = []
  // A stored turn-end setting is ignored, not rejected; the status line names it once.
  const retiredSettings: string[] = RETIRED_SETTINGS.filter(name => Object.prototype.hasOwnProperty.call(o, name))
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
  // Like `bell`: absent stays absent, and blank is absent.
  const decidingModel = str(o.decidingModel)
  const base: AutonomicConfig = { policyPath: str(o.policyPath) ?? DEFAULTS.policyPath, neverApprove, retired, retiredSettings, problems }
  // readers: command prefixes separated by ;. An empty string is none.
  const withReaders = typeof o.readers === 'string' ? { ...base, readers: parseReaders(o.readers) } : base
  const withModel = decidingModel === undefined ? withReaders : { ...withReaders, decidingModel }
  return bell === undefined ? withModel : { ...withModel, bell }
}
