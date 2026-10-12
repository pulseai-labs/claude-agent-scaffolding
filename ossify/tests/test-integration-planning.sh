#!/usr/bin/env bash
# End-to-end onboarding -> release-planning -> spine-planning integration test
# (Plan B task 9). Replay guard for the happy-path onboarding -> release ->
# spine narrative: every op that chain mints is exercised here, in the order a
# real project would hit them, with a clean replay at the end.
#
# NOT every op in `_oss_apply_op`. Deliberately out of this narrative, covered
# elsewhere: `set_composition` (test-dispatcher-ops.sh), `add_fake` and
# `set_demo_line_status` (test-spine-planning.sh, test-ledger.sh,
# test-demo-runner.sh). Do not read this file as the whole-suite op guard.
#
# Prose anchors: spec L§4 (spec-core onboarding: journey map, skeleton-cut,
# bones, risk gates), L§5.2 (release planning: feature groom, exit-criteria,
# DAG, class + fail-closed critic veto), L§5.3 (spine planning: work items,
# demo ledger under the journey-line floor), L§9.1 (entry-skill tree),
# L§9.2 (state safety: mint-inside-lock, manifest/state-path resolution).
#
# This test closes two gaps left open by the task-9 brief as drafted:
#
#   [GAP 1] The brief's script is sourced-only (`oss_cmd_*` called directly);
#   it never drives the dispatcher. `bin/oss` runs `set -euo pipefail` and
#   sourcing does not - this exact gap forced a fix round on BOTH B1 and B3
#   (a verification that only exercises sourced functions cannot catch a
#   strict-mode abort, arg-passthrough bug, or rc-collapse on the path users
#   actually take). Section A below keeps the sourced coverage (cheap, and it
#   still catches lib-level regressions); Section B re-runs the identical
#   chain through the REAL `bin/oss` binary, matching B8's
#   test-spine-planning.sh pattern.
#
#   [GAP 2] The brief passes an explicit state path to every `doctor` /
#   `demo_run` call, which silently skips the thing B9 was assigned to prove.
#   Both take the state-file arg as OPTIONAL and fall back to
#   `_oss_resolve_state` (precedence: explicit-arg > $OSS_STATE_FILE >
#   manifest). B2's review left a standing Minor: no end-to-end test drives
#   `oss doctor` / `oss demo_run` with the arg OMITTED (the actual
#   default-resolution deliverable), and the ledger assigns closing it to
#   this task. Every `doctor`/`demo_run` call below - in BOTH sections - omits
#   the state-file argument; `OSS_STATE_FILE` stays exported throughout each
#   section, so omitting the arg exercises the env-var branch of the
#   resolver (the middle precedence tier - the one a test tmpdir can reach
#   without a real workspace-init manifest on disk).
#
# NOTE: coverage for new/changed ops is NOT appended to test-state-replay.sh -
# that file deliberately tampers the live state and deletes the base snapshot
# before its tail; an appended replay-clean assertion would return rc 5 then
# rc 1 and red the suite (the CRITICAL finding from the plan's own adversarial
# self-review). All replay coverage here lives in this new file instead.
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
# verify+worktree added for Task 6: oss_cmd_demo_run / "$OSS" demo_run below
# (state-file arg omitted, per [GAP 2]) now resolves its working directory
# via _oss_repo_root (worktree.sh, itself dependent on manifest.sh - already
# in this list) and checks vacuous-green via oss_verify_zero_tests_guard
# (verify.sh).
for lib in id state manifest commands entities registries ledger demo doctor verify worktree; do . "$HERE/../lib/$lib.sh"; done
OSS="$HERE/../bin/oss"

# ============================================================================
# Section A - sourced-function coverage (drives oss_cmd_* directly)
# ============================================================================
TMP="$(mktemp -d)"; export OSS_STATE_FILE="$TMP/state.json"
# Task 6: oss_cmd_demo_run (state-file arg omitted, line below) now requires a
# manifest on the walk-up path for its WORKDIR resolution - a BEHAVIORAL
# CHANGE, orthogonal to the $OSS_STATE_FILE precedence this section exists to
# prove (that resolver is unaffected; only the demo runner's workdir now goes
# through the manifest). ai_workspace.root is $TMP itself so the manifest is
# discoverable once we `cd "$TMP"`; $TMP/canon is the resolved canonical root
# and must exist before the first demo_run call. well_known_paths.project_state
# is pointed at the SAME path as $OSS_STATE_FILE (not the ".ossify/..."
# convention default): _oss_resolve_state's env branch still wins per
# precedence either way, but a DIFFERING manifest-routed path makes it print an
# "overriding the manifest-routed ..." notice on stderr, which t_capture's
# `2>&1` folds into every T_OUT below and breaks the exact-value assertions
# ([GAP 2] deliberately has no manifest on disk for exactly this reason - this
# task adds one only for the demo runner's WORKDIR leg, so it must agree with
# $OSS_STATE_FILE on the state leg to stay silent, same as when no manifest
# existed at all).
mkdir -p "$TMP/.workspace" "$TMP/canon"
cat > "$TMP/.workspace/pairing.json" <<EOF
{"schema_version":"1.0","ai_workspace":{"root":"$TMP"},"canonical":{"root":"$TMP/canon"},"well_known_paths":{"project_state":"\${ai_workspace.root}/state.json"}}
EOF
cd "$TMP"

