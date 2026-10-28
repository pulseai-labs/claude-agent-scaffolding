// seat-mods status logic: the pure functions behind the orchestrator's status
// block check, wired to prompt.submit and turn.complete (#929) by
// register.ts. No `$` and no model call here; the copy is the plans' verbatim
// (AI workspace docs/superpowers/plans/2026-10-18-orchestrator-status-block.md
// and 2026-10-18-idle-stop-status-block.md).

export const STATUS_LABELS: readonly string[] = [
  'What I ruled:',
  'What the PR(s) will carry:',
  'Next steps:',
  'Waiting on (seats live):',
  'Waiting on operator:',
]

export const STATUS_CONTEXT = 'seat-mods (orchestrator): this is a status turn — no operator typed it. Use tool calls only and write no narration. End the turn with only the status block, these five fields, one per line, in this order (a blank line between fields is allowed): **What I ruled:** / **What the PR(s) will carry:** / **Next steps:** / **Waiting on (seats live):** / **Waiting on operator:** — each with content ("none" is content) and nothing before or after. **Waiting on operator:** takes "none", "decision: <question>" or "action: <what the operator must do>". A block that waits on no seat and no operator decision or action while its Next steps names work is not a turn end: do that work first.'

export function rewriteReason(failed: string): string {
  return `seat-mods (orchestrator): a status turn ends with only the five-field status block. ${failed}. Rewrite your reply as the block and nothing else.`
}

export const STATUS_WARNING = '⚠ seat-mods: status block missing — this status reply is not in the required form.'

// The idle-stop copy (#876). The reason is the one block a turn gets for the
// idle check; the warning is the line turn.complete shows when it stands.
export const IDLE_REASON = 'seat-mods (orchestrator): the status block says nothing waits, but Next steps names work. Do the next step now, or name the seat, wake, or operator decision or action you wait on.'

export const IDLE_WARNING = '⚠ seat-mods: status block says nothing waits, but Next steps names work.'

// A message crew sends between sessions starts with the tag (crew 0.3.x). The
// two legacy ping forms also count until no run in flight was dispatched from a
// crew brief older than 0.3.1; the two rotation resume forms count too, because
// a slash command breaks under a tag prefix and herdr delivers them as
// `composer` (the design's origin table).
const CREW_TAG = /^\[crew (?:report|molt|message) [a-z-]+\]/
const LEGACY_PREFIXES = ['REPORT READY: ', 'MOLT WARNING ']
const RESUME_PREFIXES = ['/ossify:handoff-resume ', 'skill://handoff-resume ']

export function isCrewTagged(text: string): boolean {
  const start = text.trimStart()
  return CREW_TAG.test(start)
    || LEGACY_PREFIXES.some(prefix => start.startsWith(prefix))
    || RESUME_PREFIXES.some(prefix => start.startsWith(prefix))
}

// The installed PromptOrigin kinds (Claude Code 2.1.302), each placed
// explicitly: the automated kinds are status; composer, bridge, channel,
// slack-ping and sdk are the operator's unless the text carries a crew tag (an
// sdk turn is a `claude -p` host turn, which may be typed by the operator —
// the anti-goal on typed turns outranks goal 1). A plugin prompt is status
// unless it is molt's handoff request (#929), which is not a status turn: it asks for a
// MOLT-HANDOFF line, never the status block. molt's seed (no MOLT-HANDOFF line) starts the
// next session's work and stays a status turn. `unclassified` and any unknown kind stay
// on the operator fallback; only they are untagged.
export function classifyPrompt(origin: { kind: string; name?: string }, text: string): 'status' | 'operator' {
  switch (origin.kind) {
    case 'task-notification':
    case 'scheduled-trigger':
    case 'peer':
    case 'peer-send-message':
    case 'projects-relay':
    case 'coordinator':
    case 'observer':
    case 'observer-activity':
    case 'auto-continuation':
      return 'status'
    case 'plugin':
      return (origin.name === 'molt' && text.includes('MOLT-HANDOFF:')) && !isCrewTagged(text) ? 'operator' : 'status'
    case 'composer':
    case 'bridge':
    case 'channel':
    case 'slack-ping':
    case 'sdk':
      return isCrewTagged(text) ? 'status' : 'operator'
    default:
      return 'operator'
  }
}

const ESCAPED_LABELS = STATUS_LABELS.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
// A label counts only fully bold or fully plain: `**What I ruled: a` and
// `What I ruled:** a` are malformed, not labels (AI PR #180 round 3).
const LABEL_AT_START = ESCAPED_LABELS.map(label => new RegExp(`^\\s*(?:\\*\\*${label}\\*\\*|${label}(?!\\*\\*))`))

