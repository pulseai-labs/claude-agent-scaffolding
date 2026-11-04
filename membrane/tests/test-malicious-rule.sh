#!/usr/bin/env bash
# tests/test-malicious-rule.sh — Adversarial: T2-H malicious rule defenses.
# Tests: rule lying about AUTO_FIXABLE, symlink target, path traversal.
# Phase 7 Task 7.2.

set -u
source "$(dirname "$0")/_helpers.sh"
source "$CSA_LIB_DIR/helpers.sh"
source "$CSA_LIB_DIR/state.sh"
source "$CSA_LIB_DIR/apply-fix.sh"

_CSA_TMP="$(mktemp -d "${TMPDIR:-/tmp}/csa-malicious.XXXXXX")"
trap 'rm -rf "$_CSA_TMP"' EXIT

_csa_failed=0
_test_n=0

_next_scratch() {
  _test_n=$((_test_n + 1))
  mkdir -p "$_CSA_TMP/t$_test_n"
}

# ---------------------------------------------------------------------------
# test_malicious_rule_lies_about_auto_fixable
# Rule declares AUTO_FIXABLE=true at source time, but re-check on apply
# catches it being false. We test this by sourcing a rule file that has
# RULE_AUTO_FIXABLE set to a false-ish string.
# ---------------------------------------------------------------------------
test_malicious_rule_lies_about_auto_fixable() {
  _next_scratch; local scratch="$_CSA_TMP/t$_test_n"
  mkdir -p "$scratch/rules"

  # Rule that claims AUTO_FIXABLE via "TRUE" (wrong casing — not "true").
  cat > "$scratch/rules/MALICIOUS-001.sh" << 'RULEEOF'
#!/usr/bin/env bash
RULE_ID="MALICIOUS-001"
RULE_AUTO_FIXABLE="TRUE"
RULE_MECHANICALLY_FIXABLE="true"
detect() { return 0; }
fix() { printf "pwned\n"; return 0; }
RULEEOF

  local err_out; err_out="$(csa_apply_validate_rule "$scratch/rules/MALICIOUS-001.sh" 2>&1)"
  local ec=$?
  # "TRUE" != "true" → should fail validation.
  [[ "$ec" -ne 0 ]] || { printf '    expected validation to fail for RULE_AUTO_FIXABLE=TRUE (wrong casing), got 0\n' >&2; return 1; }
}

# ---------------------------------------------------------------------------
# test_malicious_rule_targets_symlink
# Attempt to apply a fix to a path that is a symlink → apply-fix refuses.
# ---------------------------------------------------------------------------
test_malicious_rule_targets_symlink() {
  _next_scratch; local scratch="$_CSA_TMP/t$_test_n"
  local project="$scratch/project"
  mkdir -p "$project/.claude/audits"

  # Create a real file and a symlink to it at the allowlist path.
  local real_file="$scratch/real_settings.json"
  printf '{"permissions": {}}' > "$real_file"
  ln -s "$real_file" "$project/.claude/settings.json"

  local err_out; err_out="$(csa_apply_validate_target "$project/.claude/settings.json" "$project" 2>&1)"
  local ec=$?
  [[ "$ec" -ne 0 ]] || { printf '    expected validate_target to fail for symlink, got 0\n' >&2; return 1; }
  local lower_err; lower_err="$(printf '%s' "$err_out" | tr '[:upper:]' '[:lower:]')"
  assert_contains "$lower_err" "symlink" "error should mention symlink" || return 1
}

# ---------------------------------------------------------------------------
# test_malicious_rule_path_traversal_refused
# Rule tries to write to a path that resolves outside the project root.
# apply-fix should refuse with traversal error.
# ---------------------------------------------------------------------------
test_malicious_rule_path_traversal_refused() {
  _next_scratch; local scratch="$_CSA_TMP/t$_test_n"
  local project="$scratch/project"
  mkdir -p "$project/.claude/audits"

  # A path that looks like an allowlist path but traverses up to parent.
  # The allowlist check strips the project_root prefix to compute rel_path,
  # so we pass an absolute path outside the project root.
  local outside_path; outside_path="$scratch/outside.json"
  printf '{}' > "$outside_path"

  local err_out; err_out="$(csa_apply_validate_target "$outside_path" "$project" 2>&1)"
  local ec=$?
  [[ "$ec" -ne 0 ]] || { printf '    expected validate_target to fail for out-of-root path, got 0\n' >&2; return 1; }
  # Error may say "allowlist" or "traversal".
  local lower_err; lower_err="$(printf '%s' "$err_out" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower_err" == *"allowlist"* || "$lower_err" == *"traversal"* ]] || {
    printf '    expected allowlist or traversal in error, got: %s\n' "$err_out" >&2; return 1
  }
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

csa_test_run test_malicious_rule_lies_about_auto_fixable || _csa_failed=$((_csa_failed + 1))
csa_test_run test_malicious_rule_targets_symlink         || _csa_failed=$((_csa_failed + 1))
csa_test_run test_malicious_rule_path_traversal_refused  || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
