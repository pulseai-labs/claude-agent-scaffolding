#!/usr/bin/env bash
#
# orca-crew — the context-ceiling hook (#456), behaviour at its interface.
#
# Feeds hook-input JSON on stdin to hooks-handlers/context-ceiling.sh the way
# Claude Code does, against a transcript written per case, and checks stdout
# and the exit code. Silent cases sit beside firing controls built by the same
# fixture writers, so a handler that prints nothing cannot pass.
#
# Usage:    bash orca-crew/tests/test-context-ceiling-hook.sh
# Exit:     0 if every case holds; 1 otherwise.
# Deps:     bash 3.2+, jq.
# Override: CONTEXT_CEILING_HOOK=<path> runs the cases against another copy of
#           the handler (the mutation checks use it).

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="${CONTEXT_CEILING_HOOK:-$PLUGIN_ROOT/hooks-handlers/context-ceiling.sh}"
BASH_BIN="$(command -v bash)"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"   # counters, colours, pass/fail, report

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! command -v jq >/dev/null 2>&1; then
  fail "jq available on PATH" "the cases build hook input with jq"; report; exit 1
fi

# assistant_line <message id> <input> <cache_creation> <cache_read> [sidechain]
# One assistant record in the shape Claude Code 2.1.270 writes, trimmed to the
# keys the handler reads and their neighbours.
assistant_line() {
  jq -cn --arg id "$1" --argjson i "$2" --argjson cc "$3" --argjson cr "$4" \
    --argjson sc "${5:-false}" \
    '{parentUuid: "p", isSidechain: $sc, type: "assistant", uuid: "u",
      timestamp: "2026-09-13T00:00:00Z",
      message: {id: $id, type: "message", role: "assistant", model: "claude-opus-5",
                content: [{type: "text", text: "x"}],
                usage: {input_tokens: $i, cache_creation_input_tokens: $cc,
                        cache_read_input_tokens: $cr, output_tokens: 10}}}'
}

user_line() { jq -cn '{type: "user", message: {role: "user", content: "hi"}, uuid: "v"}'; }

# transcript <name> <total> -> path of a transcript whose latest assistant record totals <total>
transcript() {
  f="$TMP/$1.jsonl"
  { user_line; assistant_line "msg_$1" 10 90 "$(( $2 - 100 ))"; } > "$f"
  printf '%s' "$f"
}

# input <event> <transcript path> [command] -> hook input JSON for that event
input() {
  if [ "$1" = PreToolUse ]; then
    jq -cn --arg t "$2" --arg c "${3:-}" \
      '{session_id: "s", transcript_path: $t, cwd: "/tmp", hook_event_name: "PreToolUse",
        tool_name: "Bash", tool_input: {command: $c, description: "d"}}'
  else
    jq -cn --arg t "$2" \
      '{session_id: "s", transcript_path: $t, cwd: "/tmp",
        hook_event_name: "UserPromptSubmit", prompt: "next"}'
  fi
}

# run <stdin json> [NAME=value ...] -> OUT, RC; inside an Orca terminal, setting unset
run() {
  stdin="$1"; shift
  OUT="$(printf '%s' "$stdin" | env -u CLAUDE_PLUGIN_OPTION_CONTEXT_CEILING \
    ORCA_TERMINAL_HANDLE=term_test "$@" "$BASH_BIN" "$HOOK" 2>/dev/null)"
  RC=$?
}

expect_silent() { # <label>
  if [ "$RC" -eq 0 ] && [ -z "$OUT" ]; then pass "$1"
  else fail "$1" "rc=$RC out=$OUT"; fi
}

expect_notice() { # <label> <event> <literal the line must contain>...
  label="$1"; want="$2"; shift 2
  if [ "$RC" -ne 0 ]; then fail "$label" "rc=$RC — the handler must always exit 0"; return 0; fi
  if [ "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" -ne 1 ]; then
    fail "$label" "expected exactly one output line: $OUT"; return 0; fi
  if ! printf '%s' "$OUT" | jq -e --arg e "$want" \
      '.hookSpecificOutput.hookEventName == $e
       and (.hookSpecificOutput | has("permissionDecision") | not)
       and (.hookSpecificOutput.additionalContext | type == "string")' >/dev/null 2>&1; then
    fail "$label" "not a $want additionalContext object without a decision: $OUT"; return 0; fi
  line="$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext')"
  for lit in "$@"; do
    case "$line" in *"$lit"*) ;; *) fail "$label" "line lacks '$lit': $line"; return 0 ;; esac
  done
  pass "$label"
}

printf '%sorca-crew — context-ceiling hook%s\n' "$DIM" "$RST"

