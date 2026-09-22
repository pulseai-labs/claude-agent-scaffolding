#!/usr/bin/env bash
# context-ceiling.sh — herdr-crew's context-ceiling notice (#456).
#
# Tells a session its own context figure once that figure reaches the ceiling, at the
# two moments new work starts: a prompt or a herdr wake (UserPromptSubmit) and a herdr
# new-work command (PreToolUse on Bash). It never allows, denies or asks, and it always
# exits 0: a hook failure must not stop a seat. Every seat in a herdr pane is told, since
# a session does not declare what it is; only a coordinator seat rotates on it, and what
# a unit is — for that, and for a leaf's finish-and-report — is prose: lifecycle.md,
# "Rotation past the context ceiling".
#
# The figure is input + cache_creation + cache_read tokens of the latest
# non-sidechain assistant record in the transcript Claude Code names in the
# hook input. One message's usage repeats on several transcript lines, so the
# latest record is read, never a sum. The transcript format is undocumented: a
# figure that cannot be read is reported as unavailable, never guessed, and a
# usage object that does not carry all three counters as numbers does not carry
# the figure.

set +e

[ -n "${HERDR_PANE_ID:-}" ] || exit 0    # inert outside herdr panes

DEFAULT_CEILING=500000
TAIL_BYTES=4000000    # the latest assistant record sits in the transcript's tail

ceiling="${CLAUDE_PLUGIN_OPTION_CONTEXT_CEILING:-}"
case "$ceiling" in ''|*[!0-9]*) ceiling=$DEFAULT_CEILING ;; esac
[ "$ceiling" -ge 1 ] || ceiling=$DEFAULT_CEILING    # the manifest's min is 1; 0 fires on every prompt

input="$(cat)"

case "$input" in    # fast path: most Bash calls are not herdr new-work commands
  *UserPromptSubmit*|*'tab create'*|*'workspace create'*|*'worktree create'*|*'pane run'*|*'agent prompt'*) ;;
  *) exit 0 ;;
esac

# say <event> <line> — every caller passes a line with no double quote or backslash.
say() {
  printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}\n' "$1" "$2"
}

unavailable() { # <event> <reason>
  say "$1" "herdr-crew: context figure unavailable ($2); the ceiling of $ceiling tokens was not checked."
}

# event_in_raw <input> — the event the raw input names, for the two paths where
# the input is read as text because jq cannot read it: jq is not on PATH, or it
# failed on the input. The fast path above has already matched, so the spelling
# settles only which event a notice belongs to: a prompt, or a new-work command
# on the wake path this plugin's own doorbell makes ordinary. The spellings are
# the two a JSON writer produces — compact, and with a single space — and an
# input written any other way stays silent, as it does with jq.
event_in_raw() {
  case "$1" in
    *'"hook_event_name":"UserPromptSubmit"'*|*'"hook_event_name": "UserPromptSubmit"'*) printf '%s' UserPromptSubmit ;;
    *'"hook_event_name":"PreToolUse"'*|*'"hook_event_name": "PreToolUse"'*) printf '%s' PreToolUse ;;
  esac
}

if ! command -v jq >/dev/null 2>&1; then
  # Without jq there is no figure to read on either event, so both are told.
  event="$(event_in_raw "$input")"
  [ -n "$event" ] && unavailable "$event" "jq not found"
  exit 0
fi

event="$(printf '%s' "$input" | jq -r '.hook_event_name // empty' 2>/dev/null)"
if [ -z "$event" ]; then
  # jq read no event: the input is malformed, or the jq on PATH is broken.
  # Either way the figure was not read, and the same raw spellings say which
  # event a notice belongs to — silence here would be the very pass this hook
  # exists to prevent.
  event="$(event_in_raw "$input")"
  [ -n "$event" ] && unavailable "$event" "jq could not read the hook input"
  exit 0
