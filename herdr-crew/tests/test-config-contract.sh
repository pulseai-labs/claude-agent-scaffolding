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

# Control: the FLAT counter refuses a file it cannot open, in both ways a file can
# be unopenable (#514 fix round 1, finding 1). Its join used to run in a pipeline
# whose status was count_literal's, and count_literal succeeds on empty input — so
# an existing but UNREADABLE file came back as `0` with rc=0 and a flat absence
# check would certify a file nobody read. No flat absence site exists in the suites
# today; the trap did, and this is the control that keeps it shut.
if out="$(occurrences_flat "$tmp_absent" 'anything' 2>&1)"; then
  fail "control: the flat counter refuses a missing file" \
    "it returned a count for a file that does not exist: $out"
elif printf '%s' "$out" | grep -F 'no such file' >/dev/null; then
  pass "control: the flat counter refuses a missing file"
else
  fail "control: the flat counter refuses a missing file" \
    "it failed, but not on the guard: $out"
fi

# …and the case the pipeline hid: an EXISTING, unreadable file. On a root container
# no mode makes a file unreadable for this uid — the sweep's own control above
# documents the same constraint — so the fixture falls back to a dangling symlink.
# Both are refused before awk ever reads, so the refusal below is the same either
# way; the message is checked against the branch that actually fired.
tmp_unreadable="$ctl_dir/unreadable.md"; printf 'nothing personal in here\n' > "$tmp_unreadable"
chmod 000 "$tmp_unreadable"
unreadable_branch='unreadable'
if [ -r "$tmp_unreadable" ]; then
  rm -f "$tmp_unreadable"; ln -s "$tmp_unreadable.absent" "$tmp_unreadable"; unreadable_branch='dangling'
fi
if out="$(occurrences_flat "$tmp_unreadable" 'nothing personal' 2>&1)"; then
  fail "control: the flat counter refuses a file it cannot read" \
    "it returned a count for a file it never opened: $out"
elif [ "$unreadable_branch" = unreadable ] && printf '%s' "$out" | grep -F 'cannot read' >/dev/null; then
  pass "control: the flat counter refuses a file it cannot read (unreadable)"
elif [ "$unreadable_branch" = dangling ] && printf '%s' "$out" | grep -F 'no such file' >/dev/null; then
  pass "control: the flat counter refuses a file it cannot read (dangling link)"
else
  fail "control: the flat counter refuses a file it cannot read" \
    "it failed, but not on the guard the fixture should have hit ($unreadable_branch): $out"
fi
chmod 644 "$tmp_unreadable" 2>/dev/null

# Adjacent control: flat mode still COUNTS an existing, clean file — without it, a
# counter that refused everything would satisfy the two controls above.
if c="$(occurrences_flat "$tmp_countable" 'nothing personal')" && [ "$c" -eq 1 ]; then
  pass "control: the flat counter still counts an existing file"
else
  fail "control: the flat counter still counts an existing file" \
    "an existing file holding one occurrence did not count once in flat mode: ${c:-no output}"
fi

# Control: a flat-mode zero count does not send the reader after a wrap, and the
# per-line one still does. The two halves sit together, so a mode-aware branch that
# dropped the wrap mention everywhere cannot pass this block.
out="$(pin "$tmp_countable" 'zzz-planted-absent-needle' 'control: flat zero' flat 2>&1)"
verdict="$(printf '%s' "$out" | awk '{ if (index($0, "however it wraps") > 0) g=1; if (index($0, "line wrap") > 0) b=1 } END { print g+0 "-" b+0 }')"
if [ "$verdict" = "1-0" ]; then
  pass "control: a flat-mode zero count names no wrap"
else
  fail "control: a flat-mode zero count names no wrap" \
    "expected the flat wording and no wrap (1-0), got $verdict: $out"
fi
out="$(pin "$tmp_countable" 'zzz-planted-absent-needle' 'control: line zero' 2>&1)"
verdict="$(printf '%s' "$out" | awk '{ if (index($0, "line wrap") > 0) b=1 } END { print b+0 }')"
if [ "$verdict" = "1" ]; then
  pass "control: a per-line zero count still names the wrap"
