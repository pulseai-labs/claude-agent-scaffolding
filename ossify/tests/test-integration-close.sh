#!/usr/bin/env bash
# End-to-end CLOSE arc through the real `bin/oss` dispatcher (Plan C1 Task 14).
#
# SCOPE, stated plainly so nobody infers coverage that does not exist.
#
# COVERED: the STATE arc a full close narrative walks - onboarding writes, a
# release, a spine, work items with their exec fields, the demo ledger, a
# planned amendment, the work-item close layer, apply-pending, a spine close, a
# SECOND spine closed, then the release close with its blocking fake gate - all
# driven through `bin/oss`, which runs `set -euo pipefail`. Every station
# asserts a CONCRETE observable value (an id, a status, a count, a TSV row, an
# exact selector string), never a bare rc, because this is one long arc and a
# station that only checks rc cannot tell a working ceremony from one whose
# earlier station silently wrote nothing.
#
# NOT COVERED here, and covered elsewhere:
#   * The GIT half of spine close - the derived spine branch, the base_branch
#     guards, the switch-back HEAD assertion, the first-parent changed-path
#     computation, the merge-conflict halt, `touch_check`'s four exit codes and
#     both blocking gates' full rc contracts: `tests/test-close.sh` sections
#     C, D, E and F. This file records `work_items[].branch` as a VALUE and
#     never runs `git merge`.
#   * The router, the four-layer gate's ordering, the halt semantics and the
#     recovery menu: PROSE contracts with no executable surface, except Layer
#     4's workflow script, covered separately by `test-workflows.sh`
#     (`test-close.sh`'s own header says so). Task 13's bash-block harness
#     (`test-skill-bash-blocks.sh`) checks that every `oss` verb they name
#     resolves; beyond that they have no automated coverage in this release.
#
# THE REPLAY GUARD IS SCOPED TO THE 13 OPS THIS ARC JOURNALS, not to
# `_oss_apply_op`'s full 26-case surface. The tail asserts the DISTINCT op set
# exactly, so an arc edit that drops one reds this file rather than quietly
# shrinking the claim. The 13 journaled here:
#
#   add_close_record  add_demo_line  add_fake  add_release  add_spine
#   add_work_item  apply_demo_pending  set_demo_line_pending  set_fake_status
#   set_release_status  set_spine_status  set_work_item_exec
#   set_work_item_status
#
# The other 13, each with the file that covers it - read this list before
# adding an op here to "improve coverage":
#
#   set_posture           test-state-core.sh, test-state-replay.sh, test-doctor.sh
#   set_composition       test-dispatcher-ops.sh, test-demo-runner.sh
#   set_overlay           test-dispatcher-ops.sh
#   set_spine_class       test-entities.sh
#   add_bone              test-registries.sh, test-dispatcher-ops.sh
#   add_risk_gate         test-registries.sh
#   add_feature           test-registries.sh
#   set_demo_line_status  test-state-replay.sh, test-dispatcher-ops.sh (quarantine)
#   clear_demo_pending    test-ledger.sh, test-spine-planning.sh, test-state-replay.sh
#   add_patch_record      test-ledger.sh
#   set_release_meta      test-release-planning.sh
#   add_veto_disposition  test-release-planning.sh
#   migrate_schema        test-migration.sh
#
# CLOSE RECORDS: this arc runs FOUR close ceremonies (one work item pair, two
# spines, one release) and ends with THREE close records. The work-item close
# layer writes NONE - `work-item-close.md` contains no `demo_record` call, and
# only `spine-close.md` §9 and `release-close.md` §9 write one. That is
# deliberate (`demo_record_close`'s scope enum carries `work_item`, but C1 only
# ever records `spine` and `release`), so the tail asserts the BREAKDOWN by
# scope - work_item 0, spine 2, release 1 - rather than "one record per close",
# which is false against correct behaviour in both directions.
#
# THE RELEASE CLOSE IS RUN LEGALLY. `release-close.md` §2 halts on any spine
# that is neither `closed` nor `abandoned`, and `oss release_status` enforces
# nothing (`entities.sh:85-93` validates only the enum). A test that closes the
# release without running §2's selector goes GREEN over a close the shipped
# ceremony would refuse. So §2's selector is executed VERBATIM here, asserted
# NON-EMPTY while the second spine is still open (the liveness half - without
# it the assertion could never fail) and asserted EMPTY immediately before the
# release close.
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
for lib in id state manifest commands entities registries ledger demo doctor verify worktree; do . "$HERE/../lib/$lib.sh"; done
OSS="$HERE/../bin/oss"

