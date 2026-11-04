#!/usr/bin/env bash
set -u
source "$(dirname "$0")/_helpers.sh"
source "$CSA_LIB_DIR/helpers.sh"
source "$CSA_LIB_DIR/redact.sh"
source "$CSA_LIB_DIR/fingerprint.sh"

_csa_failed=0
_tmp="$(mktemp -d "${TMPDIR:-/tmp}/csa-test.XXXXXX")"
trap 'rm -rf "$_tmp"' EXIT

run_rule() {
  local rule="$1"; local file="$2"
  ( source "$rule"; detect "$file" )
}

_SCHEMA_RULE="$CSA_RULES_DIR/permissions/settings-schema-validation.sh"

# ---------------------------------------------------------------------------
# PERM-005: settings-schema-validation
# ---------------------------------------------------------------------------

test_perm005_flags_allowed_typo() {
  local f="$_tmp/schema_allowed/settings.json"
  mkdir -p "$(dirname "$f")"
  # "allowed" is a typo for "permissions"
  printf '{"allowed":["Bash(git:*)"],"permissions":{"allow":[],"deny":[]}}\n' > "$f"
  local out; out="$(run_rule "$_SCHEMA_RULE" "$f")"
  assert_contains "$out" "PERM-005" || return 1
  assert_contains "$out" "allowed" || return 1
}

test_perm005_flags_permissons_typo() {
  local f="$_tmp/schema_permissons/settings.json"
  mkdir -p "$(dirname "$f")"
  # "permissons" is a typo for "permissions"
  printf '{"permissons":{"allow":["Bash(*)"],"deny":[]}}\n' > "$f"
  local out; out="$(run_rule "$_SCHEMA_RULE" "$f")"
  assert_contains "$out" "PERM-005" || return 1
  assert_contains "$out" "permissons" || return 1
}

test_perm005_passes_clean_settings() {
  local f="$_tmp/schema_clean/settings.json"
  mkdir -p "$(dirname "$f")"
  # All valid known keys
  printf '{"permissions":{"allow":["Bash(git:*)"],"deny":[]},"enabledPlugins":["foo"],"model":"claude-sonnet-4-5"}\n' > "$f"
  local out; out="$(run_rule "$_SCHEMA_RULE" "$f")"
  [[ -z "$out" ]] || return 1
}

test_perm005_ignores_nested_keys() {
  local f="$_tmp/schema_nested/settings.json"
  mkdir -p "$(dirname "$f")"
  # Only TOP-level unknown keys should be flagged.
  # "alowed_typo" is nested under "permissions" — should NOT fire.
  printf '{"permissions":{"allow":[],"deny":[],"alowed_typo":[]}}\n' > "$f"
  local out; out="$(run_rule "$_SCHEMA_RULE" "$f")"
  [[ -z "$out" ]] || return 1
}

test_perm005_flags_multiple_unknown_keys() {
  local f="$_tmp/schema_multi/settings.json"
  mkdir -p "$(dirname "$f")"
  printf '{"permissions":{},"typoA":"x","typoB":"y"}\n' > "$f"
  local out; out="$(run_rule "$_SCHEMA_RULE" "$f")"
  assert_contains "$out" "PERM-005" || return 1
  assert_contains "$out" "typoA" || return 1
  assert_contains "$out" "typoB" || return 1
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
csa_test_run test_perm005_flags_allowed_typo           || _csa_failed=$((_csa_failed + 1))
csa_test_run test_perm005_flags_permissons_typo        || _csa_failed=$((_csa_failed + 1))
csa_test_run test_perm005_passes_clean_settings        || _csa_failed=$((_csa_failed + 1))
csa_test_run test_perm005_ignores_nested_keys          || _csa_failed=$((_csa_failed + 1))
csa_test_run test_perm005_flags_multiple_unknown_keys  || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