# --- start-shaped writes (L§4 spec-core onboarding + B§ posture block) ---
oss_cmd_init "e2e" >/dev/null
oss_cmd_posture_set "fully-private" >/dev/null
oss_cmd_overlay_set '$PULSE_PROMPT_DIR' >/dev/null
oss_cmd_bone_add "ADR-0002" "hexagonal core" "src/domain/**,src/port.rs" "revisit at MVP" >/dev/null
oss_cmd_risk_gate_add "live-exec" "src/exec/**" "paper-env,human-confirm,kill-switch,audit-trail" >/dev/null
oss_cmd_feature_add "paper trade" "place a paper trade" "flesh" "journey-map" >/dev/null

# --- plan-release-shaped writes (L§5.2) ---
REL="$(oss_cmd_release_add "Skeleton" "core loop usable")"
t_assert_eq "r0" "$REL" "sourced: release r0"
SP="$(oss_cmd_spine_add r0 "trade entry" bone)"
t_assert_eq "r0.s1" "$SP" "sourced: spine r0.s1"
oss_cmd_release_set_meta r0 '{"exit_criteria":["at close a user can place a paper trade"],"spine_dag":[["r0.s1",[]]],"real_use_findings":["n/a for release 0"]}' >/dev/null
# bone-touch judge: a plan path hits the bone surface -> auto-bone veto recorded
t_capture oss_cmd_touch_check "src/domain/order.rs"
t_assert_rc 0 "sourced: touch check hits bone"
oss_cmd_veto_add r0.s1 "src/domain/order.rs" auto-bone "bone-touch" >/dev/null

# --- plan-spine-shaped writes (L§5.3) ---
oss_cmd_work_item_add r0.s1 "wire the entry point" canonical >/dev/null
DA="$(oss_cmd_ledger_add_auto r0.s1 "core loop runs" "bash -c 'exit 0'" "exit:0" active)"
t_assert_eq "d1" "$DA" "sourced: auto demo line d1"
DU="$(oss_cmd_ledger_add_user r0.s1 "place a paper trade and see it in open positions" "position appears" active)"
t_assert_eq "d2" "$DU" "sourced: user journey line d2"
# inspector phrasing rejected at authoring time
t_capture oss_cmd_ledger_add_user r0.s1 "inspect the schema" "schema seen"
t_assert_rc 2 "sourced: inspector phrasing rejected"

# --- demo runner over the accumulated auto lines - [GAP 2] arg OMITTED ---
t_capture oss_cmd_demo_run
t_assert_rc 0 "sourced: cumulative auto-demo passes (state-file arg omitted -> \$OSS_STATE_FILE)"
# rc alone is under-discriminating: oss_demo_run_auto prints "PASS 0 lines" and
# returns 0 for ANY readable state with no active auto lines. Tie the assertion
# to THIS test's own accumulated content (exactly one active auto line, d1) so a
# resolver that lands on some other valid-but-empty state cannot pass silently.
t_assert_contains "$T_OUT" "PASS 1 lines" "sourced: demo_run resolved THIS state's ledger, not merely some state"

# --- doctor green + replay clean over the whole chain - [GAP 2] arg OMITTED ---
t_capture oss_cmd_doctor
t_assert_contains "$T_OUT" "ok: schema" "sourced: doctor schema ok (state-file arg omitted)"
t_assert_contains "$T_OUT" "ok: shape" "sourced: doctor shape ok (state-file arg omitted)"
t_assert_contains "$T_OUT" "ok: replay" "sourced: doctor replay ok (state-file arg omitted)"
# oss_state_replay has no dispatcher wrapper and no optional-arg resolver of
# its own (doctor calls it internally) - it always takes the state path
# explicitly, so this call is unaffected by the omitted-arg gap.
t_capture oss_state_replay "$OSS_STATE_FILE"
t_assert_rc 0 "sourced: full-chain replay clean"

unset OSS_STATE_FILE
cd /
rm -rf "$TMP"

