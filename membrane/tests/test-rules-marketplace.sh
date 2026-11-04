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

# Helper: write a marketplace.json fixture
make_marketplace() {
  local subdir="$1"; local content="$2"
  local dir="$_tmp/$subdir"
  mkdir -p "$dir"
  local f="$dir/marketplace.json"
  printf '%s\n' "$content" > "$f"
  printf '%s' "$f"
}

# ---------------------------------------------------------------------------
# MARKETPLACE-001: untrusted-source
# ---------------------------------------------------------------------------

test_untrusted_source_detects_http_url() {
  local f; f="$(make_marketplace "bad-mkt" '{
    "marketplaces": [
      { "name": "untrusted", "url": "http://malicious.example.com/marketplace.json" }
    ]
  }')"
  local out; out="$(run_rule "$CSA_RULES_DIR/marketplace/untrusted-source.sh" "$f")"
  assert_contains "$out" "MARKETPLACE-001" || return 1
}

test_untrusted_source_negative_https_url() {
  local f; f="$(make_marketplace "good-mkt" '{
    "marketplaces": [
      { "name": "official", "url": "https://registry.example.com/marketplace.json" }
    ]
  }')"
  local out; out="$(run_rule "$CSA_RULES_DIR/marketplace/untrusted-source.sh" "$f")"
  [[ -z "$out" ]] || return 1
}

# ---------------------------------------------------------------------------
# MARKETPLACE-002: malformed-marketplace
# ---------------------------------------------------------------------------

test_malformed_detects_missing_name_field() {
  local f; f="$(make_marketplace "malformed-mkt" '{
    "marketplaces": [
      { "url": "https://registry.example.com/marketplace.json" }
    ]
  }')"
  local out; out="$(run_rule "$CSA_RULES_DIR/marketplace/malformed-marketplace.sh" "$f")"
  assert_contains "$out" "MARKETPLACE-002" || return 1
}

test_malformed_negative_valid_structure() {
  local f; f="$(make_marketplace "valid-mkt" '{
    "marketplaces": [
      { "name": "official", "url": "https://registry.example.com/marketplace.json" }
    ]
  }')"
  local out; out="$(run_rule "$CSA_RULES_DIR/marketplace/malformed-marketplace.sh" "$f")"
  [[ -z "$out" ]] || return 1
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
csa_test_run test_untrusted_source_detects_http_url       || _csa_failed=$((_csa_failed + 1))
csa_test_run test_untrusted_source_negative_https_url     || _csa_failed=$((_csa_failed + 1))
csa_test_run test_malformed_detects_missing_name_field    || _csa_failed=$((_csa_failed + 1))
csa_test_run test_malformed_negative_valid_structure      || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
