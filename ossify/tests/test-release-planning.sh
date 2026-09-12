#!/usr/bin/env bash
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
for lib in id state manifest commands entities registries ledger doctor; do . "$HERE/../lib/$lib.sh"; done
TMP="$(mktemp -d)"; export OSS_STATE_FILE="$TMP/state.json"
# #272/#310 Task 4: an omitted target_repo now routes through
# _oss_default_repo_key, which needs a discoverable manifest even when
# OSS_STATE_FILE pins the state path directly - the old default was a literal
# `canonical`, never a lookup. well_known_paths.project_state is pinned to the
# SAME path as OSS_STATE_FILE so _oss_resolve_state's override-notice never
# fires and stays out of captured stdout below.
mkdir -p "$TMP/.ossify"
cat > "$TMP/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"canonical":{"root":"$TMP/canon"}},"well_known_paths":{"project_state":"$OSS_STATE_FILE"}}
JSON
cd "$TMP"
oss_cmd_init "release-planning-demo" >/dev/null
oss_cmd_release_add "MVP" "usable end to end" >/dev/null
oss_cmd_spine_add r0 "trade entry" bone >/dev/null
t_capture oss_cmd_get '.releases[0].created_at'; RELEASE_CREATED_AT="$T_OUT"

# work item carries target_repo (default canonical + explicit override).
t_capture oss_cmd_work_item_add r0.s1 "wire the entry point"
t_assert_eq "r0.s1.w1" "$T_OUT" "work item minted"
t_capture oss_cmd_get '.work_items[0].target_repo'
t_assert_eq "canonical" "$T_OUT" "default target_repo is canonical"
# The default-key assertions above need EXACTLY ONE declared repo; this one
# needs a second, or "explicit" is indistinguishable from "default". Widening
# the fixture up front satisfies this and disarms those, and leaving it widened
# makes every LATER omitted-key call in this file refuse - so the second repo is
# declared here and withdrawn immediately after.
cat > "$TMP/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"canonical":{"root":"$TMP/canon"},"private_core":{"root":"$TMP/priv"}},"well_known_paths":{"project_state":"$OSS_STATE_FILE"}}
JSON
t_capture oss_cmd_work_item_add r0.s1 "private adapter" private_core
t_capture oss_cmd_get '.work_items[1].target_repo'
t_assert_eq "private_core" "$T_OUT" "explicit target_repo stored"
cat > "$TMP/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"canonical":{"root":"$TMP/canon"}},"well_known_paths":{"project_state":"$OSS_STATE_FILE"}}
JSON

# release meta: exit criteria + DAG + budget + next sketch + real-use findings.
t_capture oss_cmd_release_set_meta r0 \
  '{"exit_criteria":["at close, a user can place a paper trade"],"spine_dag":[["r0.s1",[]]],"ledger_budget":"90s","next_sketch":"r1: live execution","real_use_findings":["backtest UI was unreachable"]}'
t_assert_rc 0 "release meta set"
t_capture oss_cmd_get '.releases[0].exit_criteria[0]'
t_assert_eq "at close, a user can place a paper trade" "$T_OUT" "exit criteria stored"
t_capture oss_cmd_get '.releases[0].real_use_findings[0]'
t_assert_eq "backtest UI was unreachable" "$T_OUT" "real-use findings stored"

# pre-existing fields survive the merge (regression guard for review Fix 1's
# Minor: if the merge expression is ever rewritten destructively, this catches
# it - id/name/goal/status/created_at must be untouched by an allowed-only patch).
t_capture oss_cmd_get '.releases[0].id';         t_assert_eq "r0" "$T_OUT" "release id survives merge"
t_capture oss_cmd_get '.releases[0].name';       t_assert_eq "MVP" "$T_OUT" "release name survives merge"
t_capture oss_cmd_get '.releases[0].goal';       t_assert_eq "usable end to end" "$T_OUT" "release goal survives merge"
t_capture oss_cmd_get '.releases[0].status';     t_assert_eq "planned" "$T_OUT" "release status survives merge"
t_capture oss_cmd_get '.releases[0].created_at'; t_assert_eq "$RELEASE_CREATED_AT" "$T_OUT" "release created_at survives merge"

