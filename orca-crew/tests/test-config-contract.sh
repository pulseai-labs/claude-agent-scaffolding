#!/usr/bin/env bash
#
# orca-crew — the configuration contract, mechanical facts only.
#
# What is judgment and NOT asserted here: when a seat should be overridden,
# what a condition should say, whether a role belongs at a named point. Those
# are the semantic rubric's.
#
# What IS mechanical: the two file paths, the agent-entry field set, the
# section headings a project file must use, the fallback rule, the halt rule
# for an undefined seat, the readers rule, and the reference budget.
#
# Counting is one awk index() pass: `grep -c` counts LINES, and `… | grep -q`
# can fail on a true match under pipefail.
#
# Usage:   bash orca-crew/tests/test-config-contract.sh
# Exit:    0 if every mechanical fact holds; 1 otherwise.
# Deps:    bash 3.2+, awk.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_MD="$PLUGIN_ROOT/skills/orchestrate/references/config.md"
REF_BUDGET=200

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

occurrences() {
  if [ -z "${2:-}" ]; then printf 'empty needle\n' >&2; return 1; fi
  [ -f "$1" ] || { printf 'no such file\n' >&2; return 1; }
  awk -v needle="$2" '
    { line = $0
      while ((i = index(line, needle)) > 0) { n++; line = substr(line, i + length(needle)) } }
    END { print n+0 }
  ' "$1"
}

pin() {
  needle="$1"; label="$2"
  count="$(occurrences "$CONFIG_MD" "$needle")" || { fail "$label" "count failed"; return 0; }
  if [ "$count" -eq 1 ]; then pass "$label"
  elif [ "$count" -eq 0 ]; then fail "$label" "not found, or the line wrapped: $needle"
  else fail "$label" "found $count times; a pin must be unique: $needle"; fi
}

present() {
  needle="$1"; label="$2"
  count="$(occurrences "$CONFIG_MD" "$needle")" || { fail "$label" "count failed"; return 0; }
  if [ "$count" -ge 1 ]; then pass "$label"; else fail "$label" "not found: $needle"; fi
}

printf '%sorca-crew configuration contract%s\n\n' "$DIM" "$RST"

section "the two files"
pin '~/.claude/orca-crew/agents.md' "the machine file's path is stated once"
pin '`.orca-crew/roles.md`' "the project file's path is stated once"

section "the agent entry"
for field in 'command:' 'model_shows:' 'brief_delivery:' 'can:' 'note:'; do
  present "$field" "agent field $field is documented"
done
present 'model_shows: banner' "banner is a documented value"
present 'model_shows: screen' "screen is a documented value"
present 'brief_delivery: inject' "inject is a documented value"
present 'brief_delivery: file' "file delivery is a documented value"

section "the project file"
for heading in '## Seats' '## My roles' '## Conditions'; do
  present "$heading" "project-file heading $heading is documented"
done
for key in 'at:' 'agent:' 'blocks:' 'brief:' 'replaces:'; do
  present "$key" "role key $key is documented"
done

section "the rules that must survive a rewording"
pin 'falls back to the agent this session is already running' \
  "the no-file fallback survives"
pin 'a seat name that neither file defines halts the run' \
  "the undefined-seat halt survives"
pin 'Workers never read either file' \
  "the readers rule survives"
pin 'The project file wins' \
  "precedence survives"

section "budget"
if [ -f "$CONFIG_MD" ]; then
  n="$(wc -l < "$CONFIG_MD" | tr -d ' ')"
  if [ "$n" -le "$REF_BUDGET" ]; then pass "config.md within the reference budget ($n lines)"
  else fail "config.md within the reference budget" "$n lines, over by $((n - REF_BUDGET))"; fi
else
  fail "config.md exists" "no such file"
fi

report
