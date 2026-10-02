#!/usr/bin/env bash
#
# paseo-crew — the Paseo mechanics contract, mechanical facts only.
#
# Paseo's own `paseo` skill and its MCP tool descriptions are the command
# reference. This reference states only what they cannot: the seat launch from a
# resolved profile, the report-file finish and its attention states (D2), the send,
# placement, teardown and the archive cascade, and the detached handoff (D3).
#
# Usage: bash paseo-crew/tests/test-paseo-mechanics.sh
# Deps:  bash 3.2+, awk.

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REF="$PLUGIN_ROOT/skills/orchestrate/references/paseo-mechanics.md"
# 2026-09-27, final-review fix wave: raised from 240 by the 2 lines left over after
# tightening, for the expected-model paragraph (I1), the one-waiter, heartbeat and
# DISPATCHED_AT rules (I3, I6, I7, M1, M2) and the handoff's resume prompt, launch
# verify and stand-down wakes (C1, I2, I4).
# 2026-09-27: raised from 242 by 2. I7 residual: operator-latency on permission answers.
# 2026-09-27, #608 review round 1: raised from 244 by 14, exactly the lines four
# findings needed and no others — the worktree mode/ref trio (a reviewer is at a PR
# head, which `baseBranch` cannot name), the report identity as the inode (mtime can
# hold across a replacement), the error retry's no-replay rule, and the successor
# check's settled status (error|closed alone let `initializing` pass).
# 2026-09-27, #608 review round 3: raised from 258 by 3 — the base is the placement's
# ref with origin/main as its default (not a hard-coded base), and the failed-handoff
# branch reconciles a successor that already resumed before anything is re-armed.
# 2026-09-27, #608 review round 4: raised from 261 by 2 — a model mismatch reconciles
# what the seat may have written before the check (the brief is its initialPrompt).
# 2026-09-27, #608 review round 7 (CodeRabbit): raised from 263 by 2 — the failed
# successor's live same-workspace children are released before it is archived, since
# archiving cascades into them.
# 2026-09-27, #608 review round 8: raised from 265 by 5 — the failed successor's
# children are all released (the cascade detaches the ones in another workspace), the
# detached launch names the featureValues it cannot carry, and the reviewer's release
# is tied to the review being final.
# 2026-09-27, #608 review round 9: raised from 270 by 5 — each failed successor child's
# artifacts are reconciled before its archive, and an idle with no question and no
# background-work claim is routed to the missing-report correction.
# 2026-09-27: narrowed by operator ruling — the failed-successor branch is a fail-closed
# stop (cancel, never archive, report the id) and the child-reconcile procedure is
# deleted; the budget goes DOWN to the new count.
# 2026-10-02, #620/#621 (0.1.2): raised from 266 by 13, exactly the lines the two issues
# needed and no others — the no-`modeId` launch gap, which now halts and names the profile
# rather than omitting a mode Paseo refuses (#621, +4); Teardown's `idle`-after-the-report
# release and the client-tab confirmation before `archive_workspace` removes a run-created
# worktree (#620, +8); and the handoff's successor materialisation carrying the two profile
# gaps (#621, +1).
# 2026-10-02, #626 review round 1, launch class (#1, #5, #11, #20): raised from 279 by 2 —
# the handoff materialises the successor's profile before it stands down, so a gap halt
# leaves this session the orchestrator, and its `--mode` is passed from that resolution
# rather than left to the profile's omission. The mode-id source correction (#1) and the
# refusal bullet (#11) are line-neutral.
# 2026-10-02, #626 review round 1, teardown class (#2, #3, #4, #10): raised from 281 by 7 —
# the release precondition is "no longer working" (`idle`, `error` or `closed`), because a
# seat that escalated or was cancelled never reaches `idle` and could otherwise never be
# archived; the wait for it is bounded by `SETTLE_WINDOW` and escalates rather than hanging;
# and `archive_workspace` belongs to the session holding the operator, a coordinator seat
# listing the workspaces it leaves instead of archiving them.
# 2026-10-02, #626 fix round 2 (F5): raised from 288 by 1 — the handoff's launch line no
# longer shows `--thinking` unconditionally; the flag is a commented insertion, so the
# command as written is one a profile without `thinkingOptionId` can run. F1-F4 are
# line-neutral here (lifecycle.md and the eval key carry no budget).
REF_BUDGET=289

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

printf '%spaseo-crew Paseo mechanics contract%s\n\n' "$DIM" "$RST"

if [ ! -f "$REF" ]; then
  fail "paseo-mechanics.md exists" "no such file"
  report; exit $?
fi

