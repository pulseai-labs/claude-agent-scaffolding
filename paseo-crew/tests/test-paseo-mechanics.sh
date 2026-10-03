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
# 2026-10-02, #626 fix round 3 (G1): raised from 289 by 1 — The seat launch's model check
# now states the wrong-model release in full, `cancel_agent` before the release, since it is
# the one path that cancels a still-working seat. G2 is a pointer in roles.md, which carries
# no budget.
# 2026-10-02, #629/#622/#609 (0.1.3): at 290 after both fix rounds, REF_BUDGET unchanged.
# #622's report exit now requires the seat settled and reads the body against the dispatch;
# #632's fix round 1 tightens that gate to `idle` (the exit row is its only owner, and
# `error`/`closed` settle at the `error` exit) and makes every other reader of a changed
# file point at the row. Teardown's first-write caveat and the `SETTLE_WINDOW` release wait
# that worked around it are deleted. #629's model-check cancel names the operator through
# the handoff's rule instead of a no-longer-working precondition this site has no wait for;
# its `--thinking` requirement moves into the prose and the command's placeholder; and
# #609's implementer release follows `roles.md`'s retention end rather than every item's
# step-12 merge.
# 2026-10-03, #635/#637/#638 (0.1.4): at 290 after the fix, REF_BUDGET unchanged. #635's pair
# rule gains one owner sentence in Completion and a pointer in each of the five handlers,
# plus the `error` row's re-armed-wait guard; #637 adds the reviewer's consolidation request
# to the `idle` handler; and #638 deletes Teardown's tab ask and its rationale, which pays
# for both.
REF_BUDGET=290

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
# #629 J2: the same input class as the handoff's failed successor — a seat that may
# have started children — so it is cancelled and reported, never archived: the
# archive cascades into what it started.
pin "$REF" 'report it to the operator, as Handoff'"'"'s' "a mismatched seat is cancelled, never archived" flat
# #629 J3, the adjacent control: this site has no report to read and no armed wait,
# so its release cannot route through a precondition whose wait is a report and a
# `SETTLE_WINDOW`. Re-introducing the old route must fail this, and the operator
# clause above is what the release waits on instead. Counted FLAT (#632 F11): a
# reintroduction wrapped across two lines is the same clause, and a per-line count
# reads it as absent. Guarded (#635 N11): `flat`'s refusal on an unreadable file
# otherwise surfaced as "integer expression expected" with no cause, which reads as
# a broken suite rather than as a control that could not read its file.
if c="$(count_of "$REF" 'no-longer-working precondition' flat)"; then
  if [ "$c" -eq 0 ]; then pass "the model-check release depends on no report or settle window ($c)"
  else fail "the model-check release names no report-dependent precondition" "$c occurrence(s)"; fi
else fail "the model-check release control is readable" "unreadable file or empty needle: $REF"; fi

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
# #637: a reviewer's `/code-review` fork returns before its finders do, so its first reportless
# idle takes one bounded consolidation request before the idle exit is dropped, because only a
# message starts the turn the fork ended.
pin "$REF" "reportless idle — whatever its last message says — is sent one bounded request to consolidate the review's returned candidates into \`REPORT_PATH\`, then one fresh wait as for any send; a second one takes the missing-report case below" "a reviewer's first reportless idle takes one consolidation request, then a plain send-wait" flat
pin "$REF" 'Coordinator seats' "coordinators are armed without the idle exit"
pin "$REF" 'Both are compared, not merely recorded' "hash and identity are both compared"
# #635 AC1: the pair rule has ONE owner sentence, and the five handlers point at it (budget,
# `error`, `permission`, `idle`, a send) — so the owner cannot be reworded away while its five
# pointers keep reading as rules of their own. `(`Completion`` rather than the closed form:
# the `error` route's pointer carries the row's guard inside the same parenthesis.
pin "$REF" 'The pair is re-taken when the handler has read the body at `REPORT_PATH`' "the pair rule has one owner sentence" flat
if c="$(count_of "$REF" '(`Completion`' flat)"; then
  if [ "$c" -eq 5 ]; then pass "the five handlers point at the pair rule ($c)"
  else fail "the five handlers point at the pair rule" "$c occurrence(s)"; fi