# allowlist: a patch carrying both allowed and disallowed keys lands the
# allowed field but the disallowed keys (id, status) are silently dropped -
# NOT spliced onto the record. This is a server-side jq restriction (holds
# for every caller AND for replay), not an entity-layer check a caller could
# bypass via oss_state_mutate directly.
t_capture oss_cmd_release_set_meta r0 '{"exit_criteria":["allowlist check"],"id":"tampered","status":"shipped"}'
t_assert_rc 0 "release meta with disallowed keys still succeeds (dropped, not rejected)"
t_capture oss_cmd_get '.releases[0].exit_criteria[0]'
t_assert_eq "allowlist check" "$T_OUT" "allowed field (exit_criteria) still lands"
t_capture oss_cmd_get '.releases[0].id'
t_assert_eq "r0" "$T_OUT" "disallowed key 'id' does not overwrite release id"
t_capture oss_cmd_get '.releases[0].status'
t_assert_eq "planned" "$T_OUT" "disallowed key 'status' does not overwrite release status"

# release meta against an unknown release is rc 7 and does not mutate (matches
# the "worth verifying" note: oss_entity_set_release_meta rc-7's, no phantom write).
t_capture oss_cmd_get '.releases | length'; RELEASES_BEFORE="$T_OUT"
t_capture oss_cmd_release_set_meta r9 '{"exit_criteria":["ghost"]}'
t_assert_rc 7 "release meta on unknown release rejected"
t_capture oss_cmd_get '.releases | length'
t_assert_eq "$RELEASES_BEFORE" "$T_OUT" "release count unchanged after unknown-release rejection"

# veto disposition: escalate is recorded (fail-closed trail), disposition validated.
t_capture oss_cmd_veto_add r0.s1 "flesh claim touches src/port.rs" auto-bone "bone-touch check hit"
t_assert_rc 0 "auto-bone veto recorded"
t_capture oss_cmd_veto_add r0.s1 "critic finding ambiguous" escalate "ambiguous - fail-closed to escalate"
t_assert_rc 0 "escalate veto recorded"
t_capture oss_cmd_get '[.veto_dispositions[].disposition] | join(",")'
t_assert_eq "auto-bone,escalate" "$T_OUT" "both dispositions recorded in order"

# invalid disposition is rejected BEFORE mutating - no phantom record, no
# phantom journal entry (mirrors test-entities.sh's SPINES_BEFORE pattern).
t_capture oss_cmd_get '.veto_dispositions | length'; VETOS_BEFORE="$T_OUT"
t_capture oss_cmd_veto_add r0.s1 "bad" nonsense "x"
t_assert_rc 2 "invalid disposition rejected"
t_capture oss_cmd_get '.veto_dispositions | length'
t_assert_eq "$VETOS_BEFORE" "$T_OUT" "veto_dispositions count unchanged after invalid-disposition rejection"

# veto against an unknown spine is rc 7 and does not mutate (review Fix 2:
# oss_entity_add_veto must reject a phantom spine ref BEFORE mutating, same
# reject-before-mutate shape as the invalid-disposition assertion above -
# a typo'd spine id must never silently corrupt the fail-closed audit trail).
t_capture oss_cmd_get '.veto_dispositions | length'; VETOS_BEFORE2="$T_OUT"
t_capture oss_cmd_veto_add r9.s9 "ghost finding" auto-bone "reason"
t_assert_rc 7 "veto against unknown spine rejected"
t_capture oss_cmd_get '.veto_dispositions | length'
t_assert_eq "$VETOS_BEFORE2" "$T_OUT" "veto_dispositions count unchanged after unknown-spine rejection"

# doctor shape stays green (all 16 required keys present — the list grew from 14
# when Plan C1 Task 1 added close_records and closed doctor's pre-existing
# omission of veto_dispositions); replay stays clean.
t_capture oss_cmd_doctor "$OSS_STATE_FILE"
t_assert_contains "$T_OUT" "ok: shape" "doctor shape green"
t_capture oss_state_replay "$OSS_STATE_FILE"
t_assert_rc 0 "replay clean after release-planning ops"