else
  fail "control: a per-line zero count still names the wrap" \
    "the per-line wording lost its wrap mention: $out"
fi

# Every fixture this block created goes before its directory: `tmp_countable` and
# the unreadable one — a chmod-restored regular file here, a dangling symlink under
# root. The `rmdir` is an ASSERTION, not a courtesy: a fixture left behind made it
# fail with a message while the suite still reported success, leaking one temp
# directory per run (fix round 2, class 1).
rm -f "$tmp_countable" "$tmp_unreadable"
if rmdir "$ctl_dir"; then
  pass "control: the counter controls leave no fixture behind"
else
  fail "control: the counter controls leave no fixture behind" \
    "$ctl_dir survived its cleanup — a fixture was not removed before the directory"
fi

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
# passing, so the shape is asserted rather than assumed. The per-suite half runs from every
# suite that sources _helpers.sh — five of the six; test-fidelity-pins.sh is the exemption
# HOISTED_EXEMPT names, and it is the one file that defines these names deliberately. The
# directory-wide half is called ONCE, here — its answer cannot differ between callers, and
# running it from three suites repeated the same violation three times for ~31 awk spawns
# each (fix round 1, finding 12).
section "the hoisted counters are not re-copied"
assert_hoisted_counters
assert_hoist_shape

# Controls: the spelling half of the coverage claim _helpers.sh makes about
# `count_shadows` — every spelling that comment names has its fixture here, so a
# spelling named there without one is the same defect as a control that stops
# matching. Neither a call nor a comment is a definition, and the last fixture is the
# one that defines none at all. `pin` stands for the six names. Every fixture but the
# last was measured twice: `bash -n` accepts it, and a bash that sources it defines the
# function (`declare -F` finds it). The commented signature is the spelling that
# defeated the first version of the matcher; space-inside-parens and continued-brace
# are the two a delta re-review of the fix found still missing.
ctl_sh="$(mktemp -d)"
printf 'pin() {\n  :\n}\n'                      > "$ctl_sh/col0.sh"
printf 'pin () {\n  :\n}\n'                     > "$ctl_sh/spaced-parens.sh"
printf 'pin\t()\t{\n  :\n}\n'                   > "$ctl_sh/tab-separated.sh"
printf '  pin() {\n    :\n  }\n'                > "$ctl_sh/indented.sh"
printf 'function pin {\n  :\n}\n'               > "$ctl_sh/function-keyword.sh"
printf 'function pin() {\n  :\n}\n'             > "$ctl_sh/function-parens.sh"
printf 'function pin () {\n  :\n}\n'            > "$ctl_sh/function-spaced-parens.sh"
printf 'pin()\n{\n  :\n}\n'                     > "$ctl_sh/brace-next-line.sh"
printf 'pin () # copied locally\n{\n  :\n}\n'   > "$ctl_sh/commented-signature.sh"
printf 'pin()\n# a comment between\n{\n  :\n}\n' > "$ctl_sh/comment-between.sh"
printf 'pin()\n\n{\n  :\n}\n'                   > "$ctl_sh/blank-between.sh"
printf 'pin ( ) {\n  :\n}\n'                    > "$ctl_sh/space-inside-parens.sh"
printf 'pin\t(\t)\t{\n  :\n}\n'                 > "$ctl_sh/tab-inside-parens.sh"
printf 'pin () \\\n{\n  :\n}\n'                 > "$ctl_sh/continued-brace.sh"
printf 'pin \\\n() {\n  :\n}\n'                 > "$ctl_sh/continued-name.sh"
printf 'pi\\\nn() {\n  :\n}\n'                  > "$ctl_sh/continued-in-name.sh"
printf '# pin() { a comment is not a definition\npin "$REF" "a call is not a definition"\npin()\nfoo=1\n' \
  > "$ctl_sh/not-a-definition.sh"
