#!/usr/bin/env bash
#
# herdr-crew — the configuration contract, mechanical facts only.
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
# Usage:   bash herdr-crew/tests/test-config-contract.sh
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

printf '%sherdr-crew configuration contract%s\n\n' "$DIM" "$RST"

section "the two files"
pin '~/.claude/herdr-crew/agents.md' "the machine file's path is stated once"
pin '`.herdr-crew/roles.md`' "the project file's path is stated once"

section "the agent entry"
for field in 'command:' 'expected_model:' 'effort:' 'model_shows:' 'brief_delivery:' 'can:' 'note:'; do
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
pin 'the first delegated dispatch' \
  "the no-config halt lands at the first delegated dispatch"

section "budget"
if [ -f "$CONFIG_MD" ]; then
  n="$(wc -l < "$CONFIG_MD" | tr -d ' ')"
  if [ "$n" -le "$REF_BUDGET" ]; then pass "config.md within the reference budget ($n lines)"
  else fail "config.md within the reference budget" "$n lines, over by $((n - REF_BUDGET))"; fi
else
  fail "config.md exists" "no such file"
fi

section "briefs carry their seat inline"
BRIEFS_MD="$PLUGIN_ROOT/skills/orchestrate/references/briefs.md"
brief_pin() {
  needle="$1"; label="$2"; want="$3"
  count="$(awk -v needle="$needle" '
    { line = $0
      while ((i = index(line, needle)) > 0) { n++; line = substr(line, i + length(needle)) } }
    END { print n+0 }' "$BRIEFS_MD")"
  if [ "$count" -eq "$want" ]; then pass "$label ($count)"
  else fail "$label" "found $count, expected $want: $needle"; fi
}
# Five dispatched templates: planned implementer, fast implementer, reviewer,
# verifier, fix round. The correction-request template is a send, not a launch,
# so it carries no seat.
brief_pin 'SEAT_COMMAND=' "every dispatched template names its seat's command" 5
brief_pin 'SEAT_EXPECTED_MODEL=' "every dispatched template names its expected model" 5
brief_pin 'SEAT_EFFORT=' "every dispatched template names its effort" 5
brief_pin 'claude-glm' "no alias name survives in briefs.md" 0

section "the named points exist in the run"
LIFECYCLE_MD="$PLUGIN_ROOT/skills/orchestrate/references/lifecycle.md"
for point in after-implementer before-review after-disposition before-merge-ask at-teardown; do
  c_life="$(awk -v needle="$point" '
    { line = $0
      while ((i = index(line, needle)) > 0) { n++; line = substr(line, i + length(needle)) } }
    END { print n+0 }' "$LIFECYCLE_MD")"
  c_cfg="$(occurrences "$CONFIG_MD" "$point")"
  if [ "$c_life" -ge 1 ] && [ "$c_cfg" -ge 1 ]; then pass "point $point is in both the run and config.md"
  else fail "point $point is in both" "lifecycle=$c_life config=$c_cfg"; fi
done

section "no personal alias or model name ships"
PERSONAL='claude-glm claude-glm-flash claude-sol glm-5.3 Fable'
SWEEP_FILES="$PLUGIN_ROOT/skills/orchestrate/SKILL.md
$PLUGIN_ROOT/commands/orchestrate.md
$PLUGIN_ROOT/README.md
$PLUGIN_ROOT/.claude-plugin/plugin.json
$PLUGIN_ROOT/.codex-plugin/plugin.json"
# The marketplace listing is shipped prose too — same sweep, when the checkout
# carries it (a standalone plugin clone has no repo root).
# CHANGELOG.md is deliberately absent: its historical entries record what
# 0.2.0-0.6.0 actually shipped, names included, and rewriting them would falsify
# the record. The cost of that exclusion is a forward hole — a future entry that
# names a personal alias in its head entry passes this gate. Accepted: head-entry
# sweeping is machinery this release does not need.
if [ -f "$PLUGIN_ROOT/../.claude-plugin/marketplace.json" ]; then
  SWEEP_FILES="$SWEEP_FILES
$PLUGIN_ROOT/../.claude-plugin/marketplace.json"
fi
for f in $SWEEP_FILES "$PLUGIN_ROOT"/skills/orchestrate/references/*.md; do
  rel="${f#"$PLUGIN_ROOT"/}"
  if [ ! -r "$f" ]; then
    fail "no personal name in $rel" "missing or unreadable — the sweep cannot certify a file it cannot open"
    continue
  fi
  hits=0
  for needle in $PERSONAL; do
    c="$(awk -v needle="$needle" '
      { line = $0
        while ((i = index(line, needle)) > 0) { n++; line = substr(line, i + length(needle)) } }
      END { print n+0 }' "$f")"
    hits=$((hits + c))
  done
  if [ "$hits" -eq 0 ]; then pass "no personal name in $rel"
  else fail "no personal name in $rel" "$hits occurrence(s)"; fi
done
# Control: the check can see a name when one is there.
tmp_ctl="$(mktemp)"; printf 'claude-glm\n' > "$tmp_ctl"
ctl="$(awk -v needle='claude-glm' '
  { line = $0
    while ((i = index(line, needle)) > 0) { n++; line = substr(line, i + length(needle)) } }
  END { print n+0 }' "$tmp_ctl")"
rm -f "$tmp_ctl"
if [ "$ctl" -eq 1 ]; then pass "control: the sweep detects a personal name"
else fail "control: the sweep detects a personal name" "control counted $ctl"; fi

# Control: a missing or unreadable file must fail the sweep, not pass it — a
# name-only counting check has no way to distinguish "clean" from "unread",
# and 2026-09-21 fix round 2 found the gate doing exactly that against
# README.md (not yet created; see Task 9). This control plants a file with no
# read permission and asserts the guard's own predicate (`[ ! -r "$f" ]`,
# the same test the sweep loop above uses) catches it.
tmp_unreadable="$(mktemp)"; printf 'claude-glm\n' > "$tmp_unreadable"
chmod 000 "$tmp_unreadable"
if [ -r "$tmp_unreadable" ]; then
  # Running as root, or a filesystem that ignores 0000: this host cannot
  # construct an unreadable file, so the control cannot exercise the guard.
  fail "control: an unreadable file fails the sweep, not passes it" \
    "could not make $tmp_unreadable unreadable on this host (root?) — control could not run"
else
  pass "control: an unreadable file fails the sweep, not passes it"
fi
chmod 644 "$tmp_unreadable" 2>/dev/null
rm -f "$tmp_unreadable"

report