# The manifest fixture the demo runner's WORKDIR resolution needs: `oss demo_run`
# with the state-file argument omitted resolves its working directory through
# `_oss_repo_root canonical`, which reads the pairing manifest off the walk-up
# path from $PWD. `well_known_paths.project_state` is pointed at the SAME path as
# $OSS_STATE_FILE so `_oss_resolve_state` stays silent - a DIFFERING routed path
# makes it print an "overriding the manifest-routed ..." notice on stderr, which
# t_capture's `2>&1` folds into every T_OUT and breaks the exact-value assertions.
TMP="$(mktemp -d)"; export OSS_STATE_FILE="$TMP/state.json"
mkdir -p "$TMP/.workspace" "$TMP/canon"
cat > "$TMP/.workspace/pairing.json" <<EOF
{"schema_version":"1.0","ai_workspace":{"root":"$TMP"},"canonical":{"root":"$TMP/canon"},"well_known_paths":{"project_state":"\${ai_workspace.root}/state.json"}}
EOF
cd "$TMP"

# ---------------------------------------------------------------------------
# Station 1 - init. The arc starts from a state with an EMPTY close-record set,
# so every count asserted below is this arc's own doing.
# ---------------------------------------------------------------------------
t_capture "$OSS" init "e2e-close"
t_assert_rc 0 "station 1: init through the dispatcher"
t_capture "$OSS" get '.project.name'
t_assert_eq "e2e-close" "$T_OUT" "station 1: this arc's own state, not a stale one"
t_capture "$OSS" get '.close_records | length'
t_assert_eq "0" "$T_OUT" "station 1: no close records before any close"
t_capture "$OSS" get '.mutations | length'
t_assert_eq "0" "$T_OUT" "station 1: init journals nothing - the op set below is the arc's"

# ---------------------------------------------------------------------------
# Station 2 - the release and the first spine.
# ---------------------------------------------------------------------------
t_capture "$OSS" release_add "Skeleton" "core loop usable"
t_assert_eq "r0" "$T_OUT" "station 2: release r0"
t_capture "$OSS" spine_add r0 "trade entry" flesh
t_assert_eq "r0.s1" "$T_OUT" "station 2: spine r0.s1"
t_capture "$OSS" get '.spines[] | select(.id=="r0.s1") | .class'
t_assert_eq "flesh" "$T_OUT" "station 2: r0.s1 is declared flesh"

# ---------------------------------------------------------------------------
# Station 3 - two work items, and the exec fields the merge reads back.
# `work_items[].branch` is the field spine close resolves its merge target from
# (it holds an id and no slug), so the STORED value is asserted against the id
# grammar's own derivation rather than against a literal typed twice.
# ---------------------------------------------------------------------------
t_capture "$OSS" work_item_add r0.s1 "wire the entry point"
t_assert_eq "r0.s1.w1" "$T_OUT" "station 3: work item r0.s1.w1"
t_capture "$OSS" work_item_add r0.s1 "record the fill"
t_assert_eq "r0.s1.w2" "$T_OUT" "station 3: work item r0.s1.w2"

t_capture "$OSS" work_item_branch r0.s1.w1 wire-the-entry-point
t_assert_eq "work/r0.s1.w1-wire-the-entry-point" "$T_OUT" "station 3: the derived work-item branch"
W1_BRANCH="$T_OUT"
t_capture "$OSS" work_item_exec r0.s1.w1 "$W1_BRANCH" "$TMP/canon/.worktrees/r0.s1.w1" "0000000000000000000000000000000000000001"
t_assert_rc 0 "station 3: r0.s1.w1 exec fields recorded"
t_capture "$OSS" work_item_exec r0.s1.w2 "work/r0.s1.w2-record-the-fill" "$TMP/canon/.worktrees/r0.s1.w2" "0000000000000000000000000000000000000002"
t_assert_rc 0 "station 3: r0.s1.w2 exec fields recorded"

