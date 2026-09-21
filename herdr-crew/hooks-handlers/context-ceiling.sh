#!/usr/bin/env bash
# context-ceiling.sh — herdr-crew's context-ceiling notice (#456).
#
# Tells a session its own context figure once that figure reaches the ceiling,
# at the two moments a coordinator decides to start new work: a prompt or a
# herdr wake (UserPromptSubmit) and a herdr new-work command (PreToolUse on
# Bash). It never allows, denies or asks, and it always exits 0: a hook
# failure must not stop a seat. What a unit is, and when to rotate, is prose —
# lifecycle.md, "Rotation past the context ceiling".
#
# The figure is input + cache_creation + cache_read tokens of the latest
# non-sidechain assistant record in the transcript Claude Code names in the
# hook input. One message's usage repeats on several transcript lines, so the
# latest record is read, never a sum. The transcript format is undocumented: a
# figure that cannot be read is reported as unavailable, never guessed.

set +e

[ -n "${HERDR_PANE_ID:-}" ] || exit 0    # inert outside herdr panes

DEFAULT_CEILING=500000
TAIL_BYTES=4000000    # the latest assistant record sits in the transcript's tail

ceiling="${CLAUDE_PLUGIN_OPTION_CONTEXT_CEILING:-}"
case "$ceiling" in ''|*[!0-9]*) ceiling=$DEFAULT_CEILING ;; esac

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

if ! command -v jq >/dev/null 2>&1; then
  case "$input" in
    *'"hook_event_name":"UserPromptSubmit"'*|*'"hook_event_name": "UserPromptSubmit"'*)
      unavailable UserPromptSubmit "jq not found" ;;
  esac
  exit 0
fi

event="$(printf '%s' "$input" | jq -r '.hook_event_name // empty' 2>/dev/null)"
case "$event" in
  UserPromptSubmit) ;;
  PreToolUse)
    command="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
    case "$command" in
      # herdr's new-work commands: tab/workspace/worktree creation, the seat
      # launch (pane run) and the send (agent prompt). Everything else the
      # coordinator runs — agent wait, pane read, pane list, agent list — is
      # not new work and stays silent.
      *'tab create'*|*'workspace create'*|*'worktree create'*|*'pane run'*|*'agent prompt'*) ;;
      *) exit 0 ;;
    esac ;;
  *) exit 0 ;;
esac

transcript="$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)"
if [ -z "$transcript" ]; then unavailable "$event" "hook input has no transcript_path"; exit 0; fi
[ -f "$transcript" ] || exit 0    # a session's first prompt can precede its transcript

# One jq pass over the tail classifies it: "figure <n>" (the latest assistant
# record's usage summed), "nousage" (that record's usage is not a readable
# object — an older record's figure is never substituted), "none" (no
# assistant record and every line parses) or "partial" (no assistant record
# readable — a malformed or truncated tail cannot be told from a lost record).
verdict="$(tail -c "$TAIL_BYTES" "$transcript" 2>/dev/null | jq -Rrn '
  [inputs] as $lines
  | ([$lines[] | fromjson?]) as $parsed
  | ([$parsed[] | select(.type? == "assistant" and .isSidechain? != true)]) as $a
  | if ($a | length) > 0 then
      (try ($a[-1].message.usage) catch null) as $u
      | if ($u | type) == "object"
        then "figure \(($u.input_tokens // 0) + ($u.cache_creation_input_tokens // 0) + ($u.cache_read_input_tokens // 0))"
        else "nousage" end
    elif ($parsed | length) < ($lines | length) then "partial"
    else "none" end' 2>/dev/null)"

case "$verdict" in
  figure\ *) figure="${verdict#figure }" ;;
  nousage) unavailable "$event" "no readable usage in the latest assistant record"; exit 0 ;;
  none)
    # The tail is the whole transcript only when the file fits in it; a longer
    # transcript may have put its latest assistant record before the tail.
    if [ "$(wc -c < "$transcript" | tr -d '[:space:]')" -gt "$TAIL_BYTES" ]; then
      unavailable "$event" "no assistant record in the last $TAIL_BYTES transcript bytes"; exit 0
    fi
    exit 0 ;;    # no assistant turn yet: nothing to measure
  *) unavailable "$event" "no readable assistant record in the transcript tail"; exit 0 ;;
esac

case "$figure" in
  ''|*[!0-9]*) unavailable "$event" "no readable usage in the latest assistant record"; exit 0 ;;
esac

[ "$figure" -ge "$ceiling" ] || exit 0
say "$event" "herdr-crew: context $figure >= ceiling $ceiling tokens. Finish the unit in hand, start no new one, and rotate at your next boundary (herdr-crew lifecycle.md, Rotation past the context ceiling)."
exit 0
