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
# Counting is one awk index() pass, hoisted to _helpers.sh with the pin/present
# wrappers (#514, L1): `grep -c` counts LINES, and `… | grep -q` can fail on a
# true match under pipefail.
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

printf '%sherdr-crew configuration contract%s\n\n' "$DIM" "$RST"

section "the two files"
pin "$CONFIG_MD" '~/.claude/herdr-crew/agents.md' "the machine file's path is stated once"
pin "$CONFIG_MD" '`.herdr-crew/roles.md`' "the project file's path is stated once"

section "the agent entry"
for field in 'command:' 'expected_model:' 'effort:' 'model_shows:' 'brief_delivery:' 'can:' 'note:'; do
  present "$CONFIG_MD" "$field" "agent field $field is documented"
done
present "$CONFIG_MD" 'model_shows: banner' "banner is a documented value"
present "$CONFIG_MD" 'model_shows: screen' "screen is a documented value"
present "$CONFIG_MD" 'brief_delivery: inject' "inject is a documented value"
present "$CONFIG_MD" 'brief_delivery: file' "file delivery is a documented value"

section "the project file"
for heading in '## Seats' '## My roles' '## Conditions'; do
  present "$CONFIG_MD" "$heading" "project-file heading $heading is documented"
done
for key in 'at:' 'agent:' 'blocks:' 'brief:' 'replaces:'; do
  present "$CONFIG_MD" "$key" "role key $key is documented"
done

section "the rules that must survive a rewording"
pin "$CONFIG_MD" 'falls back to the agent this session is already running' \
  "the no-file fallback survives"
pin "$CONFIG_MD" 'a seat name that neither file defines halts the run' \
  "the undefined-seat halt survives"
pin "$CONFIG_MD" 'Workers never read either file' \
  "the readers rule survives"
pin "$CONFIG_MD" 'The project file wins' \
  "precedence survives"
pin "$CONFIG_MD" 'the first delegated dispatch' \
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
# The count and its refusal belong to the shared counter: this is the one pin
# whose wanted count is not 1, so it cannot be `pin` itself. Until #514's hoist it
# carried the first of this file's three inline copies of the loop — and, being
# inline, it was the copy that never had the missing-file guard.
brief_pin() {
  needle="$1"; label="$2"; want="$3"
  count="$(occurrences "$BRIEFS_MD" "$needle")" || { fail "$label" "count failed"; return 0; }
  if [ "$count" -eq "$want" ]; then pass "$label ($count)"
  else fail "$label" "found $count, expected $want: $needle"; fi
}
# Nine dispatched templates: planned implementer, fast implementer, reviewer,
# verifier, fix round, and the four dedicated dispatch templates — lane driver,
# doctor dispatch, direct work-item, non-spine close. The correction-request
# template is a send, not a launch, so it carries no seat.
brief_pin 'SEAT_COMMAND=' "every dispatched template names its seat's command" 9
brief_pin 'SEAT_EXPECTED_MODEL=' "every dispatched template names its expected model" 9
brief_pin 'SEAT_EFFORT=' "every dispatched template names its effort" 9
brief_pin 'claude-glm' "no alias name survives in briefs.md" 0

section "the named points exist in the run"
LIFECYCLE_MD="$PLUGIN_ROOT/skills/orchestrate/references/lifecycle.md"
for point in after-implementer before-review after-disposition before-merge-ask at-teardown; do
  c_life="$(occurrences "$LIFECYCLE_MD" "$point")"
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
# CHANGELOG.md is deliberately absent: its historical entries are a record of
# what shipped, and rewriting one to satisfy a sweep would falsify it. The cost
# of that exclusion is a forward hole — a future entry that names a personal
# alias in its head entry passes this gate. Accepted: head-entry sweeping is
# machinery this release does not need.
if [ -f "$PLUGIN_ROOT/../.claude-plugin/marketplace.json" ]; then
  SWEEP_FILES="$SWEEP_FILES