for spelling in col0 spaced-parens tab-separated indented function-keyword \
  function-parens function-spaced-parens brace-next-line commented-signature \
  comment-between blank-between space-inside-parens tab-inside-parens \
  continued-brace continued-name continued-in-name; do
  got="$(count_shadows "$ctl_sh/$spelling.sh" pin)"
  if [ "$got" = "1 pin 1" ]; then pass "control: count_shadows catches the $spelling spelling"
  else fail "control: count_shadows catches the $spelling spelling" "got [$got], expected [1 pin 1]"; fi
done
got="$(count_shadows "$ctl_sh/not-a-definition.sh" pin)"
if [ "$got" = 0 ]; then
  pass "control: count_shadows counts no call, comment, or brace-less signature"
else
  fail "control: count_shadows counts no call, comment, or brace-less signature" "got [$got], expected [0]"
fi

# Controls, #599: a definition inside a heredoc BODY is not a definition of the file that
# carries the heredoc. Bash is the judge here and a bash that sources these three defines
# nothing (`declare -F pin`: absent, measured) while the line scan counted the body before
# this change. The quoted and the unquoted delimiter are both measured — the issue's probe
# used both — and `<<-` is the third because its terminator line is tab-stripped first.
printf "cat <<'SHELL_FIXTURE'\npin() {\n  :\n}\nSHELL_FIXTURE\n" > "$ctl_sh/heredoc-quoted.sh"
printf 'cat <<UNQUOTED\npin() {\n  :\n}\nUNQUOTED\n'             > "$ctl_sh/heredoc-unquoted.sh"
printf 'cat <<-TABBED\n\tpin() {\n\t:\n\t}\n\tTABBED\n'          > "$ctl_sh/heredoc-tabbed.sh"
for spelling in heredoc-quoted heredoc-unquoted heredoc-tabbed; do
  got="$(count_shadows "$ctl_sh/$spelling.sh" pin)"
  if [ "$got" = 0 ]; then pass "control: no definition is read inside the $spelling body"
  else fail "control: no definition is read inside the $spelling body" "got [$got], expected [0]"; fi
done
# Adjacent control: the skip must END at the delimiter line. Without this one, a skip that
# ran to the end of the file would satisfy all three controls above and disable the gate —
# and its own expected count is measured, not assumed: the trailing definition is the only
# one this file has, and a bash that sources it defines `pin` (`declare -F`: present).
printf "cat <<'SHELL_FIXTURE'\npin() {\n  :\n}\nSHELL_FIXTURE\npin() {\n  :\n}\n" \
  > "$ctl_sh/heredoc-then-definition.sh"
got="$(count_shadows "$ctl_sh/heredoc-then-definition.sh" pin)"
if [ "$got" = "1 pin 1" ]; then
  pass "control: the skip ends at the delimiter, so a definition after the body counts"
else
  fail "control: the skip ends at the delimiter, so a definition after the body counts" \
    "got [$got], expected [1 pin 1]"
fi
# Adjacent control, the other direction: a `<<` inside a quoted string is text, not an
# operator, so it opens no body to skip. A skip that started on any `<<` would run to the
# end of this fixture and the definition under it would go uncounted.
printf 'echo "a <<not-a-heredoc, inside a quoted string"\npin() {\n  :\n}\n' \
  > "$ctl_sh/quoted-operator.sh"
got="$(count_shadows "$ctl_sh/quoted-operator.sh" pin)"
if [ "$got" = "1 pin 1" ]; then
  pass "control: a << inside a quoted string opens no body to skip"
else
  fail "control: a << inside a quoted string opens no body to skip" "got [$got], expected [1 pin 1]"
fi
# Adjacent control, the same failure class in the one place this suite itself trips it: a
# `<<` in a COMMENT is not an operator either. Measured under the mutation that drops the
# code projection the operator scan shares with `see()`: the comment lines of this very
# block start a skip whose delimiter is a backtick, the scan then reads nothing to the end
# of the file, and a definition appended after those lines counts 0 — in silence.
printf '# a <<comment-heredoc is text\npin() {\n  :\n}\n' > "$ctl_sh/comment-operator.sh"
got="$(count_shadows "$ctl_sh/comment-operator.sh" pin)"
if [ "$got" = "1 pin 1" ]; then
  pass "control: a << in a comment opens no body to skip"
