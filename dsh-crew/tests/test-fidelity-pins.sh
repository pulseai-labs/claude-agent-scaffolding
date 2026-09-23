#!/usr/bin/env bash
#
# dsh-crew — fidelity pins
#
# Five sentences in dsh-executor that a rewording must not lose. Each is asserted
# to occur EXACTLY ONCE on one line (contiguity + uniqueness), counted with awk's
# index() so a duplicate on one line is seen and pipefail cannot hide a match.
# The list is capped at five: a rule that matters displaces one, never extends.
#
# Usage: bash dsh-crew/tests/test-fidelity-pins.sh   Exit 0 when every pin is exact.

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

SKILL="$PLUGIN_ROOT/skills/dsh-executor/SKILL.md"

occurrences() {
  [ -n "$2" ] || { printf 'empty needle\n' >&2; return 1; }
  awk -v needle="$2" '{ line=$0; n=0; while ((i=index(line, needle)) > 0) { n++; line=substr(line, i+length(needle)) } total+=n } END { print total+0 }' "$1"
}

pin() {
  local n; n="$(occurrences "$SKILL" "$1")" || { fail "$1"; return; }
  [ "$n" -eq 1 ] && pass "$1" || fail "$1" "occurs $n times, expected exactly 1"
}

section "dsh-executor pins (max five)"
pin "ossify state is the single authority."
pin "Nothing is retried in v0."
pin "Never a third attempt."
pin "never from the child's words"
pin "in declared decomposition order, never arrival order"

report
