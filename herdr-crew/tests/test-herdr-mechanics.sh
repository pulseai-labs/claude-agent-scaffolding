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
# 0.2.2 (seat-mods) added the guarded-seat paragraph to the launch's step 2 — the two
# --env flags, the scratch directory and who never gets them: six lines, 237 -> 243,
# again mechanics the file exists to state. The operator-facing rule (never in settings.json)
# first lived only in seat-mods' README. The final review restored it here (spec §5 binds
# both places) with an ossify implementer's handoff directory: two lines, 243 -> 245.
# 0.2.3 (#640) added the worker ping and the heartbeat backstop: the ping line, the
# generation-first consumption rules — including what deduplication does NOT suppress, a
# live dialog and the tick's health check — the wrong-path refusal, and the heartbeat's
# classification and kill points. +27 lines on insertion, traded back 12 (detection events,
# the wait-output caveat, the typed-wait set, the two-dead-ends and doorbell paragraphs, the
# launch intro and steps 1/3/5, and the teardown close paragraph) to land at 260. The gate
# rose with the mechanics the file exists to state and still fails over the limit.
# 0.2.5 (#651 part 5) made step 2 state the guard's own reach — a coordinator's child
# seats and every replacement launch — and list the coordinator classes as unguarded,
# with the status line read at the model read: four lines, 260 -> 264. Fix round 1 put the
# guard in its pane-run form, where the launcher's own shell cannot arm itself, and added
# the replaces: rule: two lines, 264 -> 266.
# 0.2.7 (seat-mods 0.2.0) rewrote step 2 as seat marking — the two free roles' exports, the
# operator's own top, and the #658 fold-ins (<run dir>, the banner status read, the
# missing-status-line route and disposition): the paragraph grew with the mechanics it
# exists to state and the gate rose with it, 266 -> 272. Fix round 1 added the operator-role
# class (guarded as implementer, with its report and scratch directories in SEAT_MODS_ALLOW)
# and the once-only dsh carve-out, deleted the vestigial 0.2.5 binding sentence and reworded
# the guarded sentence's actor: 272 -> 275. The adjacent control runs the same predicate on a
# file one line over the real reference and, when that is accepted, names the remedy (lower
# REF_BUDGET to the real file's count) instead of reading as an over-budget failure.
REF_BUDGET=358  # 0.2.9: raised from 322 for step 2's autonomic marking and Completion's child-pain paragraph (0.2.8: from 275).

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
# #650 R1-1: one generation rule. The typed wake's novelty test must be the same
# hash-or-identity comparison the ping and the doorbell use; hash alone is the old
# form, and it read a byte-identical atomic replacement as a false wake.
pin "$REF" 'a different hash or identity' \
  "the typed wake's novelty is the same hash-or-identity generation (#650 R1-1)" flat

# #575: the pair is re-armed, not restarted, after a dialog the operator answered.
pin "$REF" 'An answered dialog re-arms the pair' \
  "an answered dialog re-arms the pair (#575)"
pin "$REF" 'the doorbell and its companion again, not one wait' \
  "the fresh wait after an answer is the pair again, not one wait (#575)"

section "placement"
present "$REF" '--cwd' "a seat's tree is set with --cwd"
present "$REF" '--label' "a seat's tab is labelled"
present "$REF" '--base <base-branch>' "a worktree seat's base is a slot, not a literal"

# The one gate: both the real check and its control go through this predicate, so the
# control cannot re-implement a comparison this suite may have changed (#651 fix round 1,
# N4). An unreadable file is refused, not counted.
within_budget() { # <file>
  [ -r "$1" ] || return 2
  [ "$(wc -l < "$1" | tr -d ' ')" -le "$REF_BUDGET" ]
}

section "molt children (0.2.8)"
pin "$REF" '**molt marking.**' "step 2 has the molt marking clause" flat
pin "$REF" 'MOLT_HANDOFF=parent MOLT_STATUS_PATH=<REPORT_PATH>.molt-status' \
  "step 2 names the child marking exactly" flat