t_capture "$OSS" get '.work_items[] | select(.id=="r0.s1.w1") | .branch'
t_assert_eq "$W1_BRANCH" "$T_OUT" "station 3: the merge target reads back off STATE, not off a slug"
t_capture "$OSS" get '.work_items[] | select(.id=="r0.s1.w1") | .worktree_path'
t_assert_eq "$TMP/canon/.worktrees/r0.s1.w1" "$T_OUT" "station 3: worktree_path reads back"
t_capture "$OSS" get '.work_items[] | select(.id=="r0.s1.w1") | .base_sha'
t_assert_eq "0000000000000000000000000000000000000001" "$T_OUT" "station 3: base_sha reads back"

# ---------------------------------------------------------------------------
# Station 4 - the fake ledger entry whose expiry release is the one this arc
# closes, and the demo ledger. d3 is the line the spine will supersede.
# ---------------------------------------------------------------------------
t_capture "$OSS" fake_add "broker-api" fake "no sandbox creds yet" "sandbox creds arrive" r0
t_assert_rc 0 "station 4: fake recorded with expiry r0"

t_capture "$OSS" ledger_add_auto r0.s1 "core loop runs" "bash -c 'exit 0'" "exit:0"
t_assert_eq "d1" "$T_OUT" "station 4: auto line d1"
t_capture "$OSS" ledger_add_user r0.s1 "place a paper trade and see it in open positions" "position appears"
t_assert_eq "d2" "$T_OUT" "station 4: user journey line d2"
t_capture "$OSS" ledger_add_auto r0.s1 "legacy entry path runs" "bash -c 'exit 0'" "exit:0"
t_assert_eq "d3" "$T_OUT" "station 4: auto line d3 - the one the amendment targets"

# ---------------------------------------------------------------------------
# Station 5 - the PLANNED amendment. `supersede` records intent and leaves the
# line LIVE; only a close applies it. Both halves are asserted, because a
# supersede that took effect immediately would make station 8's apply
# unobservable and this whole leg vacuous.
# ---------------------------------------------------------------------------
t_capture "$OSS" ledger_supersede d3 r0.s1 "the new entry path replaces it"
t_assert_rc 0 "station 5: amendment planned on d3"
t_capture "$OSS" get '.demo_ledger[] | select(.id=="d3") | .status'
t_assert_eq "active" "$T_OUT" "station 5: a PLANNED amendment leaves the line active"
t_capture "$OSS" get '[.demo_ledger[] | select(.id=="d3") | .pending_amendments[]] | length'
t_assert_eq "1" "$T_OUT" "station 5: exactly one pending amendment on d3"
t_capture "$OSS" get '.demo_ledger[] | select(.id=="d3") | .pending_amendments[0].by'
t_assert_eq "r0.s1" "$T_OUT" "station 5: keyed to the planning spine - the join key apply matches on"
t_capture "$OSS" get '.demo_ledger[] | select(.id=="d3") | .pending_amendments[0].status'
t_assert_eq "superseded" "$T_OUT" "station 5: the planned status is superseded"