else
  fail "control: a << in a comment opens no body to skip" "got [$got], expected [1 pin 1]"
fi
# Controls, #602 review round 1 finding 1: the comment a line carries must be removed by
# BASH's rule, not by the first `#` on the line — a `#` that is part of a word is part of
# that word. Measured before the fix: both fixtures below counted 0, because the strip took
# the delimiter down to `EOF` / `A ` and the skip then read nothing to the end of the file.
printf 'cat <<EOF#tag\npin() {\n  :\n}\nEOF#tag\npin() {\n  :\n}\n' > "$ctl_sh/hash-in-delimiter.sh"
printf 'cat <<"A #B"\npin() {\n  :\n}\nA #B\npin() {\n  :\n}\n'  > "$ctl_sh/hash-in-quoted-delimiter.sh"
for ctl_delim in hash-in-delimiter hash-in-quoted-delimiter; do
  got="$(count_shadows "$ctl_sh/$ctl_delim.sh" pin)"
  if [ "$got" = "1 pin 1" ]; then
    pass "control: a delimiter holding a # is read whole, so the skip ends where bash ends it ($ctl_delim)"
  else
    fail "control: a delimiter holding a # is read whole, so the skip ends where bash ends it ($ctl_delim)" \
      "got [$got], expected [1 pin 1] — a truncated delimiter makes the skip run past the body"
  fi
done
# Adjacent control for the same rule, the other direction: a `#` that DOES begin a comment,
# in the one word-start position that is not a blank — after `;`. A rule that kept it would
# leave the `<<` in that comment as an operator and skip the rest of the fixture.
printf 'x=1;# a <<comment, after a semicolon\npin() {\n  :\n}\n' > "$ctl_sh/comment-after-semicolon.sh"
got="$(count_shadows "$ctl_sh/comment-after-semicolon.sh" pin)"
if [ "$got" = "1 pin 1" ]; then
  pass "control: a comment that starts a word after ; is removed, so its << opens nothing"
else
  fail "control: a comment that starts a word after ; is removed, so its << opens nothing" \
    "got [$got], expected [1 pin 1]"
fi
# Controls, #602 review round 1 finding 3: an EMPTY delimiter is still a delimiter, and bash
# ends that body at the first empty line. Measured before the fix: both fixtures counted
# `2 pin 2`, while a bash that sources them defines `pin` ONCE — the trailing definition — so
# the body's copy was a shadow this scan invented. Each fixture keeps the trailing definition,
# which is what makes the skip's END measured rather than assumed: a skip that ran to the end
# of the file would count 0.
printf "cat <<''\npin() {\n  :\n}\n\npin() {\n  :\n}\n" > "$ctl_sh/empty-delimiter-single.sh"
printf 'cat <<""\npin() {\n  :\n}\n\npin() {\n  :\n}\n' > "$ctl_sh/empty-delimiter-double.sh"
for ctl_empty in empty-delimiter-single empty-delimiter-double; do
  got="$(count_shadows "$ctl_sh/$ctl_empty.sh" pin)"
  if [ "$got" = "1 pin 1" ]; then
    pass "control: an empty delimiter ends its body at the empty line ($ctl_empty)"
  else
    fail "control: an empty delimiter ends its body at the empty line ($ctl_empty)" \
      "got [$got], expected [1 pin 1] — the body's definition is data and the trailing one is not"
  fi