section "the sections other files cite"
for h in '## The seat launch' '## Completion' '## Sending a seat a message' '## Placement' '## Teardown' '## Handoff'; do
  pin "$REF" "$h" "heading $h is stated once"
done

section "the seat launch"
for v in 'create_agent' 'create_workspace' 'paseo inspect <id> --json' 'list_profiles'; do
  present "$REF" "$v" "the launch names $v"
done
present "$REF" 'an explicit `baseBranch`' "a worktree seat names its base explicitly"
# #608 review round 3: the row named `origin/main` as if it were every run's base —
# a run on a release branch (the briefs' `<base-branch>`) needs its own.
pin "$REF" '`origin/main` unless the run names another' "the base defaults to origin/main, never hard-codes it" flat
# A hard-coded base is only right for the seat that branches off it: a reviewer's
# worktree is at a PR's head, which `baseBranch` cannot express (#608 review, round 1).
present "$REF" '`checkout-pr` with' "a PR-head seat names its own ref"
present "$REF" '`checkout-branch` with `branch`' "an existing-branch seat names its branch"
pin "$REF" 'The orchestrator never runs `paseo run` for a worker' "paseo run is reserved for the handoff"
# #608 review round 4: the brief is the seat's initialPrompt, so a model mismatch is
# never a clean failed launch — what it already wrote is reconciled, never adopted.
pin "$REF" 'reconcile anything it touched' "a mismatched seat's artifacts are reconciled, not adopted" flat

section "D2: the report file is the finish"
pin "$REF" 'the file is the contract' "the report-file contract survives"
pin "$REF" 'placed outside every seat'"'"'s worktree' "report files live outside every worktree"
for exitname in '`report`' '`permission`' '`error`' '`idle`' '`budget`'; do
  present "$REF" "$exitname" "the loop names the $exitname exit"
done
pin "$REF" 'The finish notice is a hint' "Paseo's notice is a hint, never the finish"
pin "$REF" 'create_heartbeat' "the heartbeat backstop is named once"
present "$REF" 'expiresIn' "the heartbeat carries expiresIn"
pin "$REF" 'gone without having exited' "the heartbeat re-arms only a lost wait"
pin "$REF" 'with the `idle` exit dropped' "a false wake drops the idle exit"
pin "$REF" 'Coordinator seats' "coordinators are armed without the idle exit"
pin "$REF" 'Both are compared, not merely recorded' "hash and identity are both compared"
# The identity must change on every replacement: a rename mints a new inode, while
# `mtime` can hold across one inside its timestamp granularity (#608 review, round 1).
pin "$REF" 'Never `mtime` alone' "the identity is the inode, never mtime alone" flat
# An `error` retry that replays a dispatch which may have mutated repeats its side
# effects — a commit, a push, a PR, a close (#608 review, round 1).
pin "$REF" 'is never replayed' "a dispatch that may have mutated is not replayed" flat
# Controls: `paseo wait` returns on the first idle (F2), so it must never be the finish.
c="$(occurrences "$REF" 'paseo wait')"
if [ "$c" -le 1 ]; then pass "paseo wait is at most named as the thing not to use ($c)"
else fail "paseo wait is not a completion primitive" "$c occurrences"; fi

section "D3: the detached handoff"
pin "$REF" 'env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD paseo run -d' "the successor launch unsets both caller variables"
pin "$REF" '`ParentAgentId` is `null`' "the successor is verified parentless"
# Only error|closed rejected `initializing`, so a successor that died during startup
# left the run with no waiter at all (#608 review, round 1).
pin "$REF" '`Status` is `idle` or `running`' "a successor still initializing is not a success" flat
# Operator ruling (2026-09-27): the failed-successor branch is a fail-closed stop —
# cancel, never archive (the archive cascades into anything it started), report the
# id, stay the orchestrator. The per-child reconcile procedure is deleted.
pin "$REF" '`cancel_agent`, never archived' "a failed successor is cancelled, never archived"
pin "$REF" 'reports the failed successor'"'"'s agent id to the operator' "the failed successor's id goes to the operator to act on" flat
# #608 review round 8: the detached command takes no feature values, and the seat's
# retention runs to the review being final, not its first report.
pin "$REF" 'hands on without them' "the handoff names the featureValues a detached launch drops" flat
# #608 review round 9: an idle with neither a question nor a background-work claim
# is the missing-report case rather than an unwatched dispatch. (The child-reconcile
# procedure this round added to the handoff branch was deleted by the operator ruling.)
pin "$REF" 'one bounded correction request asking it to write `REPORT_PATH`' "an idle with no question and no report goes to the correction path" flat
pin "$REF" 'the reviewer once the review is final' "the reviewer is released when the review is final, not at its first report" flat
pin "$REF" 're-arms its own waits and a fresh heartbeat' "after a failed launch this session re-arms and stays the orchestrator"
pin "$REF" 'Never archive a predecessor while a subagent in its workspace runs' "the no-archive rule survives"
pin "$REF" 'Kill this session'"'"'s armed background waits' "the predecessor stands down"

