#!/usr/bin/env bash
# tests/test-e2e-tamper-detection.sh — Adversarial: T1-F tamper detection.
# Tests TAMPER-001 (state.json mtime drift), TAMPER-002 (suppressions.json mtime drift),
# TAMPER-003 (git-tracked status drift).
# Phase 7 Task 7.2.

set -u
source "$(dirname "$0")/_helpers.sh"
source "$CSA_LIB_DIR/helpers.sh"
source "$CSA_LIB_DIR/state.sh"
source "$CSA_LIB_DIR/suppress.sh"

_CSA_TMP="$(mktemp -d "${TMPDIR:-/tmp}/csa-tamper.XXXXXX")"
trap 'rm -rf "$_CSA_TMP"' EXIT

_csa_failed=0
_test_n=0

_next_scratch() {
  _test_n=$((_test_n + 1))
  mkdir -p "$_CSA_TMP/t$_test_n"
}

# ---------------------------------------------------------------------------
# test_tamper_001_state_json_mtime_drift
# T1-F: init state, update_self_integrity, manually touch state.json to change
# its mtime, call check_tamper, assert TAMPER-001 in output.
# ---------------------------------------------------------------------------
test_tamper_001_state_json_mtime_drift() {
  _next_scratch; local scratch="$_CSA_TMP/t$_test_n"
  local project="$scratch/project"
  mkdir -p "$project/.claude/audits"
  export CSA_PROJECT_ROOT="$project"

  csa_state_init "$project"
  csa_state_update_self_integrity "$project"

  # Wait a moment so touch produces a different mtime.
  sleep 1

  # Change state.json mtime to a timestamp in the past (not matching recorded mtime).
  local state_file; state_file="$(csa_state_path "$project")"
  touch -t 200001010000 "$state_file"

  local out; out="$(csa_state_check_tamper "$project" 2>/dev/null)"
  assert_contains "$out" "TAMPER-001" "should detect TAMPER-001 on state.json mtime drift" || return 1
}

# ---------------------------------------------------------------------------
# test_tamper_002_suppressions_json_mtime_drift
# T1-F: init state + suppressions, update_self_integrity, change suppressions.json mtime,
# call check_tamper, assert TAMPER-002 in output.
# ---------------------------------------------------------------------------
test_tamper_002_suppressions_json_mtime_drift() {
  _next_scratch; local scratch="$_CSA_TMP/t$_test_n"
  local project="$scratch/project"
  mkdir -p "$project/.claude/audits"
  export CSA_PROJECT_ROOT="$project"

  csa_state_init "$project"
  csa_suppress_init "$project"
  csa_state_update_self_integrity "$project"

  sleep 1

  # Change suppressions.json mtime.
  local sup_file; sup_file="$(csa_suppressions_path "$project")"
  touch -t 200001010000 "$sup_file"

  local out; out="$(csa_state_check_tamper "$project" 2>/dev/null)"
  assert_contains "$out" "TAMPER-002" "should detect TAMPER-002 on suppressions.json mtime drift" || return 1
}

# ---------------------------------------------------------------------------
# test_tamper_003_git_tracked_status_drift
# T1-F: record state as git-tracked=true in self_integrity, then change the recorded
# value so it disagrees with current git status → TAMPER-003.
# If git is unavailable, skip gracefully (DONE_WITH_CONCERNS noted in comments).
# ---------------------------------------------------------------------------
test_tamper_003_git_tracked_status_drift() {
  # Skip if git is unavailable.
  if ! command -v git >/dev/null 2>&1; then
    printf '    SKIP: git not available\n' >&2
    return 0
  fi

  _next_scratch; local scratch="$_CSA_TMP/t$_test_n"
  local project="$scratch/project"
  mkdir -p "$project/.claude/audits"
  export CSA_PROJECT_ROOT="$project"

  csa_state_init "$project"
  csa_state_update_self_integrity "$project"

  # Determine the CURRENT actual tracked status of state.json.
  local state_file; state_file="$(csa_state_path "$project")"
  local actual_tracked=false
  if git -C "$project" ls-files --error-unmatch "$state_file" >/dev/null 2>&1; then
    actual_tracked=true
  fi

  # Flip the recorded tracked value to the OPPOSITE of reality.
  local flipped_tracked
  if [[ "$actual_tracked" == "true" ]]; then
    flipped_tracked=false
  else
    flipped_tracked=true
  fi

  local tmp; tmp="$scratch/state_tamper.json"
  jq --argjson v "$flipped_tracked" \
    '.self_integrity.git_tracked_check.state_json_tracked = $v' \
    "$state_file" > "$tmp" && mv "$tmp" "$state_file"

  local out; out="$(csa_state_check_tamper "$project" 2>/dev/null)"
  assert_contains "$out" "TAMPER-003" "should detect TAMPER-003 on git-tracked status drift" || return 1
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

csa_test_run test_tamper_001_state_json_mtime_drift        || _csa_failed=$((_csa_failed + 1))
csa_test_run test_tamper_002_suppressions_json_mtime_drift  || _csa_failed=$((_csa_failed + 1))
csa_test_run test_tamper_003_git_tracked_status_drift      || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
