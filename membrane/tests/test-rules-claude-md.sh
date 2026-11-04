#!/usr/bin/env bash
set -u
source "$(dirname "$0")/_helpers.sh"
source "$CSA_LIB_DIR/helpers.sh"
source "$CSA_LIB_DIR/redact.sh"
source "$CSA_LIB_DIR/fingerprint.sh"

_csa_failed=0
_tmp="$(mktemp -d "${TMPDIR:-/tmp}/csa-test.XXXXXX")"
trap 'rm -rf "$_tmp"' EXIT

run_rule() { ( source "$1"; detect "$2" ); }

# Helper: create a CLAUDE.md fixture in a subdirectory
make_claude_md() {
  local subdir="$1"; local content="$2"
  local dir="$_tmp/$subdir"
  mkdir -p "$dir"
  printf '%s\n' "$content" > "$dir/CLAUDE.md"
  printf '%s' "$dir/CLAUDE.md"
}

# ---------------------------------------------------------------------------
# CLAUDE-MD-001: plaintext-secrets
# ---------------------------------------------------------------------------

test_plaintext_secrets_detects_github_token() {
  local f; f="$(make_claude_md "proj1" "Use INTERNAL_API_TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa to access staging.")"
  local out; out="$(run_rule "$CSA_RULES_DIR/claude-md/plaintext-secrets.sh" "$f")"
  assert_contains "$out" "CLAUDE-MD-001" || return 1
  assert_contains "$out" "***" || return 1
}

test_plaintext_secrets_negative_clean_content() {
  local f; f="$(make_claude_md "proj2" "# Standard project
This is a sample CLAUDE.md with no secrets and no internal markers.")"
  local out; out="$(run_rule "$CSA_RULES_DIR/claude-md/plaintext-secrets.sh" "$f")"
  [[ -z "$out" ]] || return 1
}

# ---------------------------------------------------------------------------
# CLAUDE-MD-002: internal-markers
# ---------------------------------------------------------------------------

test_internal_markers_detects_confidential() {
  local f; f="$(make_claude_md "proj3" "CONFIDENTIAL: This document contains proprietary information.")"
  local out; out="$(run_rule "$CSA_RULES_DIR/claude-md/internal-markers.sh" "$f")"
  assert_contains "$out" "CLAUDE-MD-002" || return 1
}

test_internal_markers_negative_clean_content() {
  local f; f="$(make_claude_md "proj4" "# Team workflow project
This project uses make + pytest. No secrets here.")"
  local out; out="$(run_rule "$CSA_RULES_DIR/claude-md/internal-markers.sh" "$f")"
  [[ -z "$out" ]] || return 1
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
csa_test_run test_plaintext_secrets_detects_github_token    || _csa_failed=$((_csa_failed + 1))
csa_test_run test_plaintext_secrets_negative_clean_content  || _csa_failed=$((_csa_failed + 1))
csa_test_run test_internal_markers_detects_confidential     || _csa_failed=$((_csa_failed + 1))
csa_test_run test_internal_markers_negative_clean_content   || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