cd "$HERE"
unset OSS_STATE_FILE
rm -rf "$TMP"

# --- Tolerance: add_veto_disposition must work on a state that PREDATES the
# veto_dispositions key (jq's `null + [$p]` yields `[$p]`) - the field is
# additive/ungated (doctor's 14-key shape loop does not include it), so a
# valid pre-existing v1 state must never hard-fail here.
TMP2="$(mktemp -d)"; S2="$TMP2/state.json"
oss_state_init "$S2" pre-veto-demo >/dev/null
jq 'del(.veto_dispositions)' "$S2" > "$S2.x" && mv "$S2.x" "$S2"
oss_entity_add_release "$S2" "MVP" "goal" >/dev/null
oss_entity_add_spine "$S2" r0 "spine" bone canonical >/dev/null
t_capture oss_entity_add_veto "$S2" r0.s1 "finding" override "reason"
t_assert_rc 0 "veto recorded on a state missing the veto_dispositions key"
t_capture oss_state_read "$S2" '.veto_dispositions | length'
t_assert_eq "1" "$T_OUT" "veto_dispositions array created fresh from null"
rm -rf "$TMP2"

# --- Dispatcher-path regression (standing instruction): drive the three new
# subcommands through the REAL bin/oss binary (set -euo pipefail), including
# the rc-2 invalid-disposition path and one rc-7 unknown-ref path. Mirrors the
# block Task 3 added to test-dispatcher-ops.sh - a sourced-only test never
# exercises the dispatcher's strict mode or its arg-passthrough.
OSS="$HERE/../bin/oss"
DTMP="$(mktemp -d)"; export OSS_STATE_FILE="$DTMP/state.json"
mkdir -p "$DTMP/.ossify"
cat > "$DTMP/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"canonical":{"root":"$DTMP/canon"}},"well_known_paths":{"project_state":"$OSS_STATE_FILE"}}
JSON
cd "$DTMP"

t_capture "$OSS" init release-planning-dispatcher-demo
t_assert_rc 0 "dispatcher: init ok"
t_capture "$OSS" release_add "MVP" "usable end to end"
t_assert_eq "r0" "$T_OUT" "dispatcher: release_add mints r0"
t_capture "$OSS" spine_add r0 "trade entry" bone
t_assert_eq "r0.s1" "$T_OUT" "dispatcher: spine_add mints r0.s1"

t_capture "$OSS" work_item_add r0.s1 "wire the entry point"
t_assert_eq "r0.s1.w1" "$T_OUT" "dispatcher: work_item_add mints r0.s1.w1 through the real binary"
t_capture "$OSS" get '.work_items[0].target_repo'
t_assert_eq "canonical" "$T_OUT" "dispatcher: work_item_add defaults target_repo to canonical"

t_capture "$OSS" release_set_meta r0 '{"exit_criteria":["a user can place a paper trade"]}'
t_assert_rc 0 "dispatcher: release_set_meta ok through the real binary"
t_capture "$OSS" get '.releases[0].exit_criteria[0]'
t_assert_eq "a user can place a paper trade" "$T_OUT" "dispatcher: release_set_meta patch stored"

t_capture "$OSS" veto_add r0.s1 "bone-touch hit" auto-bone "reason"
t_assert_rc 0 "dispatcher: veto_add ok through the real binary"
t_capture "$OSS" get '.veto_dispositions[0].disposition'
t_assert_eq "auto-bone" "$T_OUT" "dispatcher: veto_add disposition stored"

# rc-2 invalid-disposition path through the real binary.
t_capture "$OSS" veto_add r0.s1 "bad" nonsense "x"
t_assert_rc 2 "dispatcher: veto_add invalid disposition is rc 2 through the real binary"

# rc-7 unknown-ref path through the real binary.
t_capture "$OSS" release_set_meta r9 '{"exit_criteria":["ghost"]}'
t_assert_rc 7 "dispatcher: release_set_meta on unknown release is rc 7 through the real binary"

cd "$HERE"
unset OSS_STATE_FILE
rm -rf "$DTMP"
t_summary