section "teardown and the cascade"
present "$REF" 'archive_agent' "a seat is released with archive_agent"
present "$REF" 'archive_workspace' "a run-created workspace is released with archive_workspace"
pin "$REF" 'Close only what the run created' "only run-created things are archived"
pin "$REF" 'after it reports its own children released' "a coordinator is archived after its children"

section "herdr is gone"
# Deliberate: these herdr strings are asserted ABSENT.
for gone in 'herdr' 'HERDR_' 'pane' '--until' 'wait-output' '--machine'; do
  c="$(occurrences "$REF" "$gone")"
  if [ "$c" -eq 0 ]; then pass "no '$gone' in paseo-mechanics.md"
  else fail "no '$gone' in paseo-mechanics.md" "$c occurrence(s)"; fi
done

section "budget"
# <file> → "<lines> <over-by>" on one line: the file's line count, and how far past
# REF_BUDGET it is (0 when within). ONE read feeds both the count and the verdict — the pass
# message used to recompute `wc -l`, a second read that could disagree with the predicate's —
# and a file that cannot be read is REFUSED with a non-zero status rather than counted: an
# empty count is exactly what a file within budget looks like, so returning one would
# certify a file nobody read (#626 review round 1, findings 13-15). _helpers.sh carries no
# line counter to reuse, so this is the minimal local one.
budget_report() { # <file>
  [ -f "${1:-}" ] || return 1
  _n="$(wc -l < "$1" | tr -d ' ')" || return 1
  [ -n "$_n" ] || return 1
  if [ "$_n" -gt "$REF_BUDGET" ]; then printf '%s %s\n' "$_n" "$((_n - REF_BUDGET))"
  else printf '%s 0\n' "$_n"; fi
}
if r="$(budget_report "$REF")"; then
  lines="${r%% *}"; over="${r##* }"
  if [ "$over" -eq 0 ]; then pass "paseo-mechanics.md within the reference budget ($lines lines)"
  else fail "paseo-mechanics.md within the reference budget" "$lines lines, over by $over"; fi
else fail "paseo-mechanics.md within the reference budget" "unreadable: $REF"; fi
# The 2026-10-02 raise above is a loosening, so its adjacent control sits here: a file past
# the NEW limit must still fail the same comparison, and one that cannot be read must be
# refused rather than counted as within it. A budget nothing can exceed bounds nothing.
ctl_over="$(mktemp)"
awk -v n="$((REF_BUDGET + 1))" 'BEGIN { for (i = 0; i < n; i++) print "" }' > "$ctl_over"
if r="$(budget_report "$ctl_over")" && [ "${r##* }" -gt 0 ]; then pass "control: the budget still fails a file past the limit"
else fail "control: the budget still fails a file past the limit" "an over-limit fixture read [$r] and passed"; fi
if ! r="$(budget_report "$ctl_over/gone")"; then pass "control: an unreadable file is refused, not counted as within budget"
else fail "control: an unreadable file is refused, not counted as within budget" "read [$r]"; fi
# The real file sits exactly ON the limit, so its pass cannot separate "within" from
# "over": a predicate that always reported an overshoot would read the same there. This
# one line under the limit is the case that separates them — measured, mutating the
# comparison to `[ "$_n" -ge 0 ]` left the suite green until this control existed.
ctl_under="$(mktemp)"
awk -v n="$((REF_BUDGET - 1))" 'BEGIN { for (i = 0; i < n; i++) print "" }' > "$ctl_under"
if r="$(budget_report "$ctl_under")" && [ "${r##* }" -eq 0 ]; then pass "control: a file within the budget reports no overshoot"
else fail "control: a file within the budget reports no overshoot" "read [$r]"; fi
rm -f "$ctl_over" "$ctl_under"

section "no personal name ships"
hits=0
for needle in claude-glm claude-glm-flash claude-sol glm-5.3 Fable; do
  hits=$((hits + $(occurrences "$REF" "$needle")))
done
if [ "$hits" -eq 0 ]; then pass "no personal name in paseo-mechanics.md"
else fail "no personal name in paseo-mechanics.md" "$hits occurrence(s)"; fi

section "the hoisted counters are not re-copied"
assert_hoisted_counters

report