else fail "the pair-rule pointers are countable" "unreadable file or empty needle: $REF"; fi
# #635 M1 / #639 G1 / H1: the guard is the `error` row's, keyed to the error route's re-send
# wait — not to the seat's status when a wait is armed, which hid a first-attempt error to the
# budget (round 1's P1). The needle runs to the clause's end so a guard widened to first waits
# or dropped entirely fails it.
pin "$REF" "only the error route's re-send wait holds \`error\` until it has seen \`Status\` leave it" "the error row keys its guard to the re-send wait" flat
# #639 H2/H11: the explicit `closed` carve-out, pinned beside the row pin because deleting it
# stayed green after the old combined pin went (measured).
pin "$REF" 'taken at once by every wait, `closed` included' "the error row takes closed at once by every wait" flat
# #622 / #632 F1-F3: the change alone is not a report. The exit row is the single owner
# of "changed file AND `Status` is `idle`" — `error` and `closed` settle at the `error`
# exit — and every other reader of a changed file points at that row. Which is what lets
# Teardown carry no first-write caveat and no release wait around one.
pin "$REF" 'and `Status` is `idle`' "the report exit needs an idle seat, not a first write" flat
# The identity must change on every replacement: a rename mints a new inode, while
# `mtime` can hold across one inside its timestamp granularity (#608 review, round 1).
pin "$REF" 'Never `mtime` alone' "the identity is the inode, never mtime alone" flat
# An `error` retry that replays a dispatch which may have mutated repeats its side
# effects — a commit, a push, a PR, a close (#608 review, round 1).
pin "$REF" 'is never replayed' "a dispatch that may have mutated is not replayed" flat
# #635 N6: the loop checks `error` before `permission`, so a seat that settles `error` or
# `closed` with a request pending wakes as `error`. The route therefore reads the pending
# request with the activity and artifacts, rather than leaving it unread on the escalate and
# `closed` arms.
pin "$REF" 'its pending permissions, its durable artifacts' "the error route reads the seat's pending permissions" flat
# #635 M5: round 2's contract change was unpinned — restoring `186623e`'s paseo-mechanics.md
# left this suite green. The route reads the seat's `REPORT_PATH` with its activity and
# artifacts, and a changed body there is evidence for that reconciliation, never a `report`
# (#632 fix rounds 2 and 3). Measured against the two snapshots, flat: the read pin 0 at
# 186623e and 1 at f756693, the classification pin 0 at both — so the read pin alone carries
# the f756693 boundary.
pin "$REF" 'its durable artifacts and its `REPORT_PATH` first' "the error route reads REPORT_PATH with its artifacts" flat
pin "$REF" 'evidence for this reconciliation, never a `report`' "an errored seat's changed body is evidence, never a report" flat
# Controls: `paseo wait` returns on the first idle (F2), so it must never be the finish.
# Guarded like the J3 control above (#635 N11's class: a count that cannot read its file
# must say so, not surface as an arithmetic error).
if c="$(occurrences "$REF" 'paseo wait')"; then
  if [ "$c" -le 1 ]; then pass "paseo wait is at most named as the thing not to use ($c)"
  else fail "paseo wait is not a completion primitive" "$c occurrences"; fi
else fail "the paseo-wait control is readable" "unreadable file or empty needle: $REF"; fi

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
# #629 D6 / #632 F8: the thinking option was demoted to a comment, so a launch copying the
# command line dropped a profile's `thinkingOptionId` silently. The command carries the
# bracketed placeholder now, and the prose says when it is dropped.
pin "$REF" '[--thinking <thinkingOptionId>]' "the launch line carries the optional thinking flag" flat
# #635 N10: the F8 swap left the CONDITION unpinned — the command token alone stays green if
# the prose stops saying when the flag is dropped, which was the #629 D6 defect. This is the
# condition the demoted comment used to carry.
pin "$REF" 'dropped for a profile that sets none' "the thinking flag is dropped for a profile that sets none" flat
# #608 review round 9: an idle with neither a question nor a background-work claim
# is the missing-report case rather than an unwatched dispatch. (The child-reconcile
# procedure this round added to the handoff branch was deleted by the operator ruling.)
pin "$REF" 'one bounded correction request asking it to write `REPORT_PATH`' "an idle with no question and no report goes to the correction path" flat
pin "$REF" 'the reviewer once the review is final' "the reviewer is released when the review is final, not at its first report" flat
# #609: step 12's merge gate closes each item, so a release tied to it would archive the
# retained implementer the next item is dispatched to. The retention's end is roles.md's
# to say, and mechanics points there instead of naming the item boundary.
pin "$REF" 'the implementer when its retention ends' "the implementer is released at its retention's end, not per item" flat
pin "$REF" 're-arms its own waits and a fresh heartbeat' "after a failed launch this session re-arms and stays the orchestrator"
pin "$REF" 'Never archive a predecessor while a subagent in its workspace runs' "the no-archive rule survives"
pin "$REF" 'Kill this session'"'"'s armed background waits' "the predecessor stands down"

