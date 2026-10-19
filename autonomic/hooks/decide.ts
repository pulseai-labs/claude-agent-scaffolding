// The shared decision (slice 2 plan, Task 4; design §3, §4): the one place a permission is
// planned and a judge's reply is settled. The Claude Code mod (Task 5) and the OMP extension
// (Task 6) are thin adapters over this module, so neither host carries policy the other lacks.
//
// Skill-first, per piece. The floor (Q3) reads open shell text and only adds a stop; the routing
// check (Q3) only adds a judgment; Task 7a's operator-route guard (Q3) only adds a stop — a call
// that invokes /autopilot approve|drop parks as integrity, on both hosts. The one release here is
// Task 3's exact park match (Q2: our own
// state files, ids we mint, exact string equality) — seat-written text never reaches 'release',
// because only a park the store holds with the operator's approval on it can match. The red lines
// in the judge's prompt are prose (Q1). settlePermission allows only the judge's unambiguous
// "allow" with no red line named: a red-line allow, an "ask", and an unparseable reply all park.

import type { Grant } from './authority'
import { floorFindings, namesParkStore, redLineOf, routes } from './never'
import type { NeverRule, Where } from './never'
import { PARKS_DIR_MARK, callKey, matches } from './parks'
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

// The whole input and the call's cwd are read by never.ts's namesParkStore (normalized and
// segment-bounded): the mark names the park store, so any call carrying it is parked by the
// integrity guard (call 3). Only the operator clears a park, and a seat that writes its own
// approval file finds this in the way.

// The operator's own approval route invoked from a tool call (Task 7a). A model's Skill call to a
// mod command is refused by the Claude Code host, but the attempt still reaches tool.check first
// as {tool:"Skill", input:{skill:"autopilot"|"/autopilot", args:"approve <id>"}} (Task 5's probe);
// a command line carrying the invocation is the other shape. Skill-first Q3: it only adds a stop —
// a text route that merely mentions the words parks too, which is the safe direction. The tool's
// name is not read: the shape is the signature, whatever a host calls the tool.
const TEXT_ROUTE = /\/autopilot\s+(approve|drop)\b/i
const SKILL_ARGS = /^\s*(approve|drop)\b/i
const verbOf = (m: RegExpExecArray): 'approve' | 'drop' => (m[1]!.toLowerCase() === 'drop' ? 'drop' : 'approve')

export function invokesParkCommand(call: { tool: string; input: unknown; command: string | null }): 'approve' | 'drop' | null {
  const text = call.command === null ? null : TEXT_ROUTE.exec(call.command)
  if (text !== null) return verbOf(text)
  const input = call.input
  if (input !== null && typeof input === 'object') {
    const o = input as { skill?: unknown; args?: unknown }
    if (typeof o.skill === 'string' && o.skill.replace(/^\/+/, '') === 'autopilot' && typeof o.args === 'string') {
      const args = SKILL_ARGS.exec(o.args)
      if (args !== null) return verbOf(args)
    }
  }
  return null
}

// The plan's order: an approved matching park releases; an ask-level enabled finding parks
// (floor); a park-store path or an operator-route invocation parks (integrity); no route and no
// fork-level finding passes; else
// the judge. A finding whose rule the operator dropped from `enabled` never parks — the call is
// judged like any other routed call.
export function planPermission(i: PermissionInput, c: DecideContext): Plan {
  const key = callKey(i)
  for (const p of c.parks) if (matches(p, { tool: i.tool, command: key, cwd: i.cwd }, c.now)) return { kind: 'release', park: p }
  const findings = i.command === null ? [] : floorFindings(i.command, i.where).findings.filter(f => c.enabled.includes(f.rule))
  const asks = findings.filter(f => f.level === 'ask')
  if (asks.length > 0) {
    const rules = [...new Set(asks.map(f => f.rule))]
    return { kind: 'park', source: 'floor', redLine: redLineOf(rules[0]!), reason: `never-approve: ${rules.join(', ')}` }
  }
  if (namesParkStore(i.input, i.cwd)) return { kind: 'park', source: 'integrity', redLine: null, reason: `the call names the park store (${PARKS_DIR_MARK}): only the operator clears a park` }
  const invocation = invokesParkCommand(i)
  if (invocation !== null) return { kind: 'park', source: 'integrity', redLine: null, reason: `the call invokes /autopilot ${invocation}: only the operator ${invocation === 'approve' ? 'approves' : 'clears'} a park` }
  const notes = findings.filter(f => f.level === 'fork')
  if (!routes({ tool: i.tool, input: i.input, cwd: i.cwd }) && notes.length === 0) return { kind: 'pass' }
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