$PLUGIN_ROOT/../.claude-plugin/marketplace.json"
fi
# The sweep body, one file, as a function so the controls below exercise it
# rather than restating it. The loop calls it once per swept file; every control
# calls the same function, so what a control proves is the sweep's own wiring —
# not, as the unreadable-file control did until Task 9, that the OS honours
# chmod 000, and not, as the name-detection control did, that an awk one-liner
# can count. Returns 1 when the file cannot be certified: unreadable, or a name
# counted in it.
sweep_file() {
  f="$1"; rel="$2"
  if [ ! -r "$f" ]; then
    fail "no personal name in $rel" "missing or unreadable — the sweep cannot certify a file it cannot open"
    return 1
  fi
  hits=0
  for needle in $PERSONAL; do
    # The file is read as ONE line, joined by DELETING newlines — never by
    # replacing them with a space. A markdown hard wrap splits a name at its
    # hyphen: `claude-` ends one line and `glm` opens the next. A space-join
    # rebuilds that as `claude- glm` and misses it; deleting rebuilds the name.
    # Deleting can also MANUFACTURE one: a line ending `claude` joined to a line
    # opening `-glm` spells `claude-glm` — measured, per-line 0 and joined 1 on
    # that fixture. The direction is what makes that acceptable, and it is
    # fail-closed: the joined count is monotonically at or above the per-line
    # count, so the join can only fail a file, never certify one, and a false RED
    # is loud. Absent today — per-line and joined agree on all 16 swept files.
    # Until T7 the count was per line, and a wrap-split name was structurally
    # invisible to it: the whole milestone leans on this gate. The unreadable-file
    # guard above stays ahead of this pass, which is what keeps the three controls
    # that call this function exercising the join rather than the read.
    #
    # The DELETING join stays here and is this sweep's own; only the loop moved to
    # `count_literal` in _helpers.sh (#514, L1). Routed through `occurrences` — the
    # per-line counter — the wrap-split name would be invisible again.
    c="$(tr -d '\n' < "$f" | count_literal "$needle")"
    hits=$((hits + c))
  done
  if [ "$hits" -eq 0 ]; then pass "no personal name in $rel"; return 0; fi
  fail "no personal name in $rel" "$hits occurrence(s)"
  return 1
}