fi
case "$event" in
  UserPromptSubmit) ;;
  PreToolUse)
    command="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
    case "$command" in
      # herdr's new-work commands: tab/workspace/worktree creation, the seat
      # launch (pane run) and the send (agent prompt). Matched by substring, so
      # a command that merely mentions one of those verbs also fires; that is
      # deliberate — the notice is advisory and never a block, and narrowing the
      # pattern risks missing the real forms (`herdr --machine x pane run`,
      # `"$HERDR_BIN_PATH" pane run`). `agent wait`, `pane read`, `pane list`
      # and `agent list` carry none of the five and stay silent.
      *'tab create'*|*'workspace create'*|*'worktree create'*|*'pane run'*|*'agent prompt'*) ;;
      *) exit 0 ;;
    esac ;;
  *) exit 0 ;;
esac

transcript="$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)"
if [ -z "$transcript" ]; then unavailable "$event" "hook input has no transcript_path"; exit 0; fi
# A session's first prompt can precede its transcript, so a path that names
# nothing at all is silent. A path that names something the handler cannot read
# is not that case: an unreadable file, a directory, a fifo or a broken link is
# drift under a running session, the figure was not read, and the header forbids
# passing that over in silence. `-f` also keeps the tail off an entry that would
# block on it.
if [ ! -e "$transcript" ] && [ ! -L "$transcript" ]; then exit 0; fi
if [ ! -f "$transcript" ] || [ ! -r "$transcript" ]; then
  unavailable "$event" "transcript is not a readable file"; exit 0
fi

# One jq pass over the tail classifies it: "figure <n>" (the latest assistant
# record's usage summed), "nousage" (that record's usage is not a readable
# object carrying all three counters — an older record's figure is never
# substituted), "none" (no assistant record and every line parses) or "partial"
# (no assistant record readable — a malformed or truncated tail cannot be told
# from a lost record).
verdict="$(tail -c "$TAIL_BYTES" "$transcript" 2>/dev/null | jq -Rrn '
  [inputs] as $lines
  | ([$lines[] | fromjson?]) as $parsed
  | ([$parsed[] | select(.type? == "assistant" and .isSidechain? != true)]) as $a
  | if ($a | length) > 0 then
      (try ($a[-1].message.usage) catch null) as $u
      # Every one of the three counters must be present as a number. Reading
      # them with `// 0` turned an absent or renamed counter into a real figure
      # of zero — below any ceiling, so the check passed in silence. A usage
      # object the handler cannot read that way is "nousage": never a guess.
      # Keys the handler does not know are none of its business.
      | if ($u | type) == "object"
           and ($u.input_tokens | type) == "number"
           and ($u.cache_creation_input_tokens | type) == "number"
           and ($u.cache_read_input_tokens | type) == "number"
        then "figure \($u.input_tokens + $u.cache_creation_input_tokens + $u.cache_read_input_tokens)"
        else "nousage" end
    elif ($parsed | length) < ($lines | length) then "partial"
    else "none" end' 2>/dev/null)"

case "$verdict" in
  figure\ *) figure="${verdict#figure }" ;;
  nousage) unavailable "$event" "no readable usage in the latest assistant record"; exit 0 ;;
  none)
    # The tail is the whole transcript only when the file fits in it; a longer
    # transcript may have put its latest assistant record before the tail. The
    # size is read under its own guard: the redirection can still fail on a file
    # that became unreadable after the guard above, and an empty size would take
    # the `-gt` test to an integer-expression error and out of the handler with
    # no notice, which is the same defect one line down.
    size="$(wc -c < "$transcript" 2>/dev/null | tr -d '[:space:]')"
    case "$size" in
      ''|*[!0-9]*) unavailable "$event" "the transcript's size could not be read"; exit 0 ;;
    esac
    if [ "$size" -gt "$TAIL_BYTES" ]; then
      unavailable "$event" "no assistant record in the last $TAIL_BYTES transcript bytes"; exit 0
    fi
    exit 0 ;;    # no assistant turn yet: nothing to measure
  *) unavailable "$event" "no readable assistant record in the transcript tail"; exit 0 ;;
esac

case "$figure" in
  ''|*[!0-9]*) unavailable "$event" "no readable usage in the latest assistant record"; exit 0 ;;
esac

[ "$figure" -ge "$ceiling" ] || exit 0
say "$event" "herdr-crew: context $figure >= ceiling $ceiling tokens. Finish the unit in hand and start no new one; a coordinator seat rotates at its next boundary (herdr-crew lifecycle.md, Rotation past the context ceiling)."
exit 0
