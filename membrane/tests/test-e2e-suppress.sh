#!/usr/bin/env bash
# tests/test-e2e-suppress.sh — E2E suppression tests.
# Phase 7 Task 7.1.

set -u
source "$(dirname "$0")/_helpers.sh"
source "$CSA_LIB_DIR/helpers.sh"
source "$CSA_LIB_DIR/redact.sh"
source "$CSA_LIB_DIR/fingerprint.sh"
source "$CSA_LIB_DIR/severity.sh"
source "$CSA_LIB_DIR/enumerate-targets.sh"
source "$CSA_LIB_DIR/rule-engine.sh"
source "$CSA_LIB_DIR/state.sh"
source "$CSA_LIB_DIR/baseline.sh"
source "$CSA_LIB_DIR/suppress.sh"

_CSA_TMP="$(mktemp -d "${TMPDIR:-/tmp}/csa-e2e-sup.XXXXXX")"
trap 'rm -rf "$_CSA_TMP"' EXIT

_csa_failed=0
_test_n=0

# Do NOT call inside $() — subshell loses counter increment.
# Usage: _next_scratch; local scratch="$_CSA_TMP/t$_test_n"
_next_scratch() {
  _test_n=$((_test_n + 1))
  mkdir -p "$_CSA_TMP/t$_test_n"
}

# ---------------------------------------------------------------------------
# test_e2e_suppress_medium_disappears_next_run
# Audit permissions-issue (has PERM-001 Medium), suppress it, re-audit;
# suppressed finding must not appear in the filtered output.
# ---------------------------------------------------------------------------
test_e2e_suppress_medium_disappears_next_run() {
  _next_scratch; local scratch="$_CSA_TMP/t$_test_n"
  local project="$scratch/project"
  cp -R "$CSA_FIXTURES_DIR/issues/permissions-issue/." "$project/"
  mkdir -p "$project/.claude/audits"
  export CSA_PROJECT_ROOT="$project"
  csa_state_init "$project"

  # Run 1: get findings.
  HOME=/nonexistent csa_rule_engine_scan_all "$project" "all" > "$scratch/raw1.jsonl" 2>/dev/null
  csa_baseline_tag "$scratch/raw1.jsonl" "$project" > "$scratch/tagged1.jsonl" 2>/dev/null
  csa_suppress_filter "$scratch/tagged1.jsonl" "$project" > "$scratch/fil1.jsonl" 2>/dev/null
  local findings1; findings1="$(cat "$scratch/fil1.jsonl")"

  # Find a suppressible (non-critical) finding.
  local medium_fuid; medium_fuid="$(printf '%s\n' "$findings1" | jq -r 'select(.severity == "medium" or .severity == "low" or .severity == "info") | .finding_uid' | head -1)"
  [[ -n "$medium_fuid" ]] || { printf '    no medium/low/info finding in permissions-issue run1\n' >&2; return 1; }

  # Record run1 in state.
  csa_state_record_audit "$project" 1 ".claude/audits/run-1.md" "$findings1" >/dev/null 2>&1 || true

  # Backdate first_seen to bypass the 60-second race-window check.
  local state_file; state_file="$(csa_state_path "$project")"
  local old_ts; old_ts="$(date -u -v-120S +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -d '120 seconds ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || printf '2000-01-01T00:00:00Z')"
  jq --arg fuid "$medium_fuid" --arg ts "$old_ts" \
    '.findings[$fuid].first_seen = $ts' \
    "$state_file" > "$scratch/state_patched.json" \
    && mv "$scratch/state_patched.json" "$state_file"

  local sev; sev="$(printf '%s\n' "$findings1" | jq -r --arg k "$medium_fuid" 'select(.finding_uid == $k) | .severity' | head -1)"

  csa_suppress_add "$project" "$medium_fuid" "$sev" "e2e test suppression" 2>/dev/null
  local sup_ec=$?
  [[ "$sup_ec" -eq 0 ]] || { printf '    csa_suppress_add failed ec=%d\n' "$sup_ec" >&2; return 1; }

  # Run 2: re-audit; suppressed fuid must not appear in filtered output.
  HOME=/nonexistent csa_rule_engine_scan_all "$project" "all" > "$scratch/raw2.jsonl" 2>/dev/null
  csa_baseline_tag "$scratch/raw2.jsonl" "$project" > "$scratch/tagged2.jsonl" 2>/dev/null
  csa_suppress_filter "$scratch/tagged2.jsonl" "$project" > "$scratch/fil2.jsonl" 2>/dev/null
  local out2; out2="$(cat "$scratch/fil2.jsonl")"

  printf '%s\n' "$out2" | grep -q "$medium_fuid" && {
    printf '    suppressed finding %s still appears in run2 output\n' "$medium_fuid" >&2; return 1
  }
  return 0
}

