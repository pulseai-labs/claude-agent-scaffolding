#!/usr/bin/env bash
# herdr-crew test helpers — sourced by every suite in this directory.
#
# Every plugin in this marketplace that has more than one suite keeps the
# counters, the colour setup and pass/fail here instead of one copy per suite, so
# this follows the house shape rather than inventing a third one.
#
# The literal counters and the pin/present wrappers live here for the same
# reason (#514, L1). One awk loop had grown four definitions across the suites
# plus three more inline in test-config-contract.sh, and one of the four had
# already lost the `[ -f ]` guard the other three carry — which is what a copy
# does when nothing asserts the shape. test-fidelity-pins.sh is the one
# exception, named where it is exempted at the bottom of this file.

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

# ── literal counting ────────────────────────────────────────────────────────
#
# One loop, one definition, four joins. index() is a LITERAL substring test, so
# it is NOT equivalent to grep -E, grep -w or grep -x; every counter below is
# literal on purpose. `grep -c` counts matching LINES rather than occurrences, so
# it cannot see a duplicate on one line, and `… | grep -q` in a pipeline can fail
# on a true match under pipefail.
#
# An empty needle is REFUSED, not counted: index(line, "") always returns 1 and
# substr(line, 1) returns the whole line, so the loop never advances — the count
# climbs forever and the suite hangs instead of failing.
count_literal() { # <needle> — the text to search arrives on stdin
  if [ -z "${1:-}" ]; then printf 'empty needle\n' >&2; return 1; fi
  awk -v needle="$1" '
    { line = $0
      while ((i = index(line, needle)) > 0) { n++; line = substr(line, i + length(needle)) } }
    END { print n+0 }'
}

# Occurrences of a literal substring, counted PER LINE: a needle that spans a
# markdown line wrap reads as absent rather than as present, so a passing pin is
# provably on one line. A file that cannot be opened is REFUSED rather than
# counted — a count is what a clean file returns, so returning 0 for a file
# nobody opened would certify it.
occurrences() { # <file> <needle>
  if [ -z "${2:-}" ]; then printf 'empty needle\n' >&2; return 1; fi
  [ -f "${1:-}" ] || { printf 'no such file: %s\n' "${1:-}" >&2; return 1; }
  count_literal "$2" < "$1"
}

# Occurrences in the file read as ONE logical line: every whitespace run is
# squeezed to a single space first, which reassembles the space a markdown wrap
# broke at. `pin` counts per line, which is right for its pins; this counter is
# for a pin whose SUBJECT is a phrase a restatement may break anywhere, where a
# per-line count would report "defined once" for a file that defines the phrase
# twice, wrapped differently. Note the join is by SQUEEZING, not by deleting the
# newline: the phrase's words are separated by the very space the wrap consumed.
# (A name is space-less, so the config suite's personal-name sweep deletes
# newlines instead — it funnels through count_literal for the loop, not this.)
occurrences_flat() { # <file> <needle>
  if [ -z "${2:-}" ]; then printf 'empty needle\n' >&2; return 1; fi
  [ -f "${1:-}" ] || { printf 'no such file: %s\n' "${1:-}" >&2; return 1; }
  awk '{ buf = buf " " $0 }
    END { gsub(/[[:space:]]+/, " ", buf); print buf }' "$1" | count_literal "$2"
}

count_of() { # <file> <needle> [line|flat]
  if [ "${3:-line}" = flat ]; then occurrences_flat "$1" "$2"; else occurrences "$1" "$2"; fi
}

# pin <file> <needle> <label> [line|flat] — the needle must occur EXACTLY once.
# A zero count names the wrap case, because that is the common way a pin that is
# still true stops being counted: the clause was reworded across a line break.
pin() {
  c="$(count_of "$1" "$2" "${4:-line}")" || { fail "$3" "unreadable file or empty needle: $1"; return 0; }
  if [ "$c" -eq 1 ]; then pass "$3"
  elif [ "$c" -eq 0 ]; then fail "$3" "not found in ${1##*/} — reworded away, or the pin now spans a line wrap. pin: $2"
  else fail "$3" "found $c times in ${1##*/}; a pin must be unique. pin: $2"
  fi
}

# present <file> <needle> <label> [line|flat] — at least once.
present() {
  c="$(count_of "$1" "$2" "${4:-line}")" || { fail "$3" "unreadable file or empty needle: $1"; return 0; }
  if [ "$c" -ge 1 ]; then pass "$3"; else fail "$3" "not found in ${1##*/}: $2"; fi
}

# ── the hoisted definitions cannot be re-copied silently ────────────────────
#
# A suite-local definition SHADOWS the one above: every assertion that calls it
# keeps passing, so a re-copied loop is invisible until the day it drifts — which
# is how the fourth copy lost its guard. This asserts the hoist, and NAMES the one
# exemption rather than implying it by its absence.
#
# test-fidelity-pins.sh keeps its own copies because they are byte-identical to
# orca-crew's, and tests/test-herdr-crew-parity.sh pins exactly that with cmp: an
# edit here — including adding the missing guard — lands in one copy only and
# fails a CI step. The exemption is asserted to be LIVE, so it cannot outlive its
# reason: when orca-crew is retired, hoist that copy too and delete both this
# paragraph and the exemption. A suite that legitimately wants one of these names
# for something else must extend the list deliberately.
assert_hoisted_counters() {
  _dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  _fns="count_literal occurrences occurrences_flat count_of pin present"
  _exempt="test-fidelity-pins.sh"
  _copies=0
  for _suite in "$_dir"/test-*.sh; do
    [ "${_suite##*/}" = "$_exempt" ] && continue
    for _fn in $_fns; do
      _n="$(count_definitions "$_suite" "$_fn")"
      if [ "$_n" -ne 0 ]; then
        _copies=$((_copies + 1))
        fail "no copy of $_fn in ${_suite##*/}" \
          "$_n local definition(s) shadow the hoisted one in _helpers.sh; the shared definition is the only one (exemption: $_exempt)"
      fi
    done
  done
  [ "$_copies" -ne 0 ] || \
    pass "no suite re-defines a hoisted counter (exemption: $_exempt, pinned to orca-crew's copies)"
  if [ "$(count_definitions "$_dir/$_exempt" occurrences)" -eq 1 ]; then
    pass "the one exemption still needs exempting"
  else
    fail "the one exemption still needs exempting" \
      "$_exempt no longer defines its own occurrences — hoist it and delete the exemption"
  fi
}

# How many lines OPEN a definition of <fn> in <file>. Anchored at the line start
# and requiring the parentheses and the brace, so a mention in a comment or a
# call site is not a definition.
count_definitions() { # <file> <fn>
  awk -v fn="$2" '$0 ~ "^" fn "\\(\\)[[:space:]]*\\{" { n++ } END { print n+0 }' "$1"
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