pin "$REF" 'every guarded seat, every coordinator seat and every operator-declared role' \
  "step 2 marks every child kind" flat
pin "$REF" 'The operator'"'"'s first top and the top'"'"'s rotation successor are roots and take neither' \
  "step 2 never marks the top" flat
pin "$REF" '**A molt is not a launch.**' "step 2: a molt keeps the top's marking" flat
pin "$REF" 'A respawned child is a launch: this step runs again in full' \
  "step 2: a respawn re-runs the marking, the allow list and the status-line read (Review Focus 6)" flat
pin "$REF" "**A child past molt's warnings.**" "Completion holds the parent rules once" flat
pin "$REF" 'MOLT WARNING <pct> <task id>' "the ping text is named" flat
pin "$REF" 'per tick, per live seat, also reads its recorded status file' \
  "the heartbeat reads each child's status file (Review Focus 2)" flat
pin "$REF" 'note it and send that seat no new unit' "a warned child gets no new unit" flat
pin "$REF" 'launched from the same row, marked the same, with a fresh `REPORT_PATH`' \
  "a respawn takes a fresh REPORT_PATH, so a fresh status file (Review Focus 1)" flat
pin "$REF" 'RESUME FROM: <handoff path>' "the respawned brief names the handoff" flat
pin "$REF" 'it reuses its predecessor'"'"'s scratch directory' \
  "a respawn keeps the report and scratch directories writable (Review Focus 6)" flat
pin "$REF" 'run-spine re-enters a started spine, mid-round included, so respawn it as a `rotate:` is' \
  "a spine cut mid-round is respawned under ossify 1.14.0, not relayed (#674)" flat
pin "$REF" 'only that halt goes to the operator' "a re-entry halt still goes to the operator (#674)" flat
c="$(count_of "$REF" 'relay it to the operator with its handoff path: a spine session' flat)"
if [ "$c" -eq 0 ]; then pass "the relayed-cut list no longer names the spine session (#674)"
else fail "the relayed-cut list no longer names the spine session (#674)" "$c left"; fi
pin "$REF" 'relay it to the operator with its handoff path' "a skill-run cut is relayed" flat
# Final review (0.2.8) — each pin is one finding.
pin "$REF" 'not a report ping: it names no path' "the MOLT WARNING ping gets no correction request" flat
pin "$REF" 'Record that path per seat at launch' "a retained seat's status file is the launch one" flat
pin "$REF" 'its next unit (a fix round, a re-check, the next item) goes to a fresh seat' \
  "a warned seat's next unit goes to a fresh seat, so the run never stalls" flat
pin "$REF" 'never a new `worktree create`' "a respawned implementer keeps its predecessor's worktree" flat
pin "$REF" 'Close the predecessor'"'"'s pane only after the new tab exists' "the old pane outlives the new tab" flat
pin "$REF" 'every respawn, after `rotate:` and `open:` included' "a rotate/open respawn takes a fresh REPORT_PATH too" flat
pin "$REF" 'whose seat has returned no `rotate:`, `open:` or `handoff:`' \
  "a handed-off line that is a return's own respawns nothing twice" flat
# PR #671 round 1.
pin "$REF" 'Before a retained seat'"'"'s next unit, read its recorded status file' \
  "an idle retained seat's status is read before it gets another unit" flat
pin "$REF" 'a reviewer that hands off before its report validates' \
  "a reviewer cut mid-review goes to the operator, never a second review" flat
# PR #671 round 2.
pin "$REF" 'settle the predecessor'"'"'s dispatch first' "a status-only handoff retires the old wait before the respawn" flat
pin "$REF" 'a work-PR session that hands off with no `open:`' "a work-PR cut mid-round goes to the operator" flat
pin "$REF" 'SEAT_MODS_ALLOW=<REPORT_PATH'"'"'s directory>:<its scratch directory> MOLT_HANDOFF=parent MOLT_STATUS_PATH=<REPORT_PATH>.molt-status' \
  "step 2's quoted guarded export carries the molt marking" flat