# ---------------------------------------------------------------------------
# test_e2e_suppress_critical_refused
# Try to suppress a Critical finding → non-zero exit, "critical" in stderr.
# ---------------------------------------------------------------------------
test_e2e_suppress_critical_refused() {
  _next_scratch; local scratch="$_CSA_TMP/t$_test_n"
  local project="$scratch/project"
  cp -R "$CSA_FIXTURES_DIR/issues/secrets-issue/." "$project/"
  mkdir -p "$project/.claude/audits"
  export CSA_PROJECT_ROOT="$project"
  csa_state_init "$project"

  HOME=/nonexistent csa_rule_engine_scan_all "$project" "all" > "$scratch/raw.jsonl" 2>/dev/null

  local critical_fuid; critical_fuid="$(jq -r 'select(.severity == "critical") | .finding_uid' "$scratch/raw.jsonl" | head -1)"
  [[ -n "$critical_fuid" ]] || { printf '    no critical finding in secrets-issue\n' >&2; return 1; }

  local stderr_out; stderr_out="$(csa_suppress_add "$project" "$critical_fuid" "critical" "should fail" 2>&1 >/dev/null)"
  local ec=$?

  [[ "$ec" -ne 0 ]] || { printf '    expected non-zero exit from suppress_add for critical\n' >&2; return 1; }
  local lower_err; lower_err="$(printf '%s' "$stderr_out" | tr '[:upper:]' '[:lower:]')"
  assert_contains "$lower_err" "critical" "error should mention critical" || return 1
}

# ---------------------------------------------------------------------------
# test_e2e_suppress_race_window_refused
# Record a finding with first_seen=now in state; immediately try to suppress
# → refused (60s race window).
# ---------------------------------------------------------------------------
test_e2e_suppress_race_window_refused() {
  _next_scratch; local scratch="$_CSA_TMP/t$_test_n"
  local project="$scratch/project"
  cp -R "$CSA_FIXTURES_DIR/issues/permissions-issue/." "$project/"
  mkdir -p "$project/.claude/audits"
  export CSA_PROJECT_ROOT="$project"
  csa_state_init "$project"

  # Inject a synthetic medium finding with first_seen=now (within race window).
  local fuid="FUID-racetest01"
  local now; now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local state_file; state_file="$(csa_state_path "$project")"
  jq --arg fuid "$fuid" --arg now "$now" \
    '.findings[$fuid] = {rule_id: "PERM-001", severity: "medium", file: ".claude/settings.json", first_seen: $now, last_seen: $now, seen_in_runs: 1, last_run_index: 1, last_display_id: "SA-run-1-001"}' \
    "$state_file" > "$scratch/state_race.json" && mv "$scratch/state_race.json" "$state_file"

  local stderr_out; stderr_out="$(csa_suppress_add "$project" "$fuid" "medium" "race test" 2>&1 >/dev/null)"
  local ec=$?

  [[ "$ec" -ne 0 ]] || { printf '    expected non-zero exit (race window), got 0\n' >&2; return 1; }
  local lower_err; lower_err="$(printf '%s' "$stderr_out" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower_err" == *"60"* || "$lower_err" == *"race"* || "$lower_err" == *"wait"* ]] || {
    printf '    expected 60s/race/wait in error, got: %s\n' "$stderr_out" >&2; return 1
  }
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

csa_test_run test_e2e_suppress_medium_disappears_next_run || _csa_failed=$((_csa_failed + 1))
csa_test_run test_e2e_suppress_critical_refused           || _csa_failed=$((_csa_failed + 1))
csa_test_run test_e2e_suppress_race_window_refused        || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
