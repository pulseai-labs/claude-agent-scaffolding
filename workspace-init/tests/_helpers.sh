#!/usr/bin/env bash
# tests/_helpers.sh — shared test primitives for workspace-init
# Source from each test file via: source "$(dirname "$0")/_helpers.sh"

set -u  # NOT -e — explicit return-code checks per test

# --- resolve plugin root eagerly ---
WI_PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export WI_PLUGIN_ROOT
export WI_LIB_DIR="$WI_PLUGIN_ROOT/lib"
export WI_TEMPLATES_DIR="$WI_PLUGIN_ROOT/templates"
export WI_HOOKS_DIR="$WI_PLUGIN_ROOT/hooks"
# Dispatcher entry point — install/repair-path tests go through bin/wi (bash
# shebang + set -euo pipefail) exactly as the skills invoke it.
export WI_BIN="$WI_PLUGIN_ROOT/bin/wi"

# _with_timeout <seconds> <cmd...> — run a command under `timeout` where it
# exists (GNU coreutils); bare otherwise. Guards the placeholder-in-path render
# test against an infinite substitution loop on hosts without `timeout`.
_with_timeout() {
  local t="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$t" "$@"
  else
    "$@"
  fi
}

# --- counters ---
WI_TESTS_PASSED=0
WI_TESTS_FAILED=0
WI_TESTS_FAIL_NAMES=()

# --- tempdir with EXIT-trap cleanup ---
wi_tmpdir() {
  local d
  d="$(mktemp -d -t "wi-test-XXXXXX")"
  # Expand $d at trap-registration time (not at trap-fire time) so the trap
  # works even when it fires in a subshell scope where the local $d is gone
  # and `set -u` would otherwise complain about an unbound variable.
  trap "rm -rf -- $(printf '%q' "$d")" EXIT
  echo "$d"
}

# --- assertions ---
assert_eq() { # $1=expected $2=actual $3=desc
  if [[ "$1" == "$2" ]]; then return 0
  else echo "    expected: $1"; echo "    actual:   $2"; return 1
  fi
}
assert_ne() { [[ "$1" != "$2" ]] || { echo "    both equal: $1"; return 1; }; }
assert_contains() { [[ "$2" == *"$1"* ]] || { echo "    expected substring: $1"; echo "    in: $2"; return 1; }; }
assert_not_contains() { [[ "$2" != *"$1"* ]] || { echo "    forbidden substring present: $1"; return 1; }; }
assert_file_exists() { [[ -f "$1" ]] || { echo "    missing file: $1"; return 1; }; }
assert_file_absent() { [[ ! -f "$1" ]] || { echo "    unexpected file: $1"; return 1; }; }
assert_dir_exists() { [[ -d "$1" ]] || { echo "    missing dir: $1"; return 1; }; }
assert_exits_with() { # $1=expected_code $2...=command
  local expected="$1"; shift
  "$@"; local actual=$?
  [[ "$actual" == "$expected" ]] || { echo "    expected exit $expected, got $actual"; return 1; }
}

# --- test runner ---
wi_test_run() { # $1=test_function_name
  local fn="$1"
  if "$fn"; then
    echo "  PASS: $fn"
    WI_TESTS_PASSED=$((WI_TESTS_PASSED + 1))
  else
    echo "  FAIL: $fn"
    WI_TESTS_FAILED=$((WI_TESTS_FAILED + 1))
    WI_TESTS_FAIL_NAMES+=("$fn")
  fi
}

wi_test_summary() {
  echo ""
  echo "== Summary =="
  echo "Passed: $WI_TESTS_PASSED"
  echo "Failed: $WI_TESTS_FAILED"
  if [[ "$WI_TESTS_FAILED" -gt 0 ]]; then
    printf '  - %s\n' "${WI_TESTS_FAIL_NAMES[@]}"
    return 1
  fi
  return 0
}