section "autonomic marking (0.2.9, #676)"
pin "$REF" '**autonomic marking.**' "step 2 has the autonomic marking clause" flat
pin "$REF" 'MOLT_STATUS_PATH=<REPORT_PATH>.molt-status AUTONOMIC_LEDGER=<ledger> AUTONOMIC_PAIN_PATH=<REPORT_PATH>.autonomic-pain' \
  "step 2's quoted guarded export carries the autonomic variables" flat
pin "$REF" '`AUTONOMIC_MODE=autopilot` only when the launcher is itself in autopilot' \
  "autopilot is passed down, never set on a manual launcher's child" flat
pin "$REF" 'jq -r .mode ~/.claude/state/autonomic/sessions/$CLAUDE_CODE_SESSION_ID.json' \
  "the launcher's mode is read from its own record" flat
pin "$REF" 'never `$AUTONOMIC_MODE`' "the mode is never read from the environment" flat
pin "$REF" 'a missing record included' "a missing record reads as manual" flat
pin "$REF" 'an **absolute** path outside every worktree' "the ledger is absolute and outside every worktree" flat
pin "$REF" 'the launcher'"'"'s own `$AUTONOMIC_LEDGER` when set, else `<run dir>/autonomic-ledger.md`' \
  "one ledger per run, inherited down the tree" flat
pin "$REF" 'A relative launcher value is first resolved against the launcher'"'"'s own repo root' \
  "an inherited relative ledger is made absolute before it is passed on (PR #679 r1)" flat
pin "$REF" 'is not passed on: the child gets `<run dir>/autonomic-ledger.md` instead' \
  "an unsafe inherited ledger path falls back to the run ledger, never into the export (PR #679 r3)" flat
c="$(count_of "$REF" 'single-quoted in the export' flat)"
if [ "$c" -eq 0 ]; then pass "no quoting rule for the ledger remains (PR #679 r3)"
else fail "no quoting rule for the ledger remains (PR #679 r3)" "$c left"; fi
pin "$REF" '`AUTONOMIC_BELL` is never set' "no per-seat bell" flat
pin "$REF" 'and `AUTONOMIC_LEDGER` by the same rule and no pain path' "the top's successor keeps autopilot, has no parent" flat
pin "$REF" '**A child'"'"'s pain.**' "Completion has the child-pain paragraph" flat
pin "$REF" 'The heartbeat, per tick, per live seat, reads it too' "the heartbeat reads each child's pain file" flat
pin "$REF" 'it is never a failed task' "a pain line is an ask, not a failure" flat
pin "$REF" 'seat-mods refuses the call before autonomic sees it' "a seat-mods deny rings no pain of its own (F7)" flat

section "budget"
n="$(wc -l < "$REF" | tr -d ' ')"
if within_budget "$REF"; then pass "herdr-mechanics.md within the reference budget ($n lines)"
else fail "herdr-mechanics.md within the reference budget" "$n lines, over by $((n - REF_BUDGET))"; fi
# Adjacent control (#651, fix round 1 N4): the fixture is one line longer than the REAL
# reference file and the SAME predicate must refuse it. A REF_BUDGET-derived fixture
# cannot see the constant move — raise REF_BUDGET and budget+1 scales with it, leaving the
# control green — so this one is derived from the file: a gate rebuilt around a raised
# constant accepts the fixture and fails here.
ctl="$(mktemp)"
awk -v n="$(( $(wc -l < "$REF" | tr -d ' ') + 1 ))" 'BEGIN { for (i = 0; i < n; i++) print "x" }' > "$ctl"
if within_budget "$ctl"; then
  fail "control: one line over the real reference file is refused" "accepted $(wc -l < "$ctl" | tr -d ' ') lines at REF_BUDGET=$REF_BUDGET — the real reference is $n lines; lower REF_BUDGET to $n"
else
  pass "control: one line over the real reference file is refused"
fi
rm -f "$ctl"

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
