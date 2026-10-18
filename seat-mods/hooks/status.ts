// seat-mods status logic: the pure functions behind the orchestrator's status
// block check, wired to prompt.submit, classic.Stop and turn.complete by
// register.ts. No `$` and no model call here; the copy is the plans' verbatim
// (AI workspace docs/superpowers/plans/2026-10-18-orchestrator-status-block.md
// and 2026-10-18-idle-stop-status-block.md).

export const STATUS_LABELS: readonly string[] = [
  'What I ruled:',
  'What the PR(s) will carry:',
  'Next steps:',
  'Waiting on (seats live):',
  'Operator decision pending:',
]

export const STATUS_CONTEXT = 'seat-mods (orchestrator): this is a status turn — no operator typed it. Use tool calls only and write no narration. End the turn with only the status block, these five lines in this order: **What I ruled:** / **What the PR(s) will carry:** / **Next steps:** / **Waiting on (seats live):** / **Operator decision pending:** — each with content ("none" is content) and nothing before or after. A block that waits on no seat and no operator decision while its Next steps names work is not a turn end: do that work first.'

export function rewriteReason(failed: string): string {
  return `seat-mods (orchestrator): a status turn ends with only the five-field status block. ${failed}. Rewrite your reply as the block and nothing else.`
}

export const STATUS_WARNING = '⚠ seat-mods: status block missing — this status reply is not in the required form.'

// The idle-stop copy (#876). The reason is the one block a turn gets for the
// idle check; the warning is the line turn.complete shows when it stands.
export const IDLE_REASON = 'seat-mods (orchestrator): the status block says nothing waits, but Next steps names work. Do the next step now, or name the seat, wake or decision you wait on.'

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
// unless it is autonomic's: its only `$.prompt.submit` is the pain-band press,
// the operator's own chosen option. `unclassified` and any unknown kind stay
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
      return origin.name === 'autonomic' && !isCrewTagged(text) ? 'operator' : 'status'
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

export function checkBlock(reply: string): { ok: true } | { ok: false; failed: string } {
  const trimmed = reply.trim()
  if (trimmed === '') return { ok: false, failed: 'The reply is empty' }
  const lines = trimmed.split('\n')
  // All five labels take the same path: the line at the label's position must
  // start with it and carry content after it — the first field included.
  for (let i = 0; i < STATUS_LABELS.length; i++) {
    const label = STATUS_LABELS[i] ?? ''
    const line = lines[i]
    const match = line === undefined ? null : LABEL_AT_START[i]?.exec(line) ?? null
    if (match === null) {
      // Only the first label's absence reads differently: the plan's copy names
      // text before the block, while a later label is missing or out of order.
      if (i === 0) return { ok: false, failed: 'Text comes before **What I ruled:**' }
      const later = lines.slice(i + 1).some(candidate => LABEL_AT_START[i]?.test(candidate) === true)
      return { ok: false, failed: `**${label}** is ${later ? 'out of order' : 'missing'}` }
    }
    if (line.slice(match[0].length).trim() === '') return { ok: false, failed: `**${label}** has no content` }
  }
  if (lines.length > STATUS_LABELS.length)
    return { ok: false, failed: 'Text comes after **Operator decision pending:**' }
  return { ok: true }
}

// A field's content reads as `none` when it starts with the whole word, any
// case (the plan's call): `none.`, `None — the run is closed` and
// `none on #867. …` count, `nonetheless` does not. Lenient on purpose: a false
// `none` in a wait field costs one turn, and a false `none` in Next steps only
// skips the nudge, which is today's behaviour.
const NONE_AT_START = /^none\b/i

// The idle-stop contradiction (#876): a valid block whose Waiting on and
// Operator decision pending fields both read `none` while Next steps names
// work. Defined only for a block checkBlock accepts; false otherwise.
export function isIdleStop(reply: string): boolean {
  if (!checkBlock(reply).ok) return false
  const lines = reply.trim().split('\n')
  const content = (index: number): string => {
    const line = lines[index] ?? ''
    const match = LABEL_AT_START[index]?.exec(line) ?? null
    return match === null ? '' : line.slice(match[0].length).trim()
  }
  // Next steps is label 2, Waiting on 3, Operator decision pending 4.
  return NONE_AT_START.test(content(3)) && NONE_AT_START.test(content(4)) && !NONE_AT_START.test(content(2))
}

// True only when the reply's last non-empty line is the handoff line. Unlike
// autonomic's hooks/floor.ts:4 (a multiline match anywhere in the reply), this
// is anchored to the end: the design exempts only a turn that ends on the
// handoff — `MOLT-HANDOFF: /h.md` followed by narration still fails the block.
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
