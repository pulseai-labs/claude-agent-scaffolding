#!/usr/bin/env bash
#
# herdr-crew — the herdr mechanics contract, mechanical facts only.
#
# herdr --skill documents CLI syntax. This reference states only what that
# guide cannot: the seat launch sequence built from agents.md's command:, the
# two readiness paths, the report-file completion contract, and placement.
#
# Counting is one awk index() pass: `grep -c` counts LINES, and `… | grep -q`
# can fail on a true match under pipefail.
#
# Usage: bash herdr-crew/tests/test-herdr-mechanics.sh
# Deps:  bash 3.2+, awk.

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REF="$PLUGIN_ROOT/skills/orchestrate/references/herdr-mechanics.md"
# 204, raised from 200 during PR #513's review rounds: this file's budget is this
# port's own invention (orca-crew has no mechanics reference), and the rounds' P1
# fixes — the run workspace's per-server allocation, the first seat's cwd, the
# agent_blocked re-send — needed room that eight content-neutral trades could not
# keep finding. The gate still fails over the limit; the slack is two lines.
REF_BUDGET=204

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

occurrences() {
  if [ -z "${2:-}" ]; then printf 'empty needle\n' >&2; return 1; fi
  [ -f "$1" ] || { printf 'no such file\n' >&2; return 1; }
  awk -v needle="$2" '
    { line = $0
      while ((i = index(line, needle)) > 0) { n++; line = substr(line, i + length(needle)) } }
    END { print n+0 }' "$1"
}
present() {
  c="$(occurrences "$REF" "$1")" || { fail "$2" "count failed"; return 0; }
  if [ "$c" -ge 1 ]; then pass "$2"; else fail "$2" "not found: $1"; fi
}
pin() {
  c="$(occurrences "$REF" "$1")" || { fail "$2" "count failed"; return 0; }
  if [ "$c" -eq 1 ]; then pass "$2"
  elif [ "$c" -eq 0 ]; then fail "$2" "not found, or the line wrapped: $1"
  else fail "$2" "found $c times; a pin must be unique: $1"; fi
}

printf '%sherdr-crew herdr mechanics contract%s\n\n' "$DIM" "$RST"

if [ ! -f "$REF" ]; then
  fail "herdr-mechanics.md exists" "no such file"
  report; exit $?
fi

section "the launch sequence"
for v in 'herdr workspace create' 'herdr tab create' 'herdr pane run' 'herdr pane read' 'herdr agent prompt'; do
  present "$v" "the sequence names $v"
done
present 'herdr worktree create' "a worktree seat names herdr worktree create"

section "the two readiness paths"
present 'herdr agent wait' "the detected path names agent wait"
present 'herdr pane wait-output' "the undetected path names pane wait-output"
present '--until done --until idle --until blocked' "the typed wait names all three settled states"
present "--match '<expected_model:>'" "the undetected path waits on the seat's own expected_model:"
pin 'herdr agent list' "the discriminator is named once"

section "the rules that must survive a rewording"
pin 'never `pane split`' "the no-split rule survives"
pin 'invoked by name' "the lane-by-name rule survives"
pin 'the file is the contract' "the report-file contract survives"
pin 'placed outside every seat'"'"'s worktree' \
  "every file the run keeps lives outside every seat's worktree (R39)"
pin 'and so is a coordinator'"'"'s' \
  "a coordinator seat is waited on through its report file (R41)"
pin 'A local slash command (`/context`, `/clear`) settles without a turn' \
  "a local slash command is sent without the turn-start check (R42)"

section "placement"
present '--cwd' "a seat's tree is set with --cwd"
present '--label' "a seat's tab is labelled"

section "budget"
n="$(wc -l < "$REF" | tr -d ' ')"
if [ "$n" -le "$REF_BUDGET" ]; then pass "herdr-mechanics.md within the reference budget ($n lines)"
else fail "herdr-mechanics.md within the reference budget" "$n lines, over by $((n - REF_BUDGET))"; fi

section "no personal name ships"
hits=0
for needle in claude-glm claude-glm-flash claude-sol glm-5.3 Fable; do
  hits=$((hits + $(occurrences "$REF" "$needle")))
done
if [ "$hits" -eq 0 ]; then pass "no personal name in herdr-mechanics.md"
else fail "no personal name in herdr-mechanics.md" "$hits occurrence(s)"; fi

report
