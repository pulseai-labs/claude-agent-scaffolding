#!/usr/bin/env bash
set -u
source "$(dirname "$0")/_helpers.sh"
source "$CSA_LIB_DIR/redact.sh"

_csa_failed=0

test_redact_anthropic_key() {
  local input="sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAxyz1"
  local out; out="$(csa_redact "$input")"
  assert_contains "$out" "sk-a" || return 1
  assert_contains "$out" "***" || return 1
  assert_contains "$out" "xyz1" || return 1
  if [[ "$out" == *"AAAAAAAAAAAAAAA"* ]]; then return 1; fi
}

test_redact_jwt() {
  local input="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.signature123"
  local out; out="$(csa_redact "$input")"
  assert_contains "$out" "eyJh" || return 1
  assert_contains "$out" "***" || return 1
  if [[ "$out" == *"InR5cCI6IkpXVCJ9"* ]]; then return 1; fi
}

test_redact_github_pat() {
  local input="The token is ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa for prod"
  local out; out="$(csa_redact "$input")"
  assert_contains "$out" "ghp_" || return 1
  assert_contains "$out" "***" || return 1
  if [[ "$out" == *"aaaaaaaaaaaaaaaaaaaaaaaa"* ]]; then return 1; fi
}

test_redact_aws_key() {
  local input="aws_access_key_id = AKIAIOSFODNN7EXAMPLE"
  local out; out="$(csa_redact "$input")"
  assert_contains "$out" "AKIA" || return 1
  assert_contains "$out" "***" || return 1
}

test_redact_base64_blob() {
  local input="data=YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5"
  local out; out="$(csa_redact "$input")"
  assert_contains "$out" "***" || return 1
}

test_redact_passes_through_non_secret() {
  local input="this is a normal line with no secrets, just words like permission and allow"
  local out; out="$(csa_redact "$input")"
  assert_eq "$input" "$out"
}

test_redact_length_cap() {
  local long
  long="$(printf 'x%.0s' {1..500})"
  CSA_REDACT_MAX_LEN=200 out="$(csa_redact "$long")"
  assert_contains "$out" "truncated" || return 1
  [[ "${#out}" -lt 250 ]] || return 1
}

csa_test_run test_redact_anthropic_key            || _csa_failed=$((_csa_failed + 1))
csa_test_run test_redact_jwt                      || _csa_failed=$((_csa_failed + 1))
csa_test_run test_redact_github_pat               || _csa_failed=$((_csa_failed + 1))
csa_test_run test_redact_aws_key                  || _csa_failed=$((_csa_failed + 1))
csa_test_run test_redact_base64_blob              || _csa_failed=$((_csa_failed + 1))
csa_test_run test_redact_passes_through_non_secret || _csa_failed=$((_csa_failed + 1))
csa_test_run test_redact_length_cap               || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
