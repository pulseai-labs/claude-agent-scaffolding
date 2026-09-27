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
REF_BUDGET=275

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
pin "$REF" '`cancel_agent` the successor if one was created' "a failed successor launch (parented, errored or no id) is cancelled"
# #608 review round 7 (CodeRabbit) and round 8 (Codex): archiving a successor that
# already started seats cascades into its same-workspace children and detaches the
# rest, so EVERY child it started is released before the archive.
pin "$REF" 'every child it started is released before the archive' "the failed successor's children are all released, not cascaded" flat
pin "$REF" '`archive_agent` it, and' "the failed successor is archived only after that reconcile" flat
# #608 review round 8: the detached command takes no feature values, and the seat's
# retention runs to the review being final, not its first report.
pin "$REF" 'hands on without them' "the handoff names the featureValues a detached launch drops" flat
# #608 review round 9: each failed successor child's own activity and artifacts are
# reconciled before it is archived, and an idle with neither a question nor a
# background-work claim is the missing-report case rather than an unwatched dispatch.
pin "$REF" 'durable artifacts are read and reconciled first' "each failed successor child's artifacts are reconciled" flat
pin "$REF" 'one bounded correction request asking it to write `REPORT_PATH`' "an idle with no question and no report goes to the correction path" flat
pin "$REF" 'the reviewer once the review is final' "the reviewer is released when the review is final, not at its first report" flat
pin "$REF" 're-arm this session'"'"'s own waits and a fresh heartbeat' "after a parented launch this session re-arms and stays the orchestrator"
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
n="$(wc -l < "$REF" | tr -d ' ')"
if [ "$n" -le "$REF_BUDGET" ]; then pass "paseo-mechanics.md within the reference budget ($n lines)"
else fail "paseo-mechanics.md within the reference budget" "$n lines, over by $((n - REF_BUDGET))"; fi

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