section "the ceiling"
T_BELOW="$(transcript below 499999)"
T_AT="$(transcript at 500000)"
T_PAST="$(transcript past 523114)"
run "$(input UserPromptSubmit "$T_BELOW")"
expect_silent "one token below the ceiling: silent"
run "$(input UserPromptSubmit "$T_AT")"
expect_notice "at the ceiling: notice on a prompt" UserPromptSubmit \
  "context 500000" "ceiling 500000" "Rotation past the context ceiling"
run "$(input PreToolUse "$T_PAST" 'orca orchestration task-create --run run_x --spec s.md --json')"
expect_notice "past the ceiling: notice before task-create" PreToolUse "context 523114" "ceiling 500000"

section "only Orca new-work commands, only inside Orca"
for cmd in 'orca orchestration dispatch --task t --json' \
           'orca orchestration worker-start --task t --terminal h --json' \
           'orca terminal create --worktree active --command claude --json'; do
  run "$(input PreToolUse "$T_PAST" "$cmd")"
  expect_notice "past the ceiling: notice before '${cmd%% --*}'" PreToolUse "context 523114"
done
run "$(input PreToolUse "$T_PAST" 'git status --short')"
expect_silent "past the ceiling: silent before a non-Orca command"
run "$(input PreToolUse "$T_PAST" 'orca orchestration check --wait --json')"
expect_silent "past the ceiling: silent before a non-new-work Orca command"
OUT="$(printf '%s' "$(input UserPromptSubmit "$T_PAST")" | env -u ORCA_TERMINAL_HANDLE \
  -u CLAUDE_PLUGIN_OPTION_CONTEXT_CEILING "$BASH_BIN" "$HOOK" 2>/dev/null)"; RC=$?
expect_silent "past the ceiling but outside an Orca terminal: silent"

section "the figure is the latest record, never a sum"
f="$TMP/dup.jsonl"
{ user_line; for n in 1 2 3; do assistant_line msg_same 10 90 299900; done; } > "$f"
run "$(input UserPromptSubmit "$f")"
expect_silent "one message's usage repeated on three lines is not summed"
f="$TMP/dup-past.jsonl"
{ user_line; for n in 1 2 3; do assistant_line msg_same 10 90 599900; done; } > "$f"
run "$(input UserPromptSubmit "$f")"
expect_notice "control: the repeated-record writer past the ceiling fires" UserPromptSubmit "context 600000"
f="$TMP/compacted.jsonl"
{ user_line; assistant_line msg_old 10 90 699900; user_line; assistant_line msg_new 10 90 99900; } > "$f"
run "$(input UserPromptSubmit "$f")"
expect_silent "after compaction the latest record wins"
f="$TMP/sidechain.jsonl"
{ user_line; assistant_line msg_main 10 90 99900; assistant_line msg_side 10 90 899900 true; } > "$f"
run "$(input UserPromptSubmit "$f")"
expect_silent "a sidechain record does not count"

section "fail-open"
run "$(jq -cn '{session_id: "s", hook_event_name: "UserPromptSubmit", prompt: "p"}')"
expect_notice "no transcript_path in the hook input: unavailable notice" UserPromptSubmit \
  "figure unavailable (hook input has no transcript_path)" "ceiling of 500000"
run "$(input UserPromptSubmit "$TMP/never-written.jsonl")"
expect_silent "transcript not written yet: silent"
user_line > "$TMP/fresh.jsonl"
run "$(input UserPromptSubmit "$TMP/fresh.jsonl")"
expect_silent "no assistant turn yet: silent"
{ user_line; jq -cn '{type: "assistant", isSidechain: false,
    message: {id: "m", role: "assistant", content: []}}'; } > "$TMP/drift.jsonl"
run "$(input UserPromptSubmit "$TMP/drift.jsonl")"
expect_notice "assistant records without usage (format drift): unavailable notice" UserPromptSubmit \
  "figure unavailable (no readable usage"
{ user_line; assistant_line msg_old 10 90 699900; user_line;
  jq -cn '{type: "assistant", isSidechain: false,
    message: {id: "m_new", role: "assistant", content: []}}'; } > "$TMP/drift-latest.jsonl"
run "$(input UserPromptSubmit "$TMP/drift-latest.jsonl")"
expect_notice "the latest record has no usage but an older one does: unavailable notice" \
  UserPromptSubmit "figure unavailable (no readable usage"
printf '%s\n' '{not json' '}}}' 'still not json' > "$TMP/malformed.jsonl"
run "$(input UserPromptSubmit "$TMP/malformed.jsonl")"
expect_notice "every tail line malformed: unavailable notice" UserPromptSubmit \
  "figure unavailable (no readable assistant record"