# ============================================================================
# Section B - dispatcher-path coverage (drives the REAL bin/oss binary)
# ============================================================================
# Same chain, same order, through the actual dispatcher (`set -euo pipefail`)
# instead of sourced functions - this is the path start/plan-release/plan-spine
# actually shell out to. [GAP 1] closed here.
TMP2="$(mktemp -d)"; export OSS_STATE_FILE="$TMP2/state.json"
# Same Task 6 manifest fixture as Section A, rooted at TMP2 - "$OSS" demo_run
# (state-file arg omitted, [GAP 2]) resolves its workdir through the manifest
# exactly like the sourced path does, and must find one on ITS OWN walk-up.
# well_known_paths.project_state matches $OSS_STATE_FILE for the same reason
# as Section A - see the comment there.
mkdir -p "$TMP2/.workspace" "$TMP2/canon"
cat > "$TMP2/.workspace/pairing.json" <<EOF
{"schema_version":"1.0","ai_workspace":{"root":"$TMP2"},"canonical":{"root":"$TMP2/canon"},"well_known_paths":{"project_state":"\${ai_workspace.root}/state.json"}}
EOF
cd "$TMP2"

# --- start-shaped writes ---
"$OSS" init "e2e-dispatcher" >/dev/null
"$OSS" posture_set "fully-private" >/dev/null
"$OSS" overlay_set '$PULSE_PROMPT_DIR' >/dev/null
"$OSS" bone_add "ADR-0002" "hexagonal core" "src/domain/**,src/port.rs" "revisit at MVP" >/dev/null
"$OSS" risk_gate_add "live-exec" "src/exec/**" "paper-env,human-confirm,kill-switch,audit-trail" >/dev/null
"$OSS" feature_add "paper trade" "place a paper trade" "flesh" "journey-map" >/dev/null

# --- plan-release-shaped writes ---
t_capture "$OSS" release_add "Skeleton" "core loop usable"
t_assert_eq "r0" "$T_OUT" "dispatcher: release r0"
t_capture "$OSS" spine_add r0 "trade entry" bone
t_assert_eq "r0.s1" "$T_OUT" "dispatcher: spine r0.s1"
t_capture "$OSS" release_set_meta r0 '{"exit_criteria":["at close a user can place a paper trade"],"spine_dag":[["r0.s1",[]]],"real_use_findings":["n/a for release 0"]}'
t_assert_rc 0 "dispatcher: release meta set"
# bone-touch judge, through the real binary: rc 0 == matched, and it names
# the matched bone on stdout (test-spine-planning.sh's stronger pattern).
t_capture "$OSS" touch_check src/domain/order.rs
t_assert_rc 0 "dispatcher: touch check hits bone"
t_assert_contains "$T_OUT" "bone ADR-0002" "dispatcher: touch check names the matched bone"
t_capture "$OSS" veto_add r0.s1 "src/domain/order.rs" auto-bone "bone-touch"
t_assert_rc 0 "dispatcher: auto-bone veto recorded"

# --- plan-spine-shaped writes ---
t_capture "$OSS" work_item_add r0.s1 "wire the entry point" canonical
t_assert_eq "r0.s1.w1" "$T_OUT" "dispatcher: work item minted"
t_capture "$OSS" ledger_add_auto r0.s1 "core loop runs" "bash -c 'exit 0'" "exit:0" active
t_assert_eq "d1" "$T_OUT" "dispatcher: auto demo line d1"
t_capture "$OSS" ledger_add_user r0.s1 "place a paper trade and see it in open positions" "position appears" active
t_assert_eq "d2" "$T_OUT" "dispatcher: user journey line d2"

# inspector phrasing rejected at authoring time - AND writes nothing (fail-
# closed through strict-mode dispatcher, not just a sourced function).
t_capture "$OSS" get '.demo_ledger | length'; LEDGER_BEFORE="$T_OUT"
t_capture "$OSS" ledger_add_user r0.s1 "inspect the schema" "schema seen"
t_assert_rc 2 "dispatcher: inspector phrasing rejected"
t_capture "$OSS" get '.demo_ledger | length'
t_assert_eq "$LEDGER_BEFORE" "$T_OUT" "dispatcher: no phantom demo line after rejected inspector phrasing"

# --- demo runner over the accumulated auto lines - [GAP 2] arg OMITTED ---
t_capture "$OSS" demo_run
t_assert_rc 0 "dispatcher: cumulative auto-demo passes (state-file arg omitted -> \$OSS_STATE_FILE)"
t_assert_contains "$T_OUT" "PASS 1 lines" "dispatcher: demo_run resolved THIS state's ledger, not merely some state"

# --- doctor green + replay clean over the whole chain - [GAP 2] arg OMITTED ---
t_capture "$OSS" doctor
t_assert_contains "$T_OUT" "ok: schema" "dispatcher: doctor schema ok (state-file arg omitted)"
t_assert_contains "$T_OUT" "ok: shape" "dispatcher: doctor shape ok (state-file arg omitted)"
t_assert_contains "$T_OUT" "ok: replay" "dispatcher: doctor replay ok (state-file arg omitted)"
t_capture oss_state_replay "$OSS_STATE_FILE"
t_assert_rc 0 "dispatcher: full-chain replay clean"

unset OSS_STATE_FILE
cd /
rm -rf "$TMP2"

t_summary