# ---------------------------------------------------------------------------
# Station 6 - the WORK-ITEM close layer. Two facts, and the second is the one
# the arc exists to pin: completing work items writes NO close record.
# spine-close.md §2's selector is run verbatim, non-empty first so the empty
# assertion below cannot be vacuous.
# ---------------------------------------------------------------------------
spine_id="r0.s1"
OPEN_WI="$("$OSS" get "[.work_items[] | select(.spine==\"$spine_id\" and .status != \"complete\") | .id] | join(\", \")")"
t_assert_eq "r0.s1.w1, r0.s1.w2" "$OPEN_WI" "station 6: spine-close §2's selector NAMES the incomplete items"

t_capture "$OSS" work_item_status r0.s1.w1 complete
t_assert_rc 0 "station 6: r0.s1.w1 complete"
t_capture "$OSS" work_item_status r0.s1.w2 complete
t_assert_rc 0 "station 6: r0.s1.w2 complete"

# rc captured alongside the value: this is the EMPTY assertion, and an `oss get`
# that failed outright would also produce an empty string. Without the rc the
# gate-satisfied claim could be made by a broken selector.
OPEN_WI="$("$OSS" get "[.work_items[] | select(.spine==\"$spine_id\" and .status != \"complete\") | .id] | join(\", \")")"; SEL_RC=$?
t_assert_eq "0" "$SEL_RC" "station 6: the selector itself ran"
t_assert_eq "" "$OPEN_WI" "station 6: the spine-close gate is satisfied - no item left open"
t_capture "$OSS" get '.close_records | length'
t_assert_eq "0" "$T_OUT" "station 6: the work-item close layer writes NO close record"

# ---------------------------------------------------------------------------
# Station 7 - apply-pending, spine close step 3. It runs AFTER the merge and
# BEFORE the demo so the demo measures the amended set. The active auto count
# either side of the call is the observable: 2 -> 1.
# ---------------------------------------------------------------------------
t_capture "$OSS" get '[.demo_ledger[] | select(.type=="auto" and .status=="active")] | length'
t_assert_eq "2" "$T_OUT" "station 7: two active auto lines BEFORE the apply"
t_capture "$OSS" ledger_apply_pending r0.s1
t_assert_rc 0 "station 7: apply_pending for r0.s1"
t_capture "$OSS" get '.demo_ledger[] | select(.id=="d3") | .status'
t_assert_eq "superseded" "$T_OUT" "station 7: d3 is superseded once the planning spine closes"
t_capture "$OSS" get '.demo_ledger[] | select(.id=="d3") | .status_by'
t_assert_eq "r0.s1" "$T_OUT" "station 7: the applying spine is recorded on the line"
t_capture "$OSS" get '[.demo_ledger[] | select(.id=="d3") | .pending_amendments[]] | length'
t_assert_eq "0" "$T_OUT" "station 7: the applied entry is CONSUMED, not left pending"
t_capture "$OSS" get '.demo_ledger[] | select(.id=="d1") | .status'
t_assert_eq "active" "$T_OUT" "station 7: the untargeted line is untouched"
t_capture "$OSS" get '[.demo_ledger[] | select(.type=="auto" and .status=="active")] | length'
t_assert_eq "1" "$T_OUT" "station 7: one active auto line AFTER the apply"

# ---------------------------------------------------------------------------
# Station 8 - spine close step 4, the cumulative demo. State-file argument
# OMITTED, so the resolver's $OSS_STATE_FILE branch and the manifest-routed
# workdir are both exercised on the path the ceremony actually takes.
# ---------------------------------------------------------------------------
t_capture "$OSS" demo_run
t_assert_rc 0 "station 8: the cumulative auto demo passes"
t_assert_contains "$T_OUT" "PASS 1 lines" "station 8: it ran the AMENDED set (1 line), not the pre-amendment 2"
USER_LINES="$("$OSS" demo_user_lines r0.s1 | jq 'length')"
t_assert_eq "1" "$USER_LINES" "station 8: the spine walk sees this spine's own user line"
USER_TEXT="$("$OSS" demo_user_lines r0.s1 | jq -r '.[0].text')"
t_assert_eq "place a paper trade and see it in open positions" "$USER_TEXT" "station 8: and it is d2's text"

# ---------------------------------------------------------------------------
# Station 9 - spine close step 11, the state writes. The FIRST close record.
# ---------------------------------------------------------------------------
t_capture "$OSS" spine_status r0.s1 closed
t_assert_rc 0 "station 9: r0.s1 closed"
t_capture "$OSS" demo_record spine r0.s1 true 1 "spine close - amended set green"
t_assert_rc 0 "station 9: spine close recorded"
t_capture "$OSS" get '.close_records | length'
t_assert_eq "1" "$T_OUT" "station 9: exactly one close record so far"
t_capture "$OSS" get '.close_records[0].scope'
t_assert_eq "spine" "$T_OUT" "station 9: scoped spine"
t_capture "$OSS" get '.close_records[0].id'
t_assert_eq "r0.s1" "$T_OUT" "station 9: for r0.s1"
t_capture "$OSS" get '.close_records[0].demo_lines'
t_assert_eq "1" "$T_OUT" "station 9: carrying the line count the demo actually ran"

# ---------------------------------------------------------------------------
# Station 10 - the SECOND spine. Its own work item and its own auto line, so
# the release walk below measures a strictly larger set than either spine's.
# ---------------------------------------------------------------------------
t_capture "$OSS" spine_add r0 "fill recording" flesh
t_assert_eq "r0.s2" "$T_OUT" "station 10: spine r0.s2"
t_capture "$OSS" work_item_add r0.s2 "persist the fill"
t_assert_eq "r0.s2.w1" "$T_OUT" "station 10: work item r0.s2.w1"
t_capture "$OSS" ledger_add_auto r0.s2 "fill is recorded" "bash -c 'exit 0'" "exit:0"
t_assert_eq "d4" "$T_OUT" "station 10: auto line d4 from the second spine"

# THE LIVENESS HALF of the release gate. release-close.md §2's selector, run
# verbatim while r0.s2 is still open. If this came back empty the empty
# assertion at station 12 would prove nothing.
rel="r0"
OPEN_SPINES="$("$OSS" get "[.spines[] | select(.release==\"$rel\" and .status != \"closed\" and .status != \"abandoned\") | \"\(.id) (\(.status))\"] | join(\", \")")"
t_assert_eq "r0.s2 (planned)" "$OPEN_SPINES" "station 10: §2's selector NAMES the open spine AND its status"

t_capture "$OSS" work_item_status r0.s2.w1 complete
t_assert_rc 0 "station 10: r0.s2.w1 complete"
t_capture "$OSS" demo_run
t_assert_rc 0 "station 10: the cumulative demo passes for the second spine"
t_assert_contains "$T_OUT" "PASS 2 lines" "station 10: CUMULATIVE - d1 plus d4, not the second spine's own line alone"
t_capture "$OSS" spine_status r0.s2 closed
t_assert_rc 0 "station 10: r0.s2 closed"
t_capture "$OSS" demo_record spine r0.s2 true 2 "spine close - cumulative set green"
t_assert_rc 0 "station 10: second spine close recorded"

# ---------------------------------------------------------------------------
# Station 11 - release close step 1. THE LEGALITY GATE. `oss release_status`
# enforces nothing, so this selector is the only thing standing between the arc
# and a close the shipped ceremony would refuse.
# ---------------------------------------------------------------------------
# Same rc guard as station 6, and for the same reason: an `oss get` that failed
# would hand this assertion the empty string it is looking for.
OPEN_SPINES="$("$OSS" get "[.spines[] | select(.release==\"$rel\" and .status != \"closed\" and .status != \"abandoned\") | \"\(.id) (\(.status))\"] | join(\", \")")"; SEL_RC=$?
t_assert_eq "0" "$SEL_RC" "station 11: §2's selector itself ran"
t_assert_eq "" "$OPEN_SPINES" "station 11: §2's gate is SATISFIED - every spine in r0 is closed"
ABANDONED="$("$OSS" get "[.spines[] | select(.release==\"$rel\" and .status == \"abandoned\") | .id] | join(\", \")")"
t_assert_eq "" "$ABANDONED" "station 11: and none was abandoned, so the third arm stays quiet"

# ---------------------------------------------------------------------------
# Station 12 - release close steps 3 and 4, the two blocking findings. rc 0 is
# CLEAN here and rc 0 is a HIT in `oss touch_check` - opposite polarity on
# purpose. The fake's expiry release IS the closing release, so it blocks.
# ---------------------------------------------------------------------------
t_capture "$OSS" expired_fakes r0
t_assert_rc 1 "station 12: the expiry gate BLOCKS - rc 1, not clean"
t_assert_eq "$(printf 'broker-api\tactive\tr0\tsandbox creds arrive')" "$T_OUT" \
  "station 12: the exact TSV row - boundary, status, expiry, replacement trigger"
t_capture "$OSS" expired_quarantines r0
t_assert_rc 0 "station 12: the quarantine gate is clean - nothing was quarantined"
t_assert_eq "" "$T_OUT" "station 12: ...and says so with empty output"

# Resolve it. `replaced` is the ONLY resolving status; `renewed` still selects.
t_capture "$OSS" fake_status broker-api replaced "real sandbox creds landed"
t_assert_rc 0 "station 12: the fake is replaced"
t_capture "$OSS" get '.fakes[] | select(.boundary=="broker-api") | .status'
t_assert_eq "replaced" "$T_OUT" "station 12: the resolving status is on the record"
t_capture "$OSS" expired_fakes r0
t_assert_rc 0 "station 12: the gate is now CLEAN"
t_assert_eq "" "$T_OUT" "station 12: ...with an empty blocking set"

# ---------------------------------------------------------------------------
# Station 13 - release close step 2's walkthrough, then step 7's state writes.
# The user walk takes NO argument here: every accumulated active user line.
# ---------------------------------------------------------------------------
t_capture "$OSS" demo_run
t_assert_rc 0 "station 13: the full cumulative auto demo passes"
t_assert_contains "$T_OUT" "PASS 2 lines" "station 13: every active auto line in the release"
ALL_USER="$("$OSS" demo_user_lines | jq 'length')"
t_assert_eq "1" "$ALL_USER" "station 13: the release walk takes NO spine argument"

t_capture "$OSS" release_status r0 closed
t_assert_rc 0 "station 13: r0 closed"
t_capture "$OSS" demo_record release r0 true 2 "release close - full walkthrough green"
t_assert_rc 0 "station 13: release close recorded"
t_capture "$OSS" get '.releases[] | select(.id=="r0") | .status'
t_assert_eq "closed" "$T_OUT" "station 13: the release status is on the record"

# ---------------------------------------------------------------------------
# Station 14 - the tail. Close records by SCOPE, the journaled op set, and a
# clean replay over the whole arc.
# ---------------------------------------------------------------------------
t_capture "$OSS" get '.close_records | length'
t_assert_eq "3" "$T_OUT" "station 14: three close records - two spines and one release"
t_capture "$OSS" get '[.close_records[] | select(.scope=="work_item")] | length'
t_assert_eq "0" "$T_OUT" "station 14: the work-item close layer wrote NONE"
t_capture "$OSS" get '[.close_records[] | select(.scope=="spine")] | length'
t_assert_eq "2" "$T_OUT" "station 14: one per SPINE close"
t_capture "$OSS" get '[.close_records[] | select(.scope=="release")] | length'
t_assert_eq "1" "$T_OUT" "station 14: one per RELEASE close"
t_capture "$OSS" get '[.close_records[] | select(.scope=="spine") | .id] | join(",")'
t_assert_eq "r0.s1,r0.s2" "$T_OUT" "station 14: and they name both spines, in close order"

# The scoped replay guard. Asserting the DISTINCT op set exactly (not a
# subset, not a count) is what keeps this file's header honest: drop a station
# and the arc stops journaling an op it claims to guard, and this line reds.
t_capture "$OSS" get '[.mutations[].op] | unique | join(",")'
t_assert_eq "add_close_record,add_demo_line,add_fake,add_release,add_spine,add_work_item,apply_demo_pending,set_demo_line_pending,set_fake_status,set_release_status,set_spine_status,set_work_item_exec,set_work_item_status" \
  "$T_OUT" "station 14: the arc journals exactly the 13 ops this file's header claims"

t_capture "$OSS" doctor
t_assert_contains "$T_OUT" "ok: schema" "station 14: doctor schema ok"
t_assert_contains "$T_OUT" "ok: shape" "station 14: doctor shape ok"
t_assert_contains "$T_OUT" "ok: replay" "station 14: doctor replay ok over the whole close arc"
t_capture oss_state_replay "$OSS_STATE_FILE"
t_assert_rc 0 "station 14: base + journal rebuilds the closed state exactly"
t_assert_contains "$T_OUT" "replay: clean" "station 14: ...and says so"

unset OSS_STATE_FILE
cd /
rm -rf "$TMP"

t_summary
