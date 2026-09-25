#!/usr/bin/env bash
#
# herdr-crew — the herdr mechanics contract, mechanical facts only.
#
# herdr --skill documents CLI syntax. This reference states only what that
# guide cannot: the seat launch sequence built from agents.md's command:, the
# two readiness paths, the report-file completion contract, and placement.
#
# Counting is one awk index() pass, hoisted to _helpers.sh with the pin/present
# wrappers (#514, L1): `grep -c` counts LINES, and `… | grep -q` can fail on a
# true match under pipefail.
#
# Usage: bash herdr-crew/tests/test-herdr-mechanics.sh
# Deps:  bash 3.2+, awk.

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REF="$PLUGIN_ROOT/skills/orchestrate/references/herdr-mechanics.md"
# 235, raised from 204 during T3 (2026-09-22): the pilot measured eight mechanics the file
# had wrong or missing — the two detection events, the worktree path's workspace label and
# `result.root_pane.pane_id` and its source-repo `--cwd`, the source-repo workspace that
# `worktree remove` leaves open, the undetected caveat's remedy, the doorbell's generation
# rule and a detected coordinator's `--until blocked` wait beside it, `enter` as the submit
# key, and which ask governs the completion wait. Every addition is a clause: the file went
# 201 -> 233 lines (+32: numstat 56 insertions, 24 deletions) and the gate rose 204 -> 235
# (+31). The gate still fails over the limit; #574's widened doorbell predicate and #575's
# mutually-cancelling companion wait spent the two-line slack (233 -> 235, 2026-09-24).
#
# 204, raised from 200 during PR #513's review rounds: this file's budget is this
# port's own invention (orca-crew has no mechanics reference), and the rounds' P1
# fixes — the run workspace's per-server allocation, the first seat's cwd, the
# agent_blocked re-send — needed room that eight content-neutral trades could not
# keep finding.
# 237, raised from 235 during #574/#575's fix round (2026-09-24): the review's three
# completions — the dispatch-time step now notes what the doorbell compares (the hash and
# the file's identity), the doorbell paragraph refers back to that note instead of
# restating the rule, and a detected coordinator's answered dialog re-arms the pair — added
# two lines, 235 -> 237, to a file that entered the round at its gate (233 -> 235 having
# spent the previous slack). The two lines are mechanics the file exists to state, so the
# gate rose with them; it still fails over the limit.
REF_BUDGET=237

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

# occurrences, occurrences_flat, count_of, pin and present are _helpers.sh's
# (#514, L1). The counter here had its own copy, and the flat one its own
# signature — it took the needle alone and bound $REF itself — so the two copies
# of the squeezed-line counter had already diverged between this suite and the
# ossify one. What is left here is this suite's own: nothing.

printf '%sherdr-crew herdr mechanics contract%s\n\n' "$DIM" "$RST"

if [ ! -f "$REF" ]; then
  fail "herdr-mechanics.md exists" "no such file"
  report; exit $?
fi

section "the launch sequence"
for v in 'herdr workspace create' 'herdr tab create' 'herdr pane run' 'herdr pane read' 'herdr agent prompt'; do
  present "$REF" "$v" "the sequence names $v"
done
present "$REF" 'herdr worktree create' "a worktree seat names herdr worktree create"

section "the two readiness paths"
present "$REF" 'herdr agent wait' "the detected path names agent wait"
present "$REF" 'herdr pane wait-output' "the undetected path names pane wait-output"
present "$REF" '--until done --until idle --until blocked' "the typed wait names all three settled states"
present "$REF" "--match '<expected_model:>'" "the undetected path waits on the seat's own expected_model:"
pin "$REF" 'herdr agent list' "the discriminator is named once"

section "the rules that must survive a rewording"
pin "$REF" 'never `pane split`' "the no-split rule survives"
pin "$REF" 'invoked by name' "the lane-by-name rule survives"
pin "$REF" 'the file is the contract' "the report-file contract survives"
pin "$REF" 'placed outside every seat'"'"'s worktree' \
  "every file the run keeps lives outside every seat's worktree (R39)"
pin "$REF" 'and so is a coordinator'"'"'s' \
  "a coordinator seat is waited on through its report file (R41)"
pin "$REF" 'A local slash command (`/context`, `/clear`) settles without a turn' \
  "a local slash command is sent without the turn-start check (R42)"

# #574: the doorbell's predicate. Both halves are pinned — a revert to the hash alone kills
# the first, and dropping the comparison leaves the identity remedy recorded but unread,
# which is the half the issue exists for.
pin "$REF" 'the identity noted beside it differs' \
  "the doorbell's wait compares the noted identity, not the hash alone (#574)"
pin "$REF" 'Both are compared, not merely recorded' \
  "the noted identity is compared, not merely recorded (#574)"

# #575: the detected coordinator's companion wait, made mutually cancelling — each wake
# disarms the other, so a dispatch leaves at most one armed wait.
pin "$REF" 'and it ends the doorbell' \
  "the companion's blocked wake ends the doorbell (#575)"
pin "$REF" "The doorbell's return — a new report or its timeout — ends the companion" \
  "the doorbell's return ends the companion: one armed wait per dispatch (#575)"

# The fix round's completions. #574's dispatch-time step now notes the identity the
# doorbell compares — and "note the file's identity" is stated once, so the doorbell
# paragraph refers back to that note rather than restating it (the `(inode or mtime)`
# pin below is the one-definition check: a re-added restatement makes it two).
pin "$REF" "and the file's identity" \
  "the dispatch-time note records the file's identity beside the hash (#574)"
# Counted flat, not per line: a restatement of the definition may break at any point, and
# the measured revert wraps `inode` onto its own line — a per-line count would call that
# file "defined once" (measured: 3, not 2, before this pin was made wrap-proof). Residual,
# and accepted: a restatement naming neither word escapes; any realistic one names one.
pin "$REF" 'inode or mtime' \
  "the identity is defined once — inode or mtime, not restated (#574)" flat
pin "$REF" 'the identity noted at dispatch' \
  "the doorbell paragraph refers back to the dispatch-time note (#574)"

# #575: the pair is re-armed, not restarted, after a dialog the operator answered.
pin "$REF" 'An answered dialog re-arms the pair' \
  "an answered dialog re-arms the pair (#575)"
pin "$REF" 'the doorbell and its companion again, not one wait' \
  "the fresh wait after an answer is the pair again, not one wait (#575)"

section "placement"
present "$REF" '--cwd' "a seat's tree is set with --cwd"
present "$REF" '--label' "a seat's tab is labelled"
present "$REF" '--base <base-branch>' "a worktree seat's base is a slot, not a literal"

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

# #514, L1: the shape, asserted rather than assumed — a counter re-copied into any
# suite shadows the hoisted one and keeps passing.
section "the hoisted counters are not re-copied"
assert_hoisted_counters

report