done
rm -f "$ctl_sh"/*.sh
if rmdir "$ctl_sh"; then
  pass "control: the spelling controls leave no fixture behind"
else
  fail "control: the spelling controls leave no fixture behind" \
    "$ctl_sh survived its cleanup — a fixture was not removed before the directory"
fi

# Controls: the shape scan reports a planted shadow, passes a tree with none, and
# FAILS a suite it cannot read rather than skipping it. All three run the real scan
# through its optional directory argument, captured in a command substitution so the
# counters it moves stay the subshell's.
ctl_tree="$(mktemp -d)"
printf 'occurrences() {\n  :\n}\npin() {\n  :\n}\n' > "$ctl_tree/$HOISTED_EXEMPT"
printf 'pin() {\n  :\n}\n' > "$ctl_tree/test-with-shadow.sh"
out="$(assert_hoist_shape "$ctl_tree")"
if printf '%s' "$out" | grep -F 'no copy of a hoisted counter in test-with-shadow.sh' >/dev/null; then
  pass "control: the shape scan reports a planted shadow"
else
  fail "control: the shape scan reports a planted shadow" "$out"
fi
rm -f "$ctl_tree/test-with-shadow.sh"
printf 'nothing here defines anything\n' > "$ctl_tree/test-clean.sh"
out="$(assert_hoist_shape "$ctl_tree")"
if printf '%s' "$out" | grep -F 'no suite outside the exemption re-defines a hoisted counter' >/dev/null; then
  pass "control: the shape scan passes a tree with no shadow"
else
  fail "control: the shape scan passes a tree with no shadow" "$out"
fi
rm -f "$ctl_tree/test-clean.sh"
# Control, #599's own reproduction at the level the issue measured it: a tree whose only
# suite embeds a fixture in a heredoc defines nothing, so the directory scan must not
# redden it. Measured before this change: it reported `1 pin 1` for that suite, which is
# the RED this control exists to keep out. The planted-shadow control above is its
# adjacent control — a scan that reported nothing at all would pass this one and fail that.
printf "cat <<'SHELL_FIXTURE'\npin() {\n  :\n}\nSHELL_FIXTURE\n" > "$ctl_tree/test-embeds-fixture.sh"
out="$(assert_hoist_shape "$ctl_tree")"
if printf '%s' "$out" | grep -F 'no suite outside the exemption re-defines a hoisted counter' >/dev/null; then
  pass "control: the shape scan reads no shadow from a suite that embeds a fixture in a heredoc"
else
  fail "control: the shape scan reads no shadow from a suite that embeds a fixture in a heredoc" "$out"
fi
rm -f "$ctl_tree/test-embeds-fixture.sh"
# The unreadable case: on a root container no mode makes a file unreadable for this
# uid — the sweep's control above documents the same constraint — so the fixture
# falls back to a dangling symlink. Both fail the same `-r` guard, and the message
# names the file either way.
printf 'pin() {\n  :\n}\n' > "$ctl_tree/test-locked.sh"; chmod 000 "$ctl_tree/test-locked.sh"
if [ -r "$ctl_tree/test-locked.sh" ]; then
  rm -f "$ctl_tree/test-locked.sh"; ln -s "$ctl_tree/test-locked.sh.absent" "$ctl_tree/test-locked.sh"
fi
out="$(assert_hoist_shape "$ctl_tree")"
if printf '%s' "$out" | grep -F 'test-locked.sh cannot be read' >/dev/null; then
  pass "control: the shape scan fails a suite it cannot read"
else
  fail "control: the shape scan fails a suite it cannot read" "$out"
fi
chmod 644 "$ctl_tree/test-locked.sh" 2>/dev/null
rm -f "$ctl_tree/test-locked.sh" "$ctl_tree/$HOISTED_EXEMPT"
if rmdir "$ctl_tree"; then
  pass "control: the scan controls leave no fixture behind"
else
  fail "control: the scan controls leave no fixture behind" \
    "$ctl_tree survived its cleanup — a fixture was not removed before the directory"
fi

# ── controls: the axes the text pass does not own ───────────────────────────
#
# #598 and #600 are one defect: a definition is a definition whatever its body form and
# wherever on its line it starts, and the text scan — line-anchored, and recognising one
# body form — counts several of them 0. Measured on this tree, every spelling below is
# accepted by `bash -n` and defines `pin` when a bash sources it (`declare -F`: present),
# and every one of them is counted 0 by `count_shadows`. So none of these controls decides
# the text pass; they decide the STRUCTURAL half, the definition bash resolved compared
# against the one _helpers.sh loaded. Each runs in its own SUBSHELL — the local `pin` lands
# there and the counters it moves stay there — and each asserts the failure that names the
# structural half and `pin`, NOT the text half's (a control satisfied by either half's
# failure would certify the wrong instrument).
ctl_self="${BASH_SOURCE[0]##*/}"
structural_red() { # <output of assert_hoisted_counters> — the structural failure, naming pin
  case "$1" in *"different definition of:"*"pin"*) ;; *) return 1 ;; esac
  case "$1" in *"line-anchored text scan cannot count"*) ;; *) return 1 ;; esac
  case "$1" in *"every assertion that calls it keeps passing"*) return 1 ;; esac
  return 0
}
structural_clean() { # <output> — both halves report the suite clean
  case "$1" in
    *"no copy of a hoisted counter in $ctl_self"*"the hoisted counters are the ones bash resolved in $ctl_self"*) return 0 ;;
  esac
  return 1
}
for ctl_spelling in \
  'pin() ( : )' \
  'pin() (( 1 ))' \
  'pin() [[ x ]]' \
  'pin() if true; then :; fi' \
  'pin() for i in; do :; done' \
  'pin() while false; do :; done' \
  'pin() until true; do :; done' \
  'pin() case x in x) ;; esac' \
  'pin() select i in; do :; done' \
  'x=1; pin() { :; }' \
  'if true; then pin() { :; }; fi'; do
  out="$( eval "$ctl_spelling"; assert_hoisted_counters )"
  if structural_red "$out"; then
    pass "control: the structural half catches 'pin' spelled as [$ctl_spelling]"
  else
    fail "control: the structural half catches 'pin' spelled as [$ctl_spelling]" \
      "$out — the text pass counts this 0, so this spelling is caught nowhere"
  fi
