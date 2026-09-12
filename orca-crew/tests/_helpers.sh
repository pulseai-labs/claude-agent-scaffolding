#!/usr/bin/env bash
# orca-crew test helpers — sourced by every suite in this directory.
#
# Both suites had their own copy of the counters, the colour setup, and pass/fail.
# Every plugin in this marketplace that has more than one suite keeps them here
# instead, so this follows the house shape rather than inventing a third one.

PASS=0
FAIL=0

if [ -t 1 ]; then
  GREEN=$(printf '\033[32m'); RED=$(printf '\033[31m'); DIM=$(printf '\033[2m'); RST=$(printf '\033[0m')
else
  GREEN=""; RED=""; DIM=""; RST=""
fi

pass() { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$GREEN" "$RST" "$1"; }

fail() {
  FAIL=$((FAIL+1))
  printf '  %s✗%s %s\n' "$RED" "$RST" "$1"
  [ -n "${2:-}" ] && printf '      %s%s%s\n' "$DIM" "$2" "$RST"
  return 0
}

section() { printf '\n%s%s%s\n' "$DIM" "── $1 ──" "$RST"; }

report() {
  printf '\n%s──%s %d passed, %d failed\n' "$DIM" "$RST" "$PASS" "$FAIL"
  [ "$FAIL" -eq 0 ] || return 1
  return 0
}

# Ruby + Psych is how this repo parses YAML — tests/test-codex-dual-publish.sh
# established it, because Codex's own loader is Psych and a check that parses
# YAML some other way is not checking what will actually load the file.
# Preflight it so a missing toolchain fails loudly instead of looking like a
# parse error in the file under test.
require_ruby_psych() {
  RUBY_BIN="$(command -v ruby || true)"
  if [ -z "$RUBY_BIN" ] || ! "$RUBY_BIN" -e 'require "psych"' >/dev/null 2>&1; then
    fail "ruby + Psych available on PATH" "cannot validate YAML without the parser the loader uses"
    return 1
  fi
  return 0
}
