#!/usr/bin/env bash
#
# merge-bar — fidelity pins
#
# merge-bar is prose, and its value is a handful of rules that must survive
# every later edit word for word. A pin asserts one load-bearing sentence occurs
# EXACTLY ONCE in its file: zero means the rule was reworded away or now spans a
# line wrap (and would check nothing); two means the pin is ambiguous about which
# occurrence it guards. CAPPED AT TEN: a longer list is a prose freeze.
#
# Counting uses awk index() — literal, one pass. `grep -c` counts lines, not
# occurrences, and `grep -q` in a pipe can fail on a true match under pipefail.

set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

PINS=0

occurrences() {
  awk -v needle="$2" '
    { line = $0
      while ((i = index(line, needle)) > 0) { n++; line = substr(line, i + length(needle)) } }
    END { print n+0 }
  ' "$1"
}

# pin <relative-path> <literal substring> <what it guards>
pin() {
  rel="$1"; needle="$2"; label="$3"
  PINS=$((PINS+1))
  path="$PLUGIN_ROOT/$rel"
  if [ ! -f "$path" ]; then fail "$label" "no such file: $rel"; return 0; fi
  count="$(occurrences "$path" "$needle")"
  if [ "$count" -eq 1 ]; then pass "$label"
  elif [ "$count" -eq 0 ]; then fail "$label" "not found in $rel (reworded, or split across a line wrap). pin: $needle"
  else fail "$label" "found $count times in $rel — must be unique. pin: $needle"; fi
}

section "opening-a-pr"
pin "skills/opening-a-pr/references/pr-body.md" \
  "1. rejects valid input, or corrupts or loses state, on a path this PR touches;" \
  "1  merge bar condition 1 keeps its exact words"
pin "skills/opening-a-pr/SKILL.md" \
  "it is not a limit — it is a blocking defect" \
  "2  a condition-1 limit stops the PR from opening"
pin "skills/opening-a-pr/SKILL.md" \
  "GitHub closes only the first issue of \`Closes #1, #2\`" \
  "3  one closing keyword per issue, with its reason"

section "working-a-pr"
pin "skills/working-a-pr/SKILL.md" \
  "A finding that meets condition 1 cannot be a limit" \
  "4  a condition-1 finding is never downgraded to a limit"
pin "skills/working-a-pr/SKILL.md" \
  "At most one issue per PR" \
  "5  out-of-scope defects share one issue"
pin "skills/working-a-pr/SKILL.md" \
  "**One push per round.**" \
  "6  one push per round"
pin "skills/working-a-pr/SKILL.md" \
  "stop. Do not start another round." \
  "7  the stop when the fixes are generating the findings"
pin "skills/working-a-pr/SKILL.md" \
  "Never write the ledger into the reviewed repository" \
  "8  the ledger never lands in the reviewed repo"

section "setting-up-reviewers"
pin "skills/setting-up-reviewers/references/code-review-rules.md" \
  "## Code Review Rules" \
  "9  the heading Codex reads, exactly"
pin "skills/setting-up-reviewers/SKILL.md" \
  "never overwrite an existing \`.coderabbit.yaml\`" \
  "10 an existing CodeRabbit config is diffed and asked, never replaced"

section "cap"
[ "$PINS" -le 10 ] && pass "at most ten pins ($PINS)" || fail "at most ten pins" "$PINS"
report