section "teardown and the cascade"
present "$REF" 'archive_agent' "a seat is released with archive_agent"
present "$REF" 'archive_workspace' "a run-created workspace is released with archive_workspace"
pin "$REF" 'Close only what the run created' "only run-created things are archived"
# #638: the operator's tab confirmation is gone, and the clause that replaced it names the
# daemon's own handling — an absence check with its guard, because a reintroduced ask must fail
# here rather than pass unread, and its replacement cannot be dropped silently beside it.
if c="$(count_of "$REF" 'ask for those tabs to be closed' flat)"; then
  if [ "$c" -eq 0 ]; then pass "no operator tab confirmation is required ($c)"
  else fail "the operator tab confirmation is gone" "$c occurrence(s)"; fi
else fail "the teardown tab-ask control is readable" "unreadable file or empty needle: $REF"; fi
pin "$REF" "A client tab on it is the daemon's to handle" "the removed ask's replacement names the daemon" flat
# #639 V11: the old needle also sat in the idle handler, so reverting Teardown's clause left it
# green. This phrase now exists only in that clause (the Completion and cascade sites point at
# it), so a revert of the clause alone goes RED.
pin "$REF" 'a spine or work-PR session, a lane driver with subagents' "the coordinator clause names a lane driver too" flat
pin "$REF" 'after it reports its own children released' "a coordinator is archived after its children"

section "herdr is gone"
# Deliberate: these herdr strings are asserted ABSENT. Guarded like the other counts
# (#635 N11's class): an unreadable file must say so rather than certify each absence.
for gone in 'herdr' 'HERDR_' 'pane' '--until' 'wait-output' '--machine'; do
  if c="$(occurrences "$REF" "$gone")"; then
    if [ "$c" -eq 0 ]; then pass "no '$gone' in paseo-mechanics.md"
    else fail "no '$gone' in paseo-mechanics.md" "$c occurrence(s)"; fi
  else fail "the '$gone' absence control is readable" "unreadable file or empty needle: $REF"; break; fi
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
# This within-budget line separates a comparison that measures the overshoot from one that
# accepts any count — measured, mutating the comparison to `[ "$_n" -ge 0 ]` left the suite
# green until this control existed.
ctl_under="$(mktemp)"
awk -v n="$((REF_BUDGET - 1))" 'BEGIN { for (i = 0; i < n; i++) print "" }' > "$ctl_under"
if r="$(budget_report "$ctl_under")" && [ "${r##* }" -eq 0 ]; then pass "control: a file within the budget reports no overshoot"
else fail "control: a file within the budget reports no overshoot" "read [$r]"; fi
rm -f "$ctl_over" "$ctl_under"

section "no personal name ships"
# Guarded like the other counts (#635 N11's class, #639 G8): a refused read must say so rather
# than leave `hits` at 0 and certify every absence in a file nobody opened.
hits=0; refused=0
for needle in claude-glm claude-glm-flash claude-sol glm-5.3 Fable; do
  if c="$(occurrences "$REF" "$needle")"; then hits=$((hits + c)); else refused=1; break; fi
done
if [ "$refused" -eq 1 ]; then fail "the personal-name sweep is readable" "unreadable file or empty needle: $REF"
elif [ "$hits" -eq 0 ]; then pass "no personal name in paseo-mechanics.md"
else fail "no personal name in paseo-mechanics.md" "$hits occurrence(s)"; fi

section "the hoisted counters are not re-copied"
assert_hoisted_counters

report
