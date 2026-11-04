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

# ---------------------------------------------------------------------------
# SECRETS-001: api-keys
# ---------------------------------------------------------------------------

test_api_keys_detects_anthropic() {
  local f="$_tmp/api_keys_pos.txt"
  printf 'key: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n' > "$f"
  local out; out="$(run_rule "$CSA_RULES_DIR/secrets/api-keys.sh" "$f")"
  assert_contains "$out" "SECRETS-001" || return 1
  assert_contains "$out" "***" || return 1
}

test_api_keys_negative_normal_text() {
  local f="$_tmp/api_keys_neg.txt"
  printf 'mentioning sk and api keys conceptually without real values\n' > "$f"
  local out; out="$(run_rule "$CSA_RULES_DIR/secrets/api-keys.sh" "$f")"
  [[ -z "$out" ]] || return 1
}

# ---------------------------------------------------------------------------
# SECRETS-002: jwt
# ---------------------------------------------------------------------------

test_jwt_detects_token() {
  local f="$_tmp/jwt_pos.txt"
  # A valid-looking JWT: header.payload.signature (all base64url segments)
  printf 'auth: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c\n' > "$f"
  local out; out="$(run_rule "$CSA_RULES_DIR/secrets/jwt.sh" "$f")"
  assert_contains "$out" "SECRETS-002" || return 1
  assert_contains "$out" "***" || return 1
}

test_jwt_negative_short_base64() {
  local f="$_tmp/jwt_neg.txt"
  # eyJ prefix but too short — not a real JWT
  printf 'eyJhbGc short fragment without two dots\n' > "$f"
  local out; out="$(run_rule "$CSA_RULES_DIR/secrets/jwt.sh" "$f")"
  [[ -z "$out" ]] || return 1
}

# ---------------------------------------------------------------------------
# SECRETS-003: env-var-leak
# ---------------------------------------------------------------------------

test_env_var_leak_detects_secret() {
  local f="$_tmp/env_pos.sh"
  printf 'API_KEY=abcdefghijklmnopqrstuvwxyz123456\n' > "$f"
  local out; out="$(run_rule "$CSA_RULES_DIR/secrets/env-var-leak.sh" "$f")"
  assert_contains "$out" "SECRETS-003" || return 1
  assert_contains "$out" "SECRETS-003" || return 1
}

test_env_var_leak_negative_placeholder() {
  local f="$_tmp/env_neg.sh"
  # Placeholder values shorter than 12 chars won't match
  printf 'API_KEY=YOUR_KEY\nSECRET=changeme\n' > "$f"
  local out; out="$(run_rule "$CSA_RULES_DIR/secrets/env-var-leak.sh" "$f")"
  [[ -z "$out" ]] || return 1
}

# ---------------------------------------------------------------------------
# SECRETS-004: base64-credentials
# ---------------------------------------------------------------------------

test_base64_creds_detects_blob() {
  local f="$_tmp/b64_pos.txt"
  # 45-char base64 blob
  printf 'credential=YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY\n' > "$f"
  local out; out="$(run_rule "$CSA_RULES_DIR/secrets/base64-credentials.sh" "$f")"
  assert_contains "$out" "SECRETS-004" || return 1
}

test_base64_creds_negative_checksum() {
  local f="$_tmp/b64_neg.txt"
  # Checksum lines with sha256: prefix should be skipped
  printf 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n' > "$f"
  local out; out="$(run_rule "$CSA_RULES_DIR/secrets/base64-credentials.sh" "$f")"
  [[ -z "$out" ]] || return 1
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
csa_test_run test_api_keys_detects_anthropic      || _csa_failed=$((_csa_failed + 1))
csa_test_run test_api_keys_negative_normal_text   || _csa_failed=$((_csa_failed + 1))
csa_test_run test_jwt_detects_token               || _csa_failed=$((_csa_failed + 1))
csa_test_run test_jwt_negative_short_base64       || _csa_failed=$((_csa_failed + 1))
csa_test_run test_env_var_leak_detects_secret     || _csa_failed=$((_csa_failed + 1))
csa_test_run test_env_var_leak_negative_placeholder || _csa_failed=$((_csa_failed + 1))
csa_test_run test_base64_creds_detects_blob       || _csa_failed=$((_csa_failed + 1))
csa_test_run test_base64_creds_negative_checksum  || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
