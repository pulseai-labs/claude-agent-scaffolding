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
  hits=0
  for needle in $PERSONAL; do
    c="$(awk -v needle="$needle" '
      { line = $0
        while ((i = index(line, needle)) > 0) { n++; line = substr(line, i + length(needle)) } }
      END { print n+0 }' "$f")"
    hits=$((hits + c))
  done
  rel="${f#"$PLUGIN_ROOT"/}"
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

section "the dsh spine driver kind"
DSH_MD="$PLUGIN_ROOT/skills/orchestrate/references/dsh-driver.md"
EXEC_MD="$PLUGIN_ROOT/skills/orchestrate/references/ossify-execution.md"
# Named at least twice since the agent-entries exception (PR review round 1); the
# exact-once pin on that exception, in the section below, is the adjacent control.
present 'kind: dsh-spine-driver' "config.md names the dsh spine driver kind"
present '`dsh-driver.md`' "config.md points at dsh-driver.md"
if [ -f "$DSH_MD" ]; then
  n="$(wc -l < "$DSH_MD" | tr -d ' ')"
  if [ "$n" -le "$REF_BUDGET" ]; then pass "dsh-driver.md within the reference budget ($n lines)"
  else fail "dsh-driver.md within the reference budget" "$n lines, over by $((n - REF_BUDGET))"; fi
  for needle in 'kind: dsh-spine-driver' 'preset: crew-spine' 'model_shows: transcript' \
    'brief_delivery: api' '`.dsh-crew/roles.md`' '`dsh-session`' 'a fresh session' \
    '`presets/crew-spine`' 'diff -rq'; do
    c="$(occurrences "$DSH_MD" "$needle")"
    if [ "$c" -ge 1 ]; then pass "dsh-driver.md: $needle"; else fail "dsh-driver.md: $needle" "not found"; fi
  done
  # The entry block is the kind's contract: a dsh seat is created through the web API, so
  # its entry has no command: line. The block is the lines after the first `### `, up to
  # the closing fence.
  blk="$(awk '/^### /{f=1; next} f && /^```/{exit} f' "$DSH_MD")"
  kinds="$(printf '%s\n' "$blk" | awk '/^kind: dsh-spine-driver$/{n++} END{print n+0}')"
  cmds="$(printf '%s\n' "$blk" | awk '/^command:/{n++} END{print n+0}')"
  if [ "$kinds" -eq 1 ] && [ "$cmds" -eq 0 ]; then pass "the dsh entry block has a kind and no command:"
  else fail "the dsh entry block has a kind and no command:" "kind=$kinds command=$cmds"; fi
  # Pointers to dsh-session, never its call shape.
  api="$(awk 'index($0, "rpcId") + index($0, "/api/session") > 0 {n++} END{print n+0}' "$DSH_MD")"
  if [ "$api" -eq 0 ]; then pass "dsh-driver.md restates no dsh /api call shape"
  else fail "dsh-driver.md restates no dsh /api call shape" "$api line(s)"; fi
else
  fail "dsh-driver.md exists" "no such file"
fi
c="$(occurrences "$EXEC_MD" 'references/dsh-driver.md')"
if [ "$c" -ge 1 ]; then pass "ossify-execution.md routes a dsh spine seat to dsh-driver.md"
else fail "ossify-execution.md routes a dsh spine seat to dsh-driver.md" "not found"; fi

section "the dsh driver's requirement sentences"
# Each is a rule the top's path depends on and no deterministic test can exercise;
# pinned so a rewording cannot drop it (the whole-branch review's six findings).
if [ -f "$DSH_MD" ]; then
  for needle in 'continue <spine-id> from its recorded state' \
    'together or not at all' \
    'the pre-brief gate' \
    '`ASK_CANCELLED` counts' \
    'the turn end only' \
    'nothing downstream is dispatched'; do
    c="$(occurrences "$DSH_MD" "$needle")"
    if [ "$c" -ge 1 ]; then pass "dsh-driver.md keeps: $needle"; else fail "dsh-driver.md keeps: $needle" "not found"; fi
  done
fi
c="$(occurrences "$EXEC_MD" 'before recommending item rows')"
if [ "$c" -ge 1 ]; then pass "ossify-execution.md routes a dsh spine seat before item rows are recommended"
else fail "ossify-execution.md routes a dsh spine seat before item rows are recommended" "not found"; fi

section "the dsh path reaches every surface the top reads first"
# PR review round 1: a top reads config.md, lifecycle 1b, the delegation floor,
# ossify-nested-run.md §4 and the command before dsh-driver.md, so each must admit the
# kind rather than contradict it.
LIFE_MD="$PLUGIN_ROOT/skills/orchestrate/references/lifecycle.md"
NEST_MD="$PLUGIN_ROOT/skills/orchestrate/references/ossify-nested-run.md"
SKILL_MD="$PLUGIN_ROOT/skills/orchestrate/SKILL.md"
CMD_MD="$PLUGIN_ROOT/commands/orchestrate.md"
pin 'a `kind: dsh-spine-driver` entry has no `command:`' "config.md's agent entries admit the dsh kind"
while IFS='|' read -r f needle label; do
  c="$(occurrences "$f" "$needle")" || c=0
  if [ "$c" -ge 1 ]; then pass "$label"; else fail "$label" "not found: $needle"; fi
done <<LIST
$LIFE_MD|A \`kind: dsh-spine-driver\` spine seat|lifecycle 1b hands a dsh spine seat to dsh-driver.md
$SKILL_MD|\`dsh-session\` spawn, steer and cancel calls|the delegation floor admits the dsh calls
$SKILL_MD|a dsh spine driver's transcript reads|the delegation floor admits the transcript reads
$NEST_MD|replaces this section's completion signals|ossify-nested-run.md §4 yields to dsh-driver.md
$CMD_MD|\`.dsh-crew/roles.md\`|the command names the dsh roles file
$DSH_MD|A close session is never rotated|a dsh close finishes past the ceiling
$DSH_MD|never to a successor|a mid-round stop is recovered in the same session
$DSH_MD|\`data.usage.totalTokens\` against|the ceiling is compared in tokens
LIST

report
