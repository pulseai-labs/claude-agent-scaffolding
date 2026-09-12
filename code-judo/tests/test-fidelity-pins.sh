#!/usr/bin/env bash
#
# code-judo — fidelity pins
#
# code-judo is a port. Its value is that specific upstream rules survived the
# adaptation intact, and the failure mode this guards is a later edit quietly
# summarising one of them away — the kind of change that reads fine in a diff
# and is invisible in every other test.
#
# Ten pins, deliberately. Each is one load-bearing rule from the port record on
# issue #382. This list is CAPPED AT TEN: growing it turns a fidelity guard into
# a prose-freeze that fails on every rewording, which is the over-specification
# this repo has paid for before. If a rule matters enough to pin, it displaces
# one of these; it does not extend the list.
#
# Each pin is asserted to occur EXACTLY ONCE in its file. That single check
# carries two properties:
#
#   - contiguity — a pin that spans a markdown line wrap matches zero times, so
#     a passing pin is provably on one line and is not silently checking nothing
#   - uniqueness — a pin matching twice is ambiguous about which occurrence it
#     is guarding, so an edit could delete the real one and still pass
#
# Counting is done with awk's index() in a single pass. `grep -c` counts
# matching LINES rather than occurrences, so it cannot see a duplicate on one
# line, and `grep -q` in a pipeline can fail on a true match under pipefail.
#
# Usage:   bash code-judo/tests/test-fidelity-pins.sh
# Exit:    0 if every pin occurs exactly once; 1 otherwise.
# Deps:    bash 3.2+, awk.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"   # counters, colours, pass/fail, report

PINS=0

# Occurrences of a literal substring in a file. Literal, not regex: index().
occurrences() {
  awk -v needle="$2" '
    {
      line = $0
      while ((i = index(line, needle)) > 0) {
        n++
        line = substr(line, i + length(needle))
      }
    }
    END { print n+0 }
  ' "$1"
}

# pin <relative-path> <literal substring> <what it guards>
pin() {
  rel="$1"; needle="$2"; label="$3"
  PINS=$((PINS+1))
  path="$PLUGIN_ROOT/$rel"

  if [ ! -f "$path" ]; then
    fail "$label" "no such file: $rel"
    return 0
  fi

  count="$(occurrences "$path" "$needle")"
  if [ "$count" -eq 1 ]; then
    pass "$label"
  elif [ "$count" -eq 0 ]; then
    fail "$label" "not found in $rel — either the rule was reworded away, or the pin now spans a line wrap and is checking nothing. pin: $needle"
  else
    fail "$label" "found $count times in $rel — a pin must be unique, or it guards an ambiguous occurrence. pin: $needle"
  fi
}

printf '%scode-judo fidelity pins — ten load-bearing rules from the port record (#382)%s\n\n' "$DIM" "$RST"

pin "skills/deep-review/references/rubric.md" \
  "from under 1000 lines to over 1000 lines" \
  "1/10  the 1000-line rule keeps its threshold"

pin "skills/deep-review/references/rubric.md" \
  "Waive it only where there is a compelling structural reason" \
  "2/10  the 1000-line rule keeps its waiver path"

pin "skills/deep-review/SKILL.md" \
  "**code judo** moves: restructurings that preserve behaviour" \
  "3/10  the ambition standard survives"

pin "skills/deep-review/references/disposition.md" \
  "**One report. One disposition pass. No loop.**" \
  "4/10  the stopping discipline is stated, not implied"

pin "skills/deep-review/references/disposition.md" \
  "the change pushes a file from below 1000 lines to above 1000 lines" \
  "5/10  the presumptive blockers survive"

pin "skills/codebase-design/SKILL.md" \
  "**The deletion test.** Imagine deleting the module." \
  "6/10  the deletion test survives"

pin "skills/codebase-design/SKILL.md" \
  "**One adapter is a hypothetical seam. Two adapters is a real one.**" \
  "7/10  seam discipline survives"

pin "skills/deepen-architecture/SKILL.md" \
  "one of \`Strong\`, \`Worth exploring\`, \`Speculative\`" \
  "8/10  the three strength badges keep their exact labels"

pin "skills/deepen-architecture/SKILL.md" \
  "**Do NOT propose interfaces yet.**" \
  "9/10  the do-not-propose-interfaces-yet gate survives"

pin "skills/deepen-architecture/SKILL.md" \
  "record this as an ADR so future architecture reviews don't re-suggest it?" \
  "10/10  the record-the-rejection ADR framing survives"

# The cap is the point of this file, so it is asserted rather than trusted.
printf '\n'
if [ "$PINS" -eq 10 ]; then
  pass "pin list is capped at 10 (found $PINS)"
else
  fail "pin list is capped at 10" "found $PINS. Adding a pin means replacing one, not appending. See the header."
fi

report
