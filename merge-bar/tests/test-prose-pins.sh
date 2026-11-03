#!/usr/bin/env bash
#
# merge-bar — prose pins beyond the fidelity file's cap of ten (#1061 C8).
#
# Same rule as test-fidelity-pins.sh: a literal sentence occurs EXACTLY ONCE in its file.

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

occurrences() {
  awk -v needle="$2" '
    { line = $0
      while ((i = index(line, needle)) > 0) { n++; line = substr(line, i + length(needle)) } }
    END { print n+0 }
  ' "$1"
}

pin() {
  path="$PLUGIN_ROOT/$1"
  if [ ! -f "$path" ]; then fail "$3" "no such file: $1"; return 0; fi
  count="$(occurrences "$path" "$2")"
  if [ "$count" -eq 1 ]; then pass "$3"; else fail "$3" "found $count times in $1, want 1. pin: $2"; fi
}

section "working-a-pr round stop"
pin "skills/working-a-pr/SKILL.md" \
  "or **change the design**. Recommend the last when a stop's" \
  "the stop offers change the design as a third option, recommended on an Extends: chain"

section "reviewing-a-pr run"
pin "skills/reviewing-a-pr/SKILL.md" \
  "the launcher must enforce" \
  "naming run is the launcher's trust statement, and the network limit is the launcher's"

report