# A >4 MB transcript whose tail opens inside the latest assistant record: the
# one record that matters is the one the tail cannot read.
{ user_line; assistant_line m_ok 10 90 523014
  printf '%s' '{"type":"assistant","isSidechain":false,"message":{"id":"m_big","role":"assistant","usage":{"input_tokens":10,"cache_creation_input_tokens":90,"cache_read_input_tokens":523014},"content":[{"type":"text","text":"'
  head -c 4100000 /dev/zero | tr '\0' 'x'
  printf '%s\n' '"}]}}'; } > "$TMP/huge.jsonl"
run "$(input UserPromptSubmit "$TMP/huge.jsonl")"
expect_notice "the tail opens inside the latest assistant record: unavailable notice" \
  UserPromptSubmit "figure unavailable (no readable assistant record"
# A >4 MB transcript whose latest assistant record predates the whole tail:
# 4100 complete 1000-byte user lines follow it, so the tail opens exactly on a
# line boundary and still holds no assistant record.
tail_line='{"type":"user","pad":""}'
tail_pad="$(head -c $(( 999 - ${#tail_line} )) /dev/zero | tr '\0' 'p')"
tail_line="{\"type\":\"user\",\"pad\":\"$tail_pad\"}"
{ assistant_line m_old 10 90 699900; yes "$tail_line" | head -n 4100; } > "$TMP/deep-tail.jsonl"
run "$(input UserPromptSubmit "$TMP/deep-tail.jsonl")"
expect_notice "the latest assistant record predates the whole tail: unavailable notice" \
  UserPromptSubmit "figure unavailable (no assistant record in the last"
{ printf '%s\n' 'e_tokens":1}}}'; user_line; assistant_line m_ok 10 90 523014; printf '%s\n' '{not json'; } \
  > "$TMP/garbled.jsonl"
run "$(input UserPromptSubmit "$TMP/garbled.jsonl")"
expect_notice "unparseable lines around a valid record: the figure is still read" UserPromptSubmit "context 523114"
NOJQ="$TMP/nojq-bin"; mkdir -p "$NOJQ"
for b in cat tail; do ln -s "$(command -v "$b")" "$NOJQ/$b"; done
OUT="$(printf '%s' "$(input UserPromptSubmit "$T_PAST")" | env -u CLAUDE_PLUGIN_OPTION_CONTEXT_CEILING \
  ORCA_TERMINAL_HANDLE=term_test PATH="$NOJQ" "$BASH_BIN" "$HOOK" 2>/dev/null)"; RC=$?
expect_notice "no jq on PATH: unavailable notice on a prompt" UserPromptSubmit "figure unavailable (jq not found)"

section "the setting"
T150="$(transcript s150 150000)"
run "$(input UserPromptSubmit "$T150")" CLAUDE_PLUGIN_OPTION_CONTEXT_CEILING=100000
expect_notice "context_ceiling=100000 applies" UserPromptSubmit "context 150000" "ceiling 100000"
run "$(input UserPromptSubmit "$T150")"
expect_silent "control: the same transcript under the default is silent"
T600="$(transcript s600 600000)"
run "$(input UserPromptSubmit "$T600")" CLAUDE_PLUGIN_OPTION_CONTEXT_CEILING=abc
expect_notice "a non-numeric setting falls back to 500000" UserPromptSubmit "ceiling 500000"
run "$(input UserPromptSubmit "$T_BELOW")" CLAUDE_PLUGIN_OPTION_CONTEXT_CEILING=
expect_silent "an empty setting falls back to 500000"

section "registration"
HJ="$PLUGIN_ROOT/hooks/hooks.json"
if jq -e --arg h 'hooks-handlers/context-ceiling.sh' '
     ([.hooks.PreToolUse[]? | select(.matcher == "Bash") | .hooks[]?.command
       | select(endswith($h))] | length == 1)
     and ([.hooks.UserPromptSubmit[]? | .hooks[]?.command | select(endswith($h))] | length == 1)' \
     "$HJ" >/dev/null 2>&1
then pass "hooks.json registers the handler on PreToolUse (Bash) and UserPromptSubmit"
else fail "hooks.json registers the handler on PreToolUse (Bash) and UserPromptSubmit" "$HJ"; fi
M="$PLUGIN_ROOT/.claude-plugin/plugin.json"
if jq -e '.userConfig.context_ceiling
          | .type == "number" and .default == 500000
            and (.title | length > 0) and (.description | length > 0)' "$M" >/dev/null 2>&1
then pass "the Claude manifest declares context_ceiling (number, default 500000)"
else fail "the Claude manifest declares context_ceiling (number, default 500000)" "$M"; fi
if [ -x "$PLUGIN_ROOT/hooks-handlers/context-ceiling.sh" ]; then pass "the handler is executable"
else fail "the handler is executable"; fi

report