// The five fields a status block check reads, in order: the reply's non-blank
// lines, so a blank (whitespace-only) line between fields is skipped (#879),
// and the lines past the fifth field apart in `rest`. One home for the
// blank-line rule, read by both checkBlock and isIdleStop.
function readBlock(reply: string): { fields: string[]; rest: string[] } {
  const lines = reply.trim().split('\n').filter(line => line.trim() !== '')
  return { fields: lines.slice(0, STATUS_LABELS.length), rest: lines.slice(STATUS_LABELS.length) }
}

export function checkBlock(reply: string): { ok: true } | { ok: false; failed: string } {
  const trimmed = reply.trim()
  if (trimmed === '') return { ok: false, failed: 'The reply is empty' }
  const { fields, rest } = readBlock(reply)
  // All five labels take the same path: the field at the label's position must
  // start with it and carry content after it — the first field included.
  for (let i = 0; i < STATUS_LABELS.length; i++) {
    const label = STATUS_LABELS[i] ?? ''
    const line = fields[i]
    const match = line === undefined ? null : LABEL_AT_START[i]?.exec(line) ?? null
    if (match === null) {
      // Only the first label's absence reads differently: the plan's copy names
      // text before the block, while a later label is missing or out of order.
      if (i === 0) return { ok: false, failed: 'Text comes before **What I ruled:**' }
      const later = fields.slice(i + 1).concat(rest).some(candidate => LABEL_AT_START[i]?.test(candidate) === true)
      return { ok: false, failed: `**${label}** is ${later ? 'out of order' : 'missing'}` }
    }
    if (line.slice(match[0].length).trim() === '') return { ok: false, failed: `**${label}** has no content` }
  }
  if (rest.length > 0)
    return { ok: false, failed: 'Text comes after **Waiting on operator:**' }
  return { ok: true }
}

// A field's content reads as `none` when it starts with the whole word, any
// case (the plan's call): `none.`, `None — the run is closed` and
// `none on #867. …` count, `nonetheless` does not. Lenient on purpose: a false
// `none` in a wait field costs one turn, and a false `none` in Next steps only
// skips the nudge, which is today's behaviour.
const NONE_AT_START = /^none\b/i

// The idle-stop contradiction (#876): a valid block whose two wait fields —
// Waiting on (seats live) and Waiting on operator — both read `none` while
// Next steps names work. Defined only for a block checkBlock accepts; false
// otherwise.
export function isIdleStop(reply: string): boolean {
  if (!checkBlock(reply).ok) return false
  const { fields } = readBlock(reply)
  const content = (index: number): string => {
    const line = fields[index] ?? ''
    const match = LABEL_AT_START[index]?.exec(line) ?? null
    return match === null ? '' : line.slice(match[0].length).trim()
  }
  // Next steps is label 2, Waiting on (seats live) 3, Waiting on operator 4.
  return NONE_AT_START.test(content(3)) && NONE_AT_START.test(content(4)) && !NONE_AT_START.test(content(2))
}

// True only when the reply's last non-empty line is the handoff line. It is
// anchored to the end, not a multiline match anywhere in the reply: the design exempts only
// a turn that ends on the handoff — `MOLT-HANDOFF: /h.md` followed by narration still fails the block.
const HANDOFF_LINE = /^[ \t]*MOLT-HANDOFF:[ \t]*\S/

export function hasMoltHandoff(reply: string): boolean {
  const lines = reply.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (line.trim() === '') continue
    return HANDOFF_LINE.test(line)
  }
  return false
}

// The redo turn (#929). molt's stage file, as molt writes it: `command`, `block` and
// `fallback` are the stages where molt acts at a turn end (its handoff request, a
// fallback brief, a molt). A missing or unreadable file is a molt that does not act.
const MOLT_ACTS = new Set(['command', 'block', 'fallback'])

export function moltActs(stageFile: string | undefined): boolean {
  try {
    const v = JSON.parse(stageFile ?? '') as { stage?: unknown }
    return typeof v.stage === 'string' && MOLT_ACTS.has(v.stage)
  } catch {
    return false
  }
}

// Whether seat-mods' own redo, arriving at prompt.submit, is dropped, and why. It runs
// only in the session whose turn failed, before any other turn, while molt does not act
// on that turn end (operator ruling 2026-10-27: molt's handoff wins).
const REDO_DROPPED = 'seat-mods: the status rewrite was dropped: '
export const REDO_ORPHAN = `${REDO_DROPPED}no failed status turn is waiting for it`

export function redoDrop(r: { pendingSession: string; currentSession: string; superseded: boolean; moltStage: string | undefined }): string | undefined {
  if (r.currentSession !== r.pendingSession) return `${REDO_DROPPED}the session changed`
  if (r.superseded) return `${REDO_DROPPED}another prompt came first`
  if (moltActs(r.moltStage)) return `${REDO_DROPPED}molt is handing off`
  return undefined
}

