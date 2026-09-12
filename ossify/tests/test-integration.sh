#!/usr/bin/env bash
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/harness.sh"
# manifest+verify+worktree added for Task 6: oss_demo_run_auto (called below,
# workdir arg omitted) now resolves its working directory via
# _oss_repo_root (worktree.sh -> manifest.sh) and checks vacuous-green via
# oss_verify_zero_tests_guard (verify.sh).
. "$HERE/../lib/id.sh"; . "$HERE/../lib/state.sh"; . "$HERE/../lib/manifest.sh"; . "$HERE/../lib/entities.sh"
. "$HERE/../lib/registries.sh"; . "$HERE/../lib/ledger.sh"; . "$HERE/../lib/verify.sh"; . "$HERE/../lib/worktree.sh"
. "$HERE/../lib/demo.sh"; . "$HERE/../lib/doctor.sh"
OSS="$HERE/../bin/oss"
TMP="$(mktemp -d)"; S="$TMP/.ossify/project-state.json"

# Task 6: oss_demo_run_auto (line below, workdir arg omitted) now requires a
# manifest on the walk-up path - a BEHAVIORAL CHANGE from "runs in the
# caller's cwd". ai_workspace.root is $TMP itself so the manifest is
# discoverable once we `cd "$TMP"` (oss_manifest_discover walks UP from
# $PWD, never down); $TMP/canon is the resolved canonical root and must
# exist before the first demo_run_auto call.
mkdir -p "$TMP/.workspace" "$TMP/canon"
cat > "$TMP/.workspace/pairing.json" <<EOF
{"schema_version":"1.0","ai_workspace":{"root":"$TMP"},"canonical":{"root":"$TMP/canon"},"well_known_paths":{}}
EOF
cd "$TMP"

# Fixture: a skeleton-first project from init to a passing cumulative demo.
oss_state_init "$S" fixture >/dev/null
R="$(oss_entity_add_release "$S" "Skeleton" "core loop usable")"
SP="$(oss_entity_add_spine "$S" "$R" "walking skeleton" bone canonical)"
oss_entity_add_work_item "$S" "$SP" "wire the entry point" >/dev/null
oss_reg_add_bone "$S" ADR-0002 "domain boundary" "src/domain/**" "" >/dev/null
oss_reg_add_fake "$S" coach fake "shell for skeleton" "first refinement" r1 >/dev/null
oss_ledger_add_auto "$S" "$SP" "golden journey" "echo journey-ok" "contains:journey-ok" >/dev/null
oss_ledger_add_user "$S" "$SP" "Run a backtest from the chat panel" "results visible" >/dev/null

t_capture oss_demo_run_auto "$S";  t_assert_rc 0 "fixture demo green"
t_capture "$OSS" doctor "$S";      t_assert_rc 0 "doctor green on full fixture"
t_capture oss_state_replay "$S";   t_assert_rc 0 "full fixture replays clean"
t_capture oss_reg_touch_check "$S" src/domain/x.rs; t_assert_rc 0 "touch check hits bone"

cd /
rm -rf "$TMP"

# ===========================================================================
# TOPOLOGY TWIN (#272/#310 Task 11, spec decision O1): the IDENTICAL
# skeleton-first fixture above, run again from a .ossify/topology.json
# declaring a SOLE repo named "core" - never "canonical" - to prove the
# whole lifecycle (demo, doctor, replay, touch_check) is source-agnostic as
# a WHOLE ARC, not merely resolver-by-resolver in isolation.
# ===========================================================================
TMPX="$(mktemp -d)"; SX="$TMPX/.ossify/project-state.json"
mkdir -p "$TMPX/.ossify" "$TMPX/core"
cat > "$TMPX/.ossify/topology.json" <<JSON
{"schema_version":1,"repos":{"core":{"root":"$TMPX/core"}},"well_known_paths":{}}
JSON
cd "$TMPX"

oss_state_init "$SX" fixture >/dev/null
RX="$(oss_entity_add_release "$SX" "Skeleton" "core loop usable")"
SPX="$(oss_entity_add_spine "$SX" "$RX" "walking skeleton" bone core)"
oss_entity_add_work_item "$SX" "$SPX" "wire the entry point" >/dev/null
oss_reg_add_bone "$SX" ADR-0002 "domain boundary" "src/domain/**" "" >/dev/null
oss_reg_add_fake "$SX" coach fake "shell for skeleton" "first refinement" r1 >/dev/null
oss_ledger_add_auto "$SX" "$SPX" "golden journey" "echo journey-ok" "contains:journey-ok" >/dev/null
oss_ledger_add_user "$SX" "$SPX" "Run a backtest from the chat panel" "results visible" >/dev/null

t_capture oss_demo_run_auto "$SX";  t_assert_rc 0 "topology twin: fixture demo green"
t_capture "$OSS" doctor "$SX";      t_assert_rc 0 "topology twin: doctor green on full fixture"
t_capture oss_state_replay "$SX";   t_assert_rc 0 "topology twin: full fixture replays clean"
t_capture oss_reg_touch_check "$SX" src/domain/x.rs; t_assert_rc 0 "topology twin: touch check hits bone"

cd /
rm -rf "$TMPX"
t_summary