for f in $SWEEP_FILES "$PLUGIN_ROOT"/skills/orchestrate/references/*.md; do
  sweep_file "$f" "${f#"$PLUGIN_ROOT"/}"
done

# Control: the check can see a name when one is there. Routed through
# `sweep_file`, so it is the accumulating count that is asserted rather than a
# standalone awk — until fix round 1 this control re-ran its own count, and
# disabling the accumulation inside `sweep_file` left it green.
tmp_ctl="$(mktemp)"; printf 'claude-glm\n' > "$tmp_ctl"
if out="$(sweep_file "$tmp_ctl" "control fixture")"; then
  fail "control: the sweep detects a personal name" \
    "a planted name did not fail the sweep: $out"
elif printf '%s' "$out" | grep -F 'occurrence(s)' >/dev/null; then
  pass "control: the sweep detects a personal name"
else
  fail "control: the sweep detects a personal name" \
    "the sweep failed it, but not on a counted name: $out"
fi
rm -f "$tmp_ctl"

# Control: the same check must still see a name SPLIT BY A MARKDOWN LINE WRAP.
# This is the hole the per-line count had, and the plain plant above cannot see
# it: `claude-` and `glm` on separate lines are each invisible to it, so the
# wrap-aware join is what this control pins. It goes through `sweep_file` like
# the others, and the message is checked, so a failure for any other reason does
# not read as this control passing.
tmp_wrap="$(mktemp)"; printf 'claude-\nglm\n' > "$tmp_wrap"
if out="$(sweep_file "$tmp_wrap" "control fixture")"; then
  fail "control: the sweep detects a name split by a line wrap" \
    "a wrap-split name did not fail the sweep: $out"
elif printf '%s' "$out" | grep -F 'occurrence(s)' >/dev/null; then
  pass "control: the sweep detects a name split by a line wrap"
else
  fail "control: the sweep detects a name split by a line wrap" \
    "the sweep failed it, but not on a counted name: $out"
fi
rm -f "$tmp_wrap"

# Control: a missing or unreadable file must fail the sweep, not pass it — a
# name-only counting check has no way to distinguish "clean" from "unread",
# and 2026-09-21 fix round 2 found the gate doing exactly that against
# README.md (see Task 9). The planted file goes THROUGH `sweep_file`, so the
# loop's own guard is what is asserted; the command substitution isolates the
# planted failure from this suite's own count. The message is checked too:
# a failure for any other reason means the guard is not what fired.
tmp_unreadable="$(mktemp)"; printf 'claude-glm\n' > "$tmp_unreadable"
chmod 000 "$tmp_unreadable"
if [ -r "$tmp_unreadable" ]; then
  # Running as root, or a filesystem that ignores 0000: no mode makes a file
  # unreadable for this uid, so swap in one no uid can read — a symlink whose
  # target does not exist. The control still runs, which is what the documented
  # `bash herdr-crew/run-tests.sh` needs on a root container; failing here
  # instead turned the whole suite red with every product assertion green
  # (Codex, 2026-09-21). The guard asserted below is the same guard either way.
  rm -f "$tmp_unreadable"
  ln -s "$tmp_unreadable.absent" "$tmp_unreadable"
fi
if out="$(sweep_file "$tmp_unreadable" "control fixture")"; then
  fail "control: an unreadable file fails the sweep, not passes it" \
    "the sweep certified a file it could not open: $out"
elif printf '%s' "$out" | grep -F 'missing or unreadable' >/dev/null; then
  pass "control: an unreadable file fails the sweep, not passes it"
else
  fail "control: an unreadable file fails the sweep, not passes it" \
    "the sweep failed it, but for another reason — the guard is not what fired: $out"
fi
chmod 644 "$tmp_unreadable" 2>/dev/null
rm -f "$tmp_unreadable"

# Adjacent control: the same function must PASS a readable, clean file.
# Without it a sweep that failed every file would satisfy the control above.
tmp_clean="$(mktemp)"; printf 'swept, and nothing personal in it\n' > "$tmp_clean"
if out="$(sweep_file "$tmp_clean" "control fixture")" && [ -n "$out" ]; then
  pass "control: the same sweep passes a readable, clean file"
else
  fail "control: the same sweep passes a readable, clean file" \
    "a clean readable file did not pass the sweep: $out"
fi
rm -f "$tmp_clean"

# Control: the hoisted counter refuses a file it cannot open INSTEAD of returning
# a count (#514, L1). This is the guard the copy in test-fidelity-pins.sh does not
# carry, and it is the same failure mode as the unreadable-file control above: a
# count is what a clean file returns, so a counter answering 0 for a file nobody
# opened would certify it. The message is checked too, so a failure for another
# reason does not read as the guard firing.
ctl_dir="$(mktemp -d)"
tmp_absent="$ctl_dir/absent.md"   # never created: the path is the fixture
if out="$(occurrences "$tmp_absent" 'anything' 2>&1)"; then
  fail "control: the hoisted counter refuses a missing file" \
    "it returned a count for a file that does not exist: $out"
elif printf '%s' "$out" | grep -F 'no such file' >/dev/null; then
  pass "control: the hoisted counter refuses a missing file"
else
  fail "control: the hoisted counter refuses a missing file" \
    "it failed, but not on the guard: $out"
fi

# Adjacent control: the same counter must still COUNT an existing, clean file.
# Without it, a counter that refused every file would satisfy the control above —
# which is the mirror of the sweep's own two controls, next to theirs.
tmp_countable="$ctl_dir/countable.md"; printf 'nothing personal in here\n' > "$tmp_countable"
if c="$(occurrences "$tmp_countable" 'nothing personal')" && [ "$c" -eq 1 ]; then
  pass "control: the same counter still counts an existing file"
else
  fail "control: the same counter still counts an existing file" \
    "an existing file holding one occurrence did not count once: ${c:-no output}"
fi
rm -f "$tmp_countable"
rmdir "$ctl_dir"

section "the dsh spine driver kind"
DSH_MD="$PLUGIN_ROOT/skills/orchestrate/references/dsh-driver.md"
EXEC_MD="$PLUGIN_ROOT/skills/orchestrate/references/ossify-execution.md"
# Named at least twice since the agent-entries exception (PR review round 1); the
# exact-once pin on that exception, in the section below, is the adjacent control.
present "$CONFIG_MD" 'kind: dsh-spine-driver' "config.md names the dsh spine driver kind"
present "$CONFIG_MD" '`dsh-driver.md`' "config.md points at dsh-driver.md"
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
pin "$CONFIG_MD" 'a `kind: dsh-spine-driver` entry has no `command:`' "config.md's agent entries admit the dsh kind"
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

# #514, L1: a counter re-copied into any suite shadows the hoisted one and keeps
# passing, so the shape is asserted rather than assumed — here, in the suite the
# fourth copy would most plausibly land beside.
section "the hoisted counters are not re-copied"
assert_hoisted_counters

report