done
# The spelling no text scan can reach at all: the source carries `eval "pin() { :; }"`,
# which is not a definition to any line scan, and bash resolves a real `pin` from it.
out="$( eval 'pin() { :; }'; assert_hoisted_counters )"
if structural_red "$out"; then
  pass "control: the structural half catches a definition built by eval"
else
  fail "control: the structural half catches a definition built by eval" \
    "$out — no text scan can see this one, so it is this half or nothing"
fi

# The BOUND the division of labour names in _helpers.sh, in both directions. The bound: a
# copy that is byte-identical in bash's own rendering AND does not start its line is
# invisible to both halves. Built from `declare -f`, so the copy cannot drift from the
# definition it copies as this file is edited.
ctl_copy="$(declare -f pin)"
out="$( eval "x=1; $ctl_copy"; assert_hoisted_counters )"
if structural_clean "$out"; then
  pass "control: a byte-identical copy off the line start is invisible to both halves (the named bound)"
else
  fail "control: a byte-identical copy off the line start is invisible to both halves (the named bound)" \
    "$out — if the text pass now counts it or bash resolves something else, the bound in _helpers.sh is wrong"
fi
# The adjacent control, the drift direction: the same copy with ONE body line dropped — the
# shape the pre-hoist copies took when one of them lost its `[ -f ]` guard — must be caught
# here and only here. Measured: the text pass still counts this 0.
ctl_copy_drift="$(printf '%s\n' "$ctl_copy" | awk '!dropped && /empty needle/ { dropped = 1; next } { print }')"
if [ "$ctl_copy_drift" = "$ctl_copy" ]; then
  fail "control: the structural half catches the same copy once it has drifted" \
    "the drift fixture came out identical to the copy — a no-op mutation proves nothing"
else
  out="$( eval "x=1; $ctl_copy_drift"; assert_hoisted_counters )"
  if structural_red "$out"; then
    pass "control: the structural half catches the same copy once it has drifted"
  else
    fail "control: the structural half catches the same copy once it has drifted" \
      "$out — the copy drifted and nothing caught it"
  fi
fi

report
