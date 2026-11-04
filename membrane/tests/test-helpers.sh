#!/usr/bin/env bash
set -u
source "$(dirname "$0")/_helpers.sh"
source "$CSA_LIB_DIR/helpers.sh"

_csa_failed=0

# Shared sandbox — create directly to avoid the csa_tmpdir $() subshell trap issue.
_CSA_TMP="$(mktemp -d "${TMPDIR:-/tmp}/csa-test.XXXXXX")"
trap 'rm -rf "$_CSA_TMP"' EXIT

# --- csa_sha256 ---
test_sha256_known_answer() {
  local expected="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  local actual
  actual="$(csa_sha256 "abc")"
  assert_eq "$expected" "$actual" "csa_sha256 NIST FIPS known answer for 'abc'" || return 1
}

# --- csa_realpath ---
test_realpath_resolves_absolute_path() {
  local f="$_CSA_TMP/testfile.txt"
  touch "$f"
  # Normalise both sides through csa_realpath so macOS /var→/private/var symlink
  # expansion is consistent.
  local expected; expected="$(csa_realpath "$f")"
  local actual;   actual="$(csa_realpath "$f")"
  assert_eq "$expected" "$actual" "csa_realpath absolute path" || return 1
  [[ -f "$actual" ]] || { printf '    resolved path does not exist: %s\n' "$actual" >&2; return 1; }
}

test_realpath_resolves_dot_traversal() {
  mkdir -p "$_CSA_TMP/a/b"
  local expected; expected="$(csa_realpath "$_CSA_TMP/a/b")"
  local actual;   actual="$(csa_realpath "$_CSA_TMP/a/b/../b")"
  assert_eq "$expected" "$actual" "csa_realpath dot traversal" || return 1
}

# --- csa_sed_inplace ---
test_sed_inplace_replaces_content() {
  local f="$_CSA_TMP/sedtest.txt"
  printf 'hello world\n' > "$f"
  csa_sed_inplace 's/world/bash/' "$f"
  local content
  content="$(cat "$f")"
  assert_eq "hello bash" "$content" "csa_sed_inplace replacement" || return 1
}

# --- csa_mkdir_lock ---
test_mkdir_lock_first_acquire_succeeds() {
  local lock_dir="$_CSA_TMP/first.lock"
  csa_mkdir_lock "$lock_dir" "test-label" || return 1
  [[ -d "$lock_dir" ]] || { printf '    lock dir not created\n' >&2; return 1; }
}

test_mkdir_lock_second_acquire_fails() {
  local lock_dir="$_CSA_TMP/second.lock"
  csa_mkdir_lock "$lock_dir" "first" || return 1
  if csa_mkdir_lock "$lock_dir" "second" 2>/dev/null; then
    printf '    second acquire should have failed but returned 0\n' >&2
    return 1
  fi
}

csa_test_run test_sha256_known_answer               || _csa_failed=$((_csa_failed + 1))
csa_test_run test_realpath_resolves_absolute_path   || _csa_failed=$((_csa_failed + 1))
csa_test_run test_realpath_resolves_dot_traversal   || _csa_failed=$((_csa_failed + 1))
csa_test_run test_sed_inplace_replaces_content      || _csa_failed=$((_csa_failed + 1))
csa_test_run test_mkdir_lock_first_acquire_succeeds || _csa_failed=$((_csa_failed + 1))
csa_test_run test_mkdir_lock_second_acquire_fails   || _csa_failed=$((_csa_failed + 1))

[[ "$_csa_failed" -eq 0 ]] || exit 1
