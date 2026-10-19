// The shared decision (slice 2 plan, Task 4; design §3, §4): the one place a permission is
// planned and a judge's reply is settled. The Claude Code mod (Task 5) and the OMP extension
// (Task 6) are thin adapters over this module, so neither host carries policy the other lacks.
//
// Skill-first, per piece. The floor (Q3) reads open shell text and only adds a stop; the routing
// check (Q3) only adds a judgment. The one release here is Task 3's exact park match (Q2: our own
// state files, ids we mint, exact string equality) — seat-written text never reaches 'release',
// because only a park the store holds with the operator's approval on it can match. The red lines
// in the judge's prompt are prose (Q1). settlePermission allows only the judge's unambiguous
// "allow" with no red line named: a red-line allow, an "ask", and an unparseable reply all park.

import type { Grant } from './authority'
import { floorFindings, redLineOf, routes } from './never'
import type { NeverRule, Where } from './never'
import { PARKS_DIR_MARK, matches } from './parks'
import type { Park } from './parks'
import { permissionPrompt } from './prompts'
import type { FloorNote } from './prompts'
import type { PermissionVerdict } from './verdict'

export type PermissionInput = { tool: string; input: unknown; command: string | null; cwd: string; where: Where }

export type DecideContext = {
  policy: string
  recent: string
  role: string | null
  grants: readonly Grant[] | null
  parks: readonly Park[]
  now: string
  enabled: readonly NeverRule[]
}

export type Plan =
  | { kind: 'release'; park: Park }
  | { kind: 'park'; source: 'floor' | 'integrity'; redLine: 1 | 2 | 3 | null; reason: string }
  | { kind: 'pass' }
  | { kind: 'judge'; prompt: string; notes: FloorNote[] }

// The whole input as text, the way routes() reads it: quotes included, case folded. The mark names
// the park store, so any call carrying it is parked by the integrity guard (call 3): only the
// operator clears a park, and a seat that writes its own approval file finds this in the way.
function namesParkStore(input: unknown): boolean {
  const text = typeof input === 'string' ? input : input === undefined || input === null ? '' : JSON.stringify(input) ?? ''
  return text.toLowerCase().includes(PARKS_DIR_MARK)
}

// The plan's order: an approved matching park releases; an ask-level enabled finding parks
// (floor); a park-store path parks (integrity); no route and no fork-level finding passes; else
// the judge. A finding whose rule the operator dropped from `enabled` never parks — the call is
// judged like any other routed call.
export function planPermission(i: PermissionInput, c: DecideContext): Plan {
  const command = i.command ?? ''
  for (const p of c.parks) if (matches(p, { tool: i.tool, command, cwd: i.cwd }, c.now)) return { kind: 'release', park: p }
  const findings = i.command === null ? [] : floorFindings(i.command, i.where).findings.filter(f => c.enabled.includes(f.rule))
  const asks = findings.filter(f => f.level === 'ask')
  if (asks.length > 0) {
    const rules = [...new Set(asks.map(f => f.rule))]
    return { kind: 'park', source: 'floor', redLine: redLineOf(rules[0]!), reason: `never-approve: ${rules.join(', ')}` }
  }
  if (namesParkStore(i.input)) return { kind: 'park', source: 'integrity', redLine: null, reason: `the call names the park store (${PARKS_DIR_MARK}): only the operator clears a park` }
  const notes = findings.filter(f => f.level === 'fork')
  if (!routes({ tool: i.tool, input: i.input }) && notes.length === 0) return { kind: 'pass' }
  return { kind: 'judge', prompt: permissionPrompt(i.tool, i.input, c.policy, c.recent, notes, { role: c.role, grants: c.grants }), notes }
}

export type Settled = { kind: 'allow'; reason: string } | { kind: 'park'; source: 'judge'; redLine: 1 | 2 | 3 | 4 | 5 | 6 | null; reason: string }

// Review Focus 4: a judge reply that names a red line and says "allow", and a reply that does not
// parse, both park; neither allows. An "ask" parks too, under autopilot (call 1).
export function settlePermission(v: PermissionVerdict | undefined): Settled {
  if (v !== undefined && v.decision === 'allow' && v.red_line === null) return { kind: 'allow', reason: v.reason }
  if (v === undefined) return { kind: 'park', source: 'judge', redLine: null, reason: 'the judge did not answer' }
  return { kind: 'park', source: 'judge', redLine: v.red_line, reason: v.reason }
}
