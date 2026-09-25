#!/usr/bin/env bash
#
# herdr-crew — the ossify spine execution seam, mechanical facts only.
#
# The three-layer model is judgment: when the phase activates, who owns what,
# how a plan relay is scored, what happens at depth exceeded. NONE of that is
# asserted here — pinning judgment as dozens of exact prose clauses turns a
# fidelity guard into a prose-freeze that fails on every rewording, which is the
# failure mode `test-fidelity-pins.sh`'s own header exists to prevent. Those
# belong to the semantic rubric.
#
# What IS mechanical, and is asserted:
#
#   - the SEATS contract: the injected block exists, is used verbatim, halts on
#     a missing row, and no sidecar token survives anywhere in shipped prose
#   - the reviewer's ABSENCE from that block (the seats are not where the
#     reviewer is chosen), scoped to the block itself so prose about reviewer
#     timing cannot satisfy or break it
#   - the three fixed-procedure keys, byte-exact
#   - zero subagent-invocation forms in the activated path's own references
#   - the exact command the spine session is briefed to run
#   - the identities its brief must carry: its report path, its own run.json
#     and the herdr mechanics it follows
#   - the nested run's own mechanical values: the file item bookkeeping lives
#     in, the round barrier's gate node, and the required worker depth
#   - no worker-to-orchestrator message type herdr does not have
#   - the line budget these references are held to
#
# Counting is one awk index() pass: `grep -c` counts LINES, and `… | grep -q`
# can fail on a true match under pipefail. Every zero-count has a non-empty
# control beside it.
#
# Every file this suite reads ships with the plugin: README.md, CHANGELOG.md and
# tests/eval/ included. A missing one FAILS rather than skipping. Until Task 9 the
# three that landed last were guarded by `landed`, which printed a note and
# returned 1 — a wrong path would then read as "not present yet" forever, and a
# zero-count against a file nobody opened is not a clean file.
#
# Usage:   bash herdr-crew/tests/test-ossify-spine-contract.sh
# Exit:    0 if every mechanical fact holds; 1 otherwise.
# Deps:    bash 3.2+, awk.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REF="$PLUGIN_ROOT/skills/orchestrate/references"
EXEC_MD="$REF/ossify-execution.md"
BRIEFS_MD="$REF/ossify-briefs.md"
NESTED_MD="$REF/ossify-nested-run.md"
PRBRIEFS_MD="$REF/ossify-pr-briefs.md"
WRITER_MD="$REF/ossify-close-writer.md"
LIFECYCLE_MD="$REF/lifecycle.md"
ROLES_MD="$REF/roles.md"
GENERIC_BRIEFS_MD="$REF/briefs.md"
SKILL_MD="$PLUGIN_ROOT/skills/orchestrate/SKILL.md"
CONFIG_MD="$REF/config.md"
PLUGIN_README_MD="$PLUGIN_ROOT/README.md"
COMMAND_MD="$PLUGIN_ROOT/commands/orchestrate.md"
MECHANICS_MD="$REF/herdr-mechanics.md"
EVAL_DIR="$PLUGIN_ROOT/tests/eval"
EVAL_FIXTURE14="$EVAL_DIR/fixtures/ossify-spine-execution/14-close-brief-identities-and-workspace-records.md"
EVAL_RUBRIC_MD="$EVAL_DIR/rubrics/ossify-spine-execution.md"
CHANGELOG_MD="$PLUGIN_ROOT/CHANGELOG.md"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

REF_BUDGET=200          # A3: each ossify reference stays under about 200 lines

# occurrences, occurrences_flat, count_of and pin are _helpers.sh's (#514, L1);
# this suite's pin already took <file> <needle> <label> [line|flat], which is the
# shape the other suites adopted when their copies were hoisted. What is left
# here is this suite's own: absent, absent_any, n_eq, nonempty, budget, keys.
#
# `flat` is the fourth argument of pin/present, and it is used only where the
# clause's own text is split by a line wrap today: a per-line pin could assert
# only a fragment of it and would report the clause absent. The squeezed-line
# join lives in _helpers.sh; the join is by SQUEEZING, not by the config suite's
# newline DELETION — those clauses are personal names, which are space-less,
# while these are prose whose words are separated by the very space the wrap
# consumed.

absent() {
  c="$(count_of "$1" "$2" "${4:-line}")" || { fail "$3" "unreadable file: $1"; return 0; }
  if [ "$c" -eq 0 ]; then pass "$3"
  else fail "$3" "'$2' occurs $c time(s) in ${1##*/}"; fi
}

# Every needle must count 0. For a claim whose SPELLING is not fixed, one needle
# asserts less than its label promises: T7's absence pin below counted 0 for four
# honest rewordings of the very claim it was written to keep out. The label here
# describes the whole set, the failure message names the spelling that came back,
# and an empty set is refused — a count over nothing is not a clean file.
absent_any() { # <file> <label> <line|flat> <needle>...
  _file="$1"; _label="$2"; _how="$3"; shift 3
  if [ "$#" -eq 0 ]; then fail "$_label" "no needles — an empty set certifies nothing"; return 0; fi
  _hits=""
  for _needle in "$@"; do
    _c="$(count_of "$_file" "$_needle" "$_how")" || { fail "$_label" "unreadable file: $_file"; return 0; }
    [ "$_c" -eq 0 ] || _hits="$_hits [$_needle x$_c]"
  done
  if [ -z "$_hits" ]; then pass "$_label"
  else fail "$_label" "the claim is back:$_hits"; fi
}

nonempty() {
  if [ -s "$1" ]; then pass "$2"
  else fail "$2" "$1 is missing or empty — every zero-count against it would be vacuous"; fi
}

budget() {
  if [ ! -f "$1" ]; then fail "$2" "no such file: $1"; return 0; fi
  n="$(wc -l < "$1" | tr -d ' ')"
  if [ "$n" -le "$REF_BUDGET" ]; then pass "$2 ($n lines)"
  else fail "$2" "$n lines, over the $REF_BUDGET-line reference budget by $((n - REF_BUDGET))"; fi
}

# keys <file> <from-literal> <to-literal-or-empty> -> sorted `key:` names of
# zero-indent `key: value` lines in that span. An empty <to> runs to the first
# line starting with '## ' after the span opened.
keys() {
  awk -v from="$2" -v to="$3" '
    !seen && index($0, from) > 0 { seen = 1; next }
    seen && to != "" && index($0, to) > 0 { exit }
    seen && to == "" && /^## / { exit }
    seen && /^```[[:space:]]*$/ { exit }
    seen && /^[a-z_]+:/ { k = $0; sub(/:.*$/, "", k); print k }
  ' "$1" | LC_ALL=C sort
}

assert_set() { # <observed> <expected space-separated> <label>
  want="$(printf '%s\n' $2 | LC_ALL=C sort)"
  if [ "$1" = "$want" ]; then pass "$3"
  else
    fail "$3" "expected [$(printf '%s' "$want" | tr '\n' ' ')] — observed [$(printf '%s' "$1" | tr '\n' ' ')]"
  fi
}

printf '%sherdr-crew — ossify spine execution seam (mechanical)%s\n\n' "$DIM" "$RST"

section "the seats contract"

nonempty "$EXEC_MD" "references/ossify-execution.md exists"

# Seats reach a spine session in its brief, not through a file. These are the
# mechanical halves of that: the block exists, it is used verbatim, a missing
# row halts, and no sidecar path survives anywhere in shipped prose.
pin "$BRIEFS_MD" 'SEATS — the operator-approved seats for this spine' \
  "the spine brief carries the seats block"
pin "$BRIEFS_MD" 'A seat this block does not list halts the item and asks' \
  "a missing seat row halts rather than substituting"
for f in "$EXEC_MD" "$NESTED_MD" "$BRIEFS_MD" "$PRBRIEFS_MD" "$WRITER_MD" \
         "$ROLES_MD" "$LIFECYCLE_MD" "$GENERIC_BRIEFS_MD" "$SKILL_MD" \
         "$PLUGIN_README_MD" "$COMMAND_MD"; do
  rel="${f#"$PLUGIN_ROOT"/}"
  # A count of zero from a file nobody read is not a clean file. README.md is
  # swept here like every other carrier — no skip, so a moved or renamed README
  # fails rather than reporting itself absent.
  if [ ! -r "$f" ]; then
    fail "no sidecar reference survives in $rel" "missing or unreadable — the sweep cannot certify a file it cannot open"
    continue
  fi
  gone=0
  for needle in 'sidecar' 'orca-execution.md' 'SIDECAR_OID' 'ORCA_EXECUTION_PATH' 'spine_plan_oid' 'orca-execution/v2'; do
    c="$(occurrences "$f" "$needle")" || c=0
    gone=$((gone + c))
  done
  if [ "$gone" -eq 0 ]; then pass "no sidecar reference survives in $rel"
  else fail "no sidecar reference survives in $rel" "$gone occurrence(s)"; fi
done

pin "$EXEC_MD" 'one implementer and one verifier seat per item' \
  "the top recommends one implementer and one verifier seat per item"
pin "$EXEC_MD" 'the approved seats travel in the brief' \
  "the freeze is the injected brief, not a file on disk"
pin "$EXEC_MD" 'names agents, never commands' \
  "the project file records agent names; the SEATS block resolves the triple"
# The lifecycle never launches a seat by delivering a brief: the launch is
# roles.md's sequence, where delivery is the step after readiness.
pin "$LIFECYCLE_MD" 'is `roles.md`'"'"'s "The launch,"' \
  "the lifecycle launches a seat through roles.md's launch sequence"

# The three procedures were never the sidecar's: they survive the deletion
# byte-exact, still recorded so the spine session checks rather than chooses.
assert_set "$(keys "$EXEC_MD" '## Fixed procedures' '')" \
  "implementation_plan_gate implementer_entrypoint verifier_procedure" \
  "the fixed-procedure block carries exactly its three keys"

pin "$EXEC_MD" 'implementation_plan_gate: worker-authored/top-orchestrator-approved' \
  "the plan gate's value is byte-exact"
pin "$EXEC_MD" 'implementer_entrypoint: /ossify:work-item <handoff path>' \
  "the implementer entry point's value is byte-exact"
# #435: an angle-bracket slot, not a $NAME nothing injects.
absent "$EXEC_MD" '$HANDOFF_PATH' \
  "the entry point spends no uninjected \$NAME"
pin "$EXEC_MD" 'verifier_procedure: all-claims-work-item-verify/v1' \
  "the verifier procedure's value is byte-exact"

section "the reviewer is not in the seats"

# Scoped to the SEATS block, so prose stating WHEN the reviewer is chosen
# neither satisfies nor breaks this. Extract it, then assert on the extract.
tmpl="$(mktemp)"
awk '!seen && index($0, "SEATS — the operator-approved") > 0 { seen = 1 }
     seen && /^[[:space:]]*$/ { exit }
     seen { print }' "$BRIEFS_MD" > "$tmpl"
nonempty "$tmpl" "the SEATS block extracts (control for the counts below)"
for k in 'reviewer' 'code_review'; do
  absent "$tmpl" "$k" "the SEATS block carries no '$k' row"
done
rm -f "$tmpl"

section "no subagent invocation in the activated path"

nonempty "$BRIEFS_MD" "references/ossify-briefs.md exists"
nonempty "$NESTED_MD" "references/ossify-nested-run.md exists"
nonempty "$PRBRIEFS_MD" "references/ossify-pr-briefs.md exists"
nonempty "$WRITER_MD" "references/ossify-close-writer.md exists"
for f in "$EXEC_MD" "$NESTED_MD" "$BRIEFS_MD" "$PRBRIEFS_MD" "$WRITER_MD"; do
  for form in 'Task(' 'Agent(' 'subagent_type'; do
    absent "$f" "$form" "${f##*/} invokes no subagent ('$form')"
  done
done

section "the spine session's briefed command and identities"

pin "$BRIEFS_MD" '/ossify:run-spine $SPINE_ID --external-executor' \
  "the spine-session brief names the external command shape exactly once"
# SPINE_ID is in this list because the brief's TASK spends it — `/ossify:run-spine
# $SPINE_ID --external-executor` — and a brief that spends a name it never injects
# leaves the worker to rediscover it, which is the one thing the block forbids.
# S3a/#446 RF9: the lifecycle id slots are GONE, and herdr prepends nothing to a
# brief, so no id arrives any other way. What the spine session needs from above
# is where to write (REPORT_PATH, one per brief the file holds), the run.json it
# owns (RUN_JSON) and how herdr is driven (MECHANICS). The absence controls live
# one section down.
for id in RUN_JSON SPINE_ID MECHANICS; do
  pin "$BRIEFS_MD" "$id=" "the spine brief injects $id exactly once"
done
n_eq() { c="$(occurrences "$1" "$2")"; if [ "$c" -eq "$3" ]; then pass "$4 ($c)"; else fail "$4" "found $c, expected $3"; fi; }
n_eq "$BRIEFS_MD" 'REPORT_PATH=' 3 \
  "the spine, item implementer and item verifier briefs each name a report path"
# D24: the approved model the banner must match. D28's per-launch revalidation
# becomes the verbatim rule: every item seat launches from its SEATS row.
pin "$BRIEFS_MD" 'SPINE_EXPECTED_MODEL=' \
  "the spine brief injects the approved expected model exactly once"
pin "$BRIEFS_MD" 'SPINE_COMMAND=' \
  "the spine brief injects its own command exactly once"
pin "$BRIEFS_MD" 'SPINE_EFFORT=' \
  "the spine brief injects its own effort exactly once"
pin "$BRIEFS_MD" 'from its SEATS row, verbatim' \
  "every item launch spends its SEATS row, not a re-read file"

section "no lifecycle id slots: every brief names its report path"

# S3a/#446 RF9 + #454 + #447/#450 + #449, mechanical only: the removed declaration
# slots are gone, the new injected identities exist exactly once, the close-review
# halt has a result shape, the contradiction is deleted, and the spine brief
# releases its seats as herdr-mechanics.md's Teardown says (#455's requirement,
# which named the exact close command). The BEHAVIOUR around each (who validates
# what, which branch runs first) is the rubric's, not this file's.
absent "$BRIEFS_MD" 'SPINE_TASK_ID=' \
  "the spine brief no longer declares its own task id"
absent "$BRIEFS_MD" 'SPINE_DISPATCH_ID=' \
  "the spine brief no longer declares its own dispatch id"
for k in 'CLOSE_TASK_ID=' 'CLOSE_DISPATCH_ID=' 'WORKPR_TASK_ID=' 'WORKPR_DISPATCH_ID='; do
  absent "$PRBRIEFS_MD" "$k" "the PR briefs no longer declare '$k'"
done
# The parent's run id routed a question and a completion upward; herdr has no
# channel for either, so the report file replaces it in every coordinator brief.
for f in "$BRIEFS_MD" "$PRBRIEFS_MD" "$WRITER_MD"; do
  absent "$f" 'PARENT_RUN_ID' "${f##*/} carries no parent run id"
done
n_eq "$PRBRIEFS_MD" 'REPORT_PATH=' 2 \
  "the close and work-PR briefs each name a report path"
pin "$WRITER_MD" 'REPORT_PATH=' \
  "the close-review writer's brief names its report path"
for id in RUN_JSON MECHANICS; do
  pin "$PRBRIEFS_MD" "$id=" "the work-PR brief injects $id exactly once"
done
# One mechanic, one statement: the byte-identical anchor the briefs point at.
pin "$MECHANICS_MD" '## Teardown' \
  "herdr-mechanics.md carries the Teardown section the briefs defer to"
pin "$PRBRIEFS_MD" 'CLOSE_EXPECTED_MODEL=' \
  "the close brief injects its ratified expected model exactly once"
pin "$PRBRIEFS_MD" 'WORKPR_EXPECTED_MODEL=' \
  "the work-PR brief injects its ratified expected model exactly once"
pin "$PRBRIEFS_MD" 'PRIOR_REVIEW=' \
  "the work-PR brief injects the prior review record exactly once"
pin "$PRBRIEFS_MD" '"covered"' \
  "PRIOR_REVIEW has a third value for a covered-but-recordless PR"
# N1 (Codex, round 2): "covered" is evidence-gated — a dispatch that crashed
# before its reviewer existed cannot be labelled covered, or the PR merges
# with zero reviews.
pin "$PRBRIEFS_MD" 'durable evidence its delegated review ran' \
  "'covered' is spent only on durable evidence the review ran"
pin "$PRBRIEFS_MD" 'MERGE_EXECUTOR=' \
  "the work-PR brief injects the top's merge-executor assignment exactly once"
pin "$PRBRIEFS_MD" 'halted: close-review' \
  "a close-review halt has its own result shape"
# #449/R3+C1+C2: the close-review writer is a contracted seat — a brief of
# its own with a model gate, budgeted in roles.md, allocated one per affected
# hosting repo. Mechanical: the file exists, the gate is injected once, and the
# allocation rule is stated where the halt remediation lives.
pin "$WRITER_MD" 'WRITER_EXPECTED_MODEL=' \
  "the writer brief gates its ratified expected model"
# N5/#467: REPO= takes the declared target_repo identifier, which exists for a
# remote-less hosting repo too — owner/name assumed a remote.
pin "$WRITER_MD" 'declared `target_repo` identifier' \
  "the writer's REPO= takes the declared target_repo, not owner/name"
absent "$WRITER_MD" 'owner/name' \
  "the owner/name slot wording is gone"
# PR #470 row 3: the writer groups findings by the declared `target_repo` —
# the key the nested-run slice uses — never by the repo a file lives in.
pin "$WRITER_MD" 'by their declared `target_repo`' \
  "writer findings group by the declared target_repo key"
absent "$WRITER_MD" 'each file lives in' \
  "the by-file-location grouping is gone"
pin "$NESTED_MD" 'one writer per affected hosting repo' \
  "fix-now findings spanning repos get a writer each"
absent "$PRBRIEFS_MD" 'per spine at most' \
  "the close-dispatch cap contradiction is gone"
pin "$BRIEFS_MD" 'as MECHANICS'"'"'s Teardown says' \
  "the spine brief releases its seats as herdr-mechanics.md's Teardown says"
pin "$BRIEFS_MD" 'herdr workspace list` showing none of them' \
  "the spine brief's teardown check is none of its own, not none at all"
# R7: the halt path and the completion bullet must name the report file, not
# the deleted declaration slots' phrase.
absent "$BRIEFS_MD" 'injected parent ids' \
  "the spine brief's halt path names no 'injected parent ids'"
absent "$NESTED_MD" 'injected parent ids' \
  "the nested run's halt path names no 'injected parent ids'"
absent "$NESTED_MD" 'the **injected parent**' \
  "the nested run's completion bullet no longer names the injected parent"
pin "$GENERIC_BRIEFS_MD" 'Reviewed head: <sha>' \
  "the reviewer DONE carries its reviewed-head line exactly once"

section "the nested run's mechanical values"

# Mechanical, not judgment: an exact file, an exact node kind and an exact
# number. The prose that carries them moved out of ossify-execution.md, so
# without these the split would leave them asserted nowhere.
pin "$NESTED_MD" 'recorded in `RUN_JSON`, never in your `run.json`' \
  "item bookkeeping lives in the spine session's own run.json"
# dagr keeps one run per file and links none to another: "nested" is the
# session hierarchy, never a dagr feature.
pin "$NESTED_MD" 'links no run to another' \
  "the nested run.json is a separate file, not a dagr link"
pin "$NESTED_MD" 'a gate node (`kind: gate`)' \
  "the round barrier is a gate node in the spine session's run.json"
pin "$NESTED_MD" 'must be `2`' \
  "the required worker depth is byte-exact"

section "no worker-to-orchestrator message type herdr lacks"

# herdr has no worker-to-orchestrator channel: a seat's plan, question,
# escalation and report all go in its report file. The message types of the
# runtime this plugin was ported from must not survive as instructions.
for f in "$EXEC_MD" "$NESTED_MD" "$BRIEFS_MD" "$PRBRIEFS_MD" "$WRITER_MD"; do
  for t in '`ask`' '`escalation`' '`send`' '`reply`'; do
    absent "$f" "$t" "${f##*/} names no $t message type"
  done
done

section "one mechanic, one statement"

# Every launch, send, wait, read and release is stated in herdr-mechanics.md
# and deferred to. Two names are sanctioned in these files: `herdr --skill`,
# the entry point, and `herdr workspace list`, the teardown check. A command
# from any of these groups is a restatement waiting to drift.
for f in "$EXEC_MD" "$NESTED_MD" "$BRIEFS_MD" "$PRBRIEFS_MD" "$WRITER_MD"; do
  for g in 'herdr agent ' 'herdr pane ' 'herdr tab ' 'herdr worktree '; do
    absent "$f" "$g" "${f##*/} restates no '$g' command"
  done
done
# #574, the generic layer's half: briefs.md is where a brief-writer meets the doorbell, so
# it must name what the doorbell compares — the hash or the file's identity — while still
# deferring to herdr-mechanics.md for the rule. The mechanics file states it once (its own
# suite pins that); this pin holds the deferral, not a second statement.
pin "$GENERIC_BRIEFS_MD" 'doorbell compares that file'"'"'s hash or its identity (`herdr-mechanics.md`)' \
  "briefs.md names what the doorbell compares and still defers to herdr-mechanics.md (#574)"

section "the seats block is the freeze, not a file"

# R1-1. The value checks used to pass on an edited-but-still-valid row; now
# there is no file to re-read at all — the block in the brief is the whole
# authority, and a change moves only through the top's reply.
pin "$NESTED_MD" 'Every item launch spends its SEATS row verbatim' \
  "the injected seats block gates every item launch"
pin "$NESTED_MD" 'its reply carries the replacement rows' \
  "a seat change moves through the top's reply, not by re-reading"
pin "$NESTED_MD" 'never re-read the project file' \
  "the spine session does not re-open the project file mid-run"

section "the resolved profile is one contract, stated once"

# Round 2, findings 1-5: a resolved profile carries all five launch fields
# wherever it travels — config.md defines the row once and every carrier
# conforms rather than restating a field list that can drift.
ROW='model_shows: <banner|screen> | brief_delivery: <inject|file>'
pin "$CONFIG_MD" "$ROW" "config.md defines the resolved-profile row"
n_eq "$BRIEFS_MD" "$ROW" 2 "the SEATS rows carry the full resolved profile"
n_eq "$PRBRIEFS_MD" "$ROW" 2 "the work-PR launched profiles carry the full resolved profile"
# Any profile carrier anywhere is complete — no partial rows, and no partial
# enumerations either: prose listing "command, expected model …" without the
# delivery fields is the same defect in a sentence. The sweep runs over every
# shipped surface and the evals, so a seventh site cannot land. The list is
# unconditional: an unmatched fixture glob stays literal and fails the readability
# guard below, rather than being skipped for a directory that has not arrived.
CARRIERS=("$REF"/*.md "$SKILL_MD" "$COMMAND_MD" "$PLUGIN_README_MD"
          "$EVAL_DIR"/fixtures/ossify-spine-execution/*.md "$EVAL_RUBRIC_MD")
for f in "${CARRIERS[@]}"; do
  if [ ! -r "$f" ]; then fail "no partial profile carrier in ${f##*/}" "missing or unreadable: $f"; continue; fi
  n=$(awk 'index($0, "| model:") > 0 && index($0, "brief_delivery") == 0' "$f" | wc -l | tr -d ' ')
  m=$(awk 'index($0, "command, expected model") + index($0, "expected model and effort") > 0 && index($0, "brief-delivery") + index($0, "brief_delivery") == 0' "$f" | wc -l | tr -d ' ')
  if [ "$n" -eq 0 ] && [ "$m" -eq 0 ]; then pass "no partial profile carrier in ${f##*/}"
  else fail "no partial profile carrier in ${f##*/}" "$n partial row(s), $m partial enumeration(s)"; fi
done
# The handoff persists the coordinator profiles beside the item rows — a
# resumed top launches them all without a fresh read.
pin "$EXEC_MD" 'resolved coordinator profiles' \
  "the handoff persists the coordinator profiles beside the item rows"
pin "$LIFECYCLE_MD" 'resolved coordinator' \
  "lifecycle's handoff persists the coordinator profiles"
# can: is a per-role approval check, not a reviewer-only one.
pin "$CONFIG_MD" 'a role whose shipped or declared brief invokes a slash command' \
  "the can: requirement is per role, checked at approval"
n_eq "$CONFIG_MD" '/ossify:run-spine' 2 \
  "the capability table names the spine session's command"
# The effort cell names a seat choice, never a runtime override.
pin "$ROLES_MD" 'the machine entry is the only source of effort' \
  "a marked item is a seat choice, not a command edit"
# The close-review writer is a halt-time profile, not a project-file seat.
pin "$CONFIG_MD" 'close session, work-PR session)' \
  "the writer is not a project-file seat"
# All three missing-file states are stated, not inferred.
pin "$CONFIG_MD" 'Machine file only' "the machine-only state is stated"
pin "$CONFIG_MD" 'Project file only' "the project-only state is stated"

# Round 3, finding 2: a machine-entry field list that names the
# launch-transport fields must name the launch fields too — a partial
# enumeration is the same defect as a partial row.
for f in "${CARRIERS[@]}"; do
  if [ ! -r "$f" ]; then fail "no partial field-name enumeration in ${f##*/}" "missing or unreadable: $f"; continue; fi
  l=$(awk 'index($0, "| model:") > 0 { next }
      { c = (index($0,"command")>0) + (index($0,"expected_model")>0) + (index($0,"effort")>0) + (index($0,"model_shows")>0) + (index($0,"brief_delivery")>0)
        if (c >= 3 && c < 5) print }' "$f" | wc -l | tr -d ' ')
  if [ "$l" -eq 0 ]; then pass "no partial field-name enumeration in ${f##*/}"
  else fail "no partial field-name enumeration in ${f##*/}" "$l line(s) name some launch fields but not all"; fi
done

section "declared roles, capabilities, dispatched commands"

# Round 4 cut: declared roles fire on the top's own paths only — the carry
# mechanism is deferred to issue #500, and the limit is stated where the
# declarer reads it. A return of the mechanism must not silently skip the
# delegated paths again.
pin "$LIFECYCLE_MD" 'not yet carried into a delegated spine or work-PR session' \
  "lifecycle states declared roles do not fire inside delegated sessions"
pin "$LIFECYCLE_MD" 'issue #500' \
  "the limit names the issue holding the work"
absent "$BRIEFS_MD" 'OPERATOR_ROLES' \
  "the spine brief carries no delegated-role slot"
absent "$PRBRIEFS_MD" 'OPERATOR_ROLES' \
  "the work-PR brief carries no delegated-role slot"
absent "$EXEC_MD" 'OPERATOR_ROLES' \
  "the top injects no declared role blocks"

# Round 3, finding 3: the approval check covers every capability a role's
# shipped brief needs — the default run-spine lane spawns subagents.
n_eq "$CONFIG_MD" 'subagents' 3 \
  "the can: vocabulary covers the default lane's Agent tool"
pin "$CONFIG_MD" 'spine session, default lane' \
  "the capability table names the default lane's need"
pin "$CONFIG_MD" 'spine session, external-executor lane' \
  "the capability table names the external lane's need"

# Round 3, finding 4: every dispatched command resolves to a role the project
# file can fill — doctor gets its own seat.
n_eq "$CONFIG_MD" 'doctor session' 2 \
  "doctor session is a project-file role and in the capability table"
pin "$ROLES_MD" 'doctor session' \
  "the seat budget grants a doctor session"
# Next-instance gate: every command SKILL.md lists as dispatched to a herdr
# session must name its `/ossify:` invocation in config.md — a dispatched
# command with no role to fill is the same defect. An anchor that no longer
# matches, or a list that parses to nothing, would pass with nothing checked,
# so both are failures here.
#
# Three pieces, each with its own control below, because this extractor's failure
# mode is a RED that names the wrong fault (#514, L5).
span_of() { # <file> <start-line> — the bullet's own lines, up to the section break
  awk -v s="$2" 'NR<s{next} NR>s && (/^[[:space:]]*$/ || /^- / || /^#/) {exit} {print}' "$1"
}
# One backticked command per line. The span is joined to ONE line first, so a
# token the wrap splits is still one token, then each `…` pair is matched whole by
# a single grep -o. The spelling this replaces converted newlines to spaces,
# converted the backtick to newlines, kept only the EVEN-numbered fields and
# stripped spaces and commas — an even-field assumption that one unpaired
# backtick flips for every token after it. `tr -d '` ,'` reproduces the old token
# shape: a token holding a space or a comma had them removed.
commands_in_span() { # the span arrives on stdin
  tr '\n' ' ' | grep -o '`[^`]*`' | tr -d '` ,'
}
# The span's backtick count must be EVEN, and an odd one is refused with the count
# rather than parsed. Measured: the live span is even (10). An odd count is what
# produces the misleading RED — every token after the stray backtick pairs
# wrongly, so prose fragments reach the config.md check and the per-command
# failures name a fault that is not there. `grep -o` alone does NOT remove that:
# on a fixture with one unpaired backtick, measured, both spellings lose the real
# tokens and both feed a prose fragment to the check. The balance gate is what
# turns that into a RED naming the actual defect.
span_balanced() { # the span arrives on stdin
  _ticks="$(tr -cd '`' | wc -c | tr -d ' ')"
  [ $((_ticks % 2)) -eq 0 ] || { printf '%s' "$_ticks"; return 1; }
  return 0
}
start=$(awk '/Dispatched to a herdr session/{print NR; exit}' "$SKILL_MD")
missing=0
parsed=0
if [ -z "$start" ]; then
  fail "SKILL.md's dispatched-command list is found" "no line reads 'Dispatched to a herdr session'"
else
  span="$(span_of "$SKILL_MD" "$start")"
  if ! ticks="$(printf '%s\n' "$span" | span_balanced)"; then
    fail "SKILL.md's dispatched-command span is a balanced list" \
      "$ticks backticks — an unpaired one flips every token after it, so the per-command failures below would name the wrong fault"
  else
    for cmd in $(printf '%s\n' "$span" | commands_in_span); do
      [ -n "$cmd" ] || continue
      parsed=$((parsed+1))
      if [ "$(occurrences "$CONFIG_MD" "/ossify:$cmd")" -eq 0 ]; then
        missing=$((missing+1)); fail "dispatched command '$cmd' resolves to a role" "no /ossify:$cmd in config.md"
      fi
    done
    if [ "$parsed" -eq 0 ]; then fail "SKILL.md's dispatched-command list parses" "no backticked command after the anchor"
    elif [ "$missing" -eq 0 ]; then pass "every dispatched command resolves to a role in config.md ($parsed)"; fi
  fi
fi

# ── the extractor's controls ────────────────────────────────────────────────
#
# Synthetic spans, shaped like the shipped bullet — a bold lead-in, comma-separated
# backticked commands, a trailing sentence — so each control decides the extractor
# and never the shipped list's content (a literal freeze of that list would fail on
# the next legitimate command). They are fed straight to the extractor as span text:
# `span_of` above is what carves a span out, and it is not what this item changed.
# Every expected value below is a literal, not something the code under test wrote.

# C1 — the wrap. A token the line wrap splits is recovered WHOLE, and its halves
# are not emitted as commands of their own. This pins the newline→space join, the
# one part of the old spelling the replacement keeps: drop it and the token is
# lost (M4 below).
ctl_wrap='- **Dispatched to a herdr session:** `alpha-
  one`, `beta-two`.'
c1="$(printf '%s\n' "$ctl_wrap" | commands_in_span | tr '\n' '|')"
if [ "$c1" = 'alpha-one|beta-two|' ]; then
  pass "control: a command split by the line wrap is recovered whole"
else
  fail "control: a command split by the line wrap is recovered whole" \
    "emitted [$c1], expected [alpha-one|beta-two|] — a lost or split token, not a wrap-joined one"
fi

# C2 — the even-field assumption. With ONE unpaired backtick in the span, no token
# the extractor feeds the config.md check may come from OUTSIDE a backtick pair.
# Measured, that is exactly what the old spelling does: it emits the sentence's
# trailing `.` — the span's tail after the last backtick — and that prose fragment
# is what the per-command RED then names. This is deliberately NOT a claim that the
# real tokens survive an unpaired backtick: measured, they do not, and no
# pairing-based extractor can recover them (the balance gate above is for that).
ctl_unpaired='- **Dispatched to a herdr `session:**
  `alpha-one`, `beta-two`.'
ctl_joined="$(printf '%s\n' "$ctl_unpaired" | tr '\n' ' ')"
ctl_tail="$(printf '%s' "$ctl_joined" | sed 's/.*`//')"
c2_n="$(printf '%s\n' "$ctl_unpaired" | commands_in_span | awk '{ if ($0 == "") next; n++ } END { print n+0 }')"
c2_outside="$(printf '%s\n' "$ctl_unpaired" | commands_in_span | awk -v tail="$ctl_tail" '
  { if ($0 == "") next; if (index(tail, $0) > 0) bad++ }
  END { print bad+0 }')"
if [ "$c2_n" -eq 0 ]; then
  fail "control: an unpaired backtick feeds no prose from outside a pair" \
    "the fixture emitted nothing at all — a control over an empty list certifies nothing"
elif [ "$c2_outside" -eq 0 ]; then
  pass "control: an unpaired backtick feeds no prose from outside a pair ($c2_n emitted, 0 from the span's tail)"
else
  fail "control: an unpaired backtick feeds no prose from outside a pair" \
    "$c2_outside of $c2_n emitted tokens are prose from the span's tail [$ctl_tail]"
fi

# C3 — the balance gate itself. The fixture half must FIRE; the live half is the
# adjacent control, because a gate that refused every span would satisfy the first
# half alone and would make the shipping check above vacuous.
if ticks="$(printf '%s\n' "$ctl_unpaired" | span_balanced)"; then
  fail "control: the balance gate refuses an unpaired backtick" \
    "it passed a span whose backtick count is odd"
else
  pass "control: the balance gate refuses an unpaired backtick ($ticks backticks)"
fi
if printf '%s\n' "$span" | span_balanced; then
  pass "control: the balance gate does not refuse the live span"
else
  fail "control: the balance gate does not refuse the live span" \
    "the shipped span measures unbalanced — the gate is refusing a valid state, and the check above would be skipped"
fi

section "the handoff carries the approved seats"

# R2-1/R2-3, re-expressed: the child is never the source of its own seats — the
# top approves them and injects them; the handoff persists them so a resumed top
# launches from what was approved, not from a fresh read of an edited file.
pin "$EXEC_MD" 'carries the approved seats verbatim' \
  "a top handoff persists the approved seats"
pin "$EXEC_MD" 'asks the operator before any launch that spends an approved seat' \
  "a resumed top without the seats asks before spending one"
# PR #470 row 2: the handoff is the carrier — lifecycle's step 13 lists the
# approved seats and the accumulated close-review ledger on an activated spine,
# and the ask's subject is the resumed top, not the handoff.
pin "$LIFECYCLE_MD" 'the spine'"'"'s approved `SEATS` block' \
  "the top's handoff lists the approved seats block"
pin "$LIFECYCLE_MD" 'close-review ledger' \
  "the top's handoff lists the accumulated close-review ledger"
pin "$EXEC_MD" 'A resumed top whose handoff lacks them asks the operator' \
  "the resumed top, not the handoff, asks before spending a seat"

section "the first verifier failure blocks and asks"

# D25. Mechanical, not judgment: an exact option SET, an exact ORDER (release
# before create), and the absence of the silent path this replaces.
pin "$NESTED_MD" 'correct with the same pair, replace the pair, halt' \
  "the first-failure ask carries exactly its three options"
pin "$NESTED_MD" 'blocks: the pair idles' \
  "the ask blocks; nothing on that item runs until the reply"
pin "$NESTED_MD" 'the old pair is released first' \
  "a replacement releases before it creates"
pin "$NESTED_MD" 'never two pairs live on one item' \
  "one pair per item survives the replacement exception"
pin "$NESTED_MD" 'the top relays the approved row' \
  "a replacement at a different seat goes back through the operator"
# The obvious needle here, 'A second failure escalates to you', spans a line wrap
# in the prose it is meant to forbid, so it would have passed while the sentence
# was still there. Pinned to the contiguous half instead, which counts 1 today.
absent "$NESTED_MD" 'A second failure escalates' \
  "the silent first correction and second-failure escalation are gone"

# R1-3. A fresh pair cannot adopt a staged tree: the ordinary entry point's
# pre-flight requires an empty porcelain, and the correction packet is
# same-executor by construction. So *replace* resets and restarts.
pin "$NESTED_MD" 'the rejected staged work is discarded' \
  "a replacement discards the staged work rather than adopting it"
pin "$NESTED_MD" 'The correction packet is for' \
  "the correction packet is scoped to the correct branch of the ask"

section "halt is a terminal state, and the cap ends in halt only"

# R2-8/R2-12. The third option had no behaviour, and the cap counts executions.
pin "$NESTED_MD" 'halt-shaped report' \
  "a halted item returns a halt-shaped report in the spine session's report file"
pin "$BRIEFS_MD" 'halt-shaped report' \
  "the spine brief carries the same halt return"
pin "$NESTED_MD" 'the ask offers halt only' \
  "an exhausted cap leaves one option"
pin "$BRIEFS_MD" 'the ask offers halt only' \
  "the spine brief carries the exhausted-cap rule"

section "the PR lane runs the review before the command that consumes it"

# R1-2/R1-4/R1-7/R1-10. Order, the second model confirmation, the close's third
# result shape, and the full signal set a disposition covers.
pin "$PRBRIEFS_MD" 'carrying those findings in as its disposition inputs' \
  "the reviewer runs before work-pr, whose disposition takes its findings"
pin "$PRBRIEFS_MD" 'its model as the row'"'"'s `model_shows` says and by the worker'"'"'s own check' \
  "the PR-fix seat's ratified model is spent, not merely injected"
pin "$PRBRIEFS_MD" 'halted: <step>' \
  "the close brief has a third result shape for a halt before any PR opens"
pin "$PRBRIEFS_MD" 'review bodies and top-level PR comments' \
  "a disposition covers all three finding sources, not the bot threads alone"

# R2-2/R2-7. The reviewer body is the sole copy of its findings, and a pushed head
# invalidates the verdict that preceded it.
# R3-1. briefs.md's fix-round brief swaps its TASK for /ossify:work-pr when ossify is
# installed; inside a work-PR session that recurses into a second merge loop.
pin "$PRBRIEFS_MD" 'without the ossify replacement clause' \
  "the PR-fix seat gets the fix-round brief with the recursion removed"
pin "$PRBRIEFS_MD" 'fixed in <sha>' \
  "the fix seat returns per-finding evidence, not a merge"
pin "$GENERIC_BRIEFS_MD" 'except inside a work-PR session' \
  "the replacement clause excludes the seat that would recurse"

# R3-3. work-pr's loop can end at wait or leave-open; DONE could only carry a merge.
pin "$PRBRIEFS_MD" 'open: <PR url> at <head sha>' \
  "an unmerged outcome has a result shape and settles the dispatch"

pin "$PRBRIEFS_MD" 'ONE bounded correction request' \
  "a malformed reviewer body is corrected once, then escalated"
# R3-2 reverts to exactly-once: the reviewer template and lifecycle step 8 forbid a
# second review, so a compliant reviewer would refuse. Staleness is answered by
# re-fetching GitHub's own signals, which the bots regenerate on every push.
pin "$PRBRIEFS_MD" 'released after its report file validates' \
  "the delegated review runs once and its seat is released"
pin "$PRBRIEFS_MD" 're-fetch the GitHub review signals' \
  "each new head is covered by re-fetching the signals, not by a second review"
# N8/#467: the work-PR session's seats get the #455 teardown — release what it
# created as herdr-mechanics.md's Teardown says, then prove the list shows none
# of it. The list is named byte-identical to that file's confirmation.
pin "$PRBRIEFS_MD" 'as MECHANICS'"'"'s Teardown says' \
  "the work-PR session releases its seats as herdr-mechanics.md's Teardown says"
pin "$PRBRIEFS_MD" 'herdr workspace list' \
  "the work-PR session verifies what it created is gone"
pin "$MECHANICS_MD" 'with `herdr workspace list`, never assume' \
  "the confirming list is herdr-mechanics.md's own"
# PR #470 row 4 (settles ledger row 9): the list always shows the top's
# workspaces as well as this session's — the check is none OF THEM, never none
# at all.
pin "$PRBRIEFS_MD" 'herdr workspace list` showing none of them' \
  "the teardown check is none of the session's own, not none at all"
# PR #470 row 5: the budget ate the close seat's question target — restore it.
pin "$PRBRIEFS_MD" 'questions go up to the top in your report file' \
  "the close seat's questions still route to the top"
absent "$PRBRIEFS_MD" 'review a head twice' \
  "the per-head review that contradicted the reviewer template is gone"

# R2-4/R2-5/R2-9/R2-11. The close seat: partial halts, the ceremony own review,
# the ledger the record pass needs, and the route out of a halt.
pin "$PRBRIEFS_MD" 'opened: none' \
  "a halt names the PRs already opened, even when there are none"
pin "$PRBRIEFS_MD" 'the close review the ceremony itself runs' \
  "the ceremony's own review is the seat's work, not a /code-review"
absent "$PRBRIEFS_MD" 'run a review or a fix' \
  "the NEVER no longer forbids the ceremony its own review"
pin "$PRBRIEFS_MD" 'CLOSE_REVIEW_LEDGER=' \
  "the record pass receives the close-review ledger exactly once"
# R1/R15: the halt rule reconciles with ossify's advisory-review prose instead
# of contradicting it. N6/#467: the ledger slot is cumulative — every close
# review's ledger for the spine, oldest first, verbatim — so a clean retry
# drops nothing an earlier review accepted.
pin "$PRBRIEFS_MD" 'ossify keeps that review advisory' \
  "the halt rule names its relation to the ceremony's advisory review"
pin "$PRBRIEFS_MD" 'oldest first' \
  "the ledger slot accumulates every close review's ledger, oldest first"
absent "$PRBRIEFS_MD" 'the most recent close' \
  "the newest-only ledger choice is gone"
# N4/#467: a close-review ledger row names the repo its finding lands in, so a
# multi-repo close splits fix-now findings into per-writer ledgers cleanly.
pin "$PRBRIEFS_MD" 'carrying each finding, its `target_repo`' \
  "the halted close-review ledger names each finding's target_repo"
pin "$PRBRIEFS_MD" 'naming each finding, its `target_repo`' \
  "the verbatim ledger carry names each finding's target_repo"
pin "$NESTED_MD" 'the accepted findings whose `target_repo` is that repo' \
  "a writer's ledger slice is the findings landing in its repo"
# R5: the close DONE's PR-list rule carries the product-hosting-repo
# qualifier (RF7), not the bare phrase every other site had to disambiguate.
absent "$PRBRIEFS_MD" 'one line per hosting repo' \
  "the close DONE counts product hosting repos only"
pin "$PRBRIEFS_MD" 'the top dispatches a fresh close session' \
  "a halt settles the dispatch; the top re-dispatches after remediation"
absent "$PRBRIEFS_MD" 're-invoke close after a halt' \
  "the dead-end NEVER clause is gone"
pin "$NESTED_MD" 'a complete PR list or `closed`' \
  "nothing downstream starts on a partial close"
pin "$NESTED_MD" 'one SUCCESSFUL record pass' \
  "single means one that succeeded, not one attempt"
# #466: the AI-workspace record arm claims no "record branch" — the close writes
# its records where ossify resolves `ai_workspace`, and that repo's own policy
# governs them outside the returned PR list.
pin "$NESTED_MD" 'where ossify resolves `ai_workspace`' \
  "workspace records land where ossify resolves ai_workspace"
absent "$NESTED_MD" 'record branch' \
  "the never-established record-branch claim is gone"
# PR #470 row 1: the eval oracle tracks the same #466 contract — records are
# written where ossify resolves ai_workspace, never a "record branch" no step
# establishes. The rubric wraps the old claim across a line, so its pin is the
# contiguous tail of the old wording. A missing fixture or rubric fails here.
nonempty "$EVAL_FIXTURE14" "eval fixture 14 exists"
pin "$EVAL_FIXTURE14" 'where ossify resolves ai_workspace' \
  "fixture 14's oracle lands records where ossify resolves ai_workspace"
absent "$EVAL_FIXTURE14" 'record branch' \
  "fixture 14's record-branch claim is gone"
nonempty "$EVAL_RUBRIC_MD" "the spine-execution rubric exists"
pin "$EVAL_RUBRIC_MD" 'where ossify resolves `ai_workspace`' \
  "rubric criterion 1 lands records where ossify resolves ai_workspace"
absent "$EVAL_RUBRIC_MD" 'branch under its own policy' \
  "rubric criterion 1's record-branch wording is gone"

section "four seats, one voice"

# D26. Mechanical: the close seat's freshness, the record pass's precondition,
# the exact work-pr invocation the brief injects, and the two names without which
# that invocation cannot be built.
pin "$NESTED_MD" 'always a fresh seat' \
  "the close session is a fresh seat, never the spine driver's"
pin "$NESTED_MD" 'once every returned PR has merged' \
  "the record pass waits for every returned PR"
absent "$NESTED_MD" 'retention threshold' \
  "the close no longer reuses the spine driver under retention"
pin "$PRBRIEFS_MD" 'REPO_ROOT=' \
  "the work-PR brief injects the repo root exactly once"
pin "$PRBRIEFS_MD" '/ossify:work-pr $PR_NUMBER --repo-root $REPO_ROOT' \
  "the work-PR brief names its invocation exactly once"
pin "$PRBRIEFS_MD" 'REVIEW_LEVEL=' \
  "the work-PR brief injects the decided review level"
pin "$PRBRIEFS_MD" 'merge bound to the named SHA' \
  "the work-PR session merges bound to the SHA the top relayed"
pin "$PRBRIEFS_MD" 'never a squash or rebase' \
  "the operator merge path is bound to the merge-commit convention too"
pin "$LIFECYCLE_MD" 'dispatch a work-PR session' \
  "1b dispatches a work-PR session per returned PR"
pin "$SKILL_MD" 'the spine'"'"'s seats in `.herdr-crew/roles.md`' \
  "SKILL.md's write set names the project file"
pin "$ROLES_MD" 'four seats' \
  "roles.md budgets four seats outside the per-item budget"
pin "$ROLES_MD" 'a close-review writer' \
  "the budget names the close-review writer seat"
pin "$ROLES_MD" 'the allowance the project file declares' \
  "the budget grants declared operator roles an explicit allowance"

# R-8. `replaces:` names one identifier set in both files — `implementer`,
# `verifier`, `reviewer` and no synonyms — and the named seat is suppressed, not
# run beside the operator's role.
pin "$CONFIG_MD" '`implementer`, `verifier`, `reviewer`' \
  "the replaces contract names its only valid targets in config.md"
pin "$LIFECYCLE_MD" '`implementer`, `verifier`, `reviewer`' \
  "the replaces contract names its only valid targets in lifecycle.md"
pin "$LIFECYCLE_MD" 'the named seat is not launched' \
  "a replaced built-in is suppressed, not run beside"

# R1-5/R1-6/R1-9. The record pass has a precondition a `closed` return fails; the
# spine seat is launched from its ratified block, not the generic policy; and the
# close is named in ossify's namespace everywhere.
pin "$LIFECYCLE_MD" 'a closed return skips the record pass' \
  "a close that recorded outright goes straight to teardown"
# R2-10. The teardown gate names a merged PR; a `closed` spine never had one.
pin "$LIFECYCLE_MD" 'closed spine has no PR to confirm' \
  "teardown after a closed return validates the local landing instead"
pin "$ROLES_MD" 'the `spine session` seat the project file names' \
  "roles.md launches the spine seat from the project file"
pin "$BRIEFS_MD" 'the `spine session` seat the project file names' \
  "the spine brief header launches from the project file"
absent "$NESTED_MD" '/close <' \
  "the close is always named /ossify:close, never a bare /close"

section "the record pass is conditional and single"

# D27 and the two brief clauses that ride with it (#438, #441).
pin "$NESTED_MD" 'only when the first returned at its open-PR halt' \
  "the record pass has a precondition, not a schedule"
pin "$NESTED_MD" 'is the whole ceremony' \
  "a close that recorded outright gets no second dispatch"
pin "$GENERIC_BRIEFS_MD" 'the level is `medium` unless' \
  "the ordinary reviewer path has a defined default level"
pin "$BRIEFS_MD" 'exactly as found before you write your report file' \
  "the item verifier leaves the worktree as it found it"

section "the release is declared once and agreed everywhere"

# The CHANGELOG's head version is the single declaration; both manifests are
# checked AGAINST it rather than against a literal repeated here, so a bump edits
# one file. The literal below is what stops that from being a round trip. The
# per-issue pins of the plugin this one was ported from record that plugin's
# history, not this one's, so none of them carries over. A missing CHANGELOG
# fails the pin outright rather than reporting itself not present yet.
pin "$CHANGELOG_MD" '## 0.1.0' "the CHANGELOG opens a 0.1.0 section"
head_ver="$(awk '/^## /{sub(/^## /, ""); print; exit}' "$CHANGELOG_MD")"
for m in "$PLUGIN_ROOT/.claude-plugin/plugin.json" "$PLUGIN_ROOT/.codex-plugin/plugin.json"; do
  mv_="$(awk -F'"' '/"version"/{print $4; exit}' "$m")"
  if [ -n "$mv_" ] && [ "$mv_" = "$head_ver" ]; then pass "${m%/*.json} manifest version matches the CHANGELOG head ($mv_)"
  else fail "${m%/*.json} manifest version matches the CHANGELOG head" "manifest '$mv_' vs CHANGELOG '$head_ver'"; fi
done

section "rotation past the context ceiling"

pin "$LIFECYCLE_MD" "## Rotation past the context ceiling" "lifecycle.md carries the rotation section"
pin "$LIFECYCLE_MD" 'resumes by naming the parent'"'"'s `run.json` path' \
  "a new top rebinds the parent run by naming its run.json path"
pin "$BRIEFS_MD" "HANDOFF_PATH=<" "the spine brief takes HANDOFF_PATH"
pin "$BRIEFS_MD" "rotate: <handoff path>" "the spine brief returns rotate: past the ceiling"
pin "$NESTED_MD" "rotate: <handoff path>" "the top's spine-completion step handles rotate:"
pin "$PRBRIEFS_MD" "context-ceiling notice" "the work-PR brief returns open: past the ceiling"

section "waits and completion bodies"

# The typed wait is stated once, in herdr-mechanics.md; lifecycle step 5 and
# roles.md's launch block carry it byte-identical. Three copies or none: T4's
# reviewer measured that roles.md's was unpinned where the brief said all three
# were, so a revert of only that copy left the suite green.
TYPED_WAIT='herdr agent wait <pane> --until done --until idle --until blocked --timeout <ms>'
pin "$MECHANICS_MD" "$TYPED_WAIT" "herdr-mechanics.md states the typed wait once"
pin "$LIFECYCLE_MD" "$TYPED_WAIT" "lifecycle step 5's wait is the typed wait, byte-identical"
pin "$ROLES_MD" "$TYPED_WAIT" "roles.md's launch block carries the same typed wait, byte-identical"
pin "$SKILL_MD" 'A single bounded `herdr agent wait`' \
  "SKILL.md's wait primitive is one bounded agent wait"
# Each dispatched brief names the file its report is written to. Nine templates:
# the generic five, plus the four dedicated dispatch templates in the same file.
n_eq "$GENERIC_BRIEFS_MD" 'REPORT_PATH=<the absolute path this seat writes its report to>' 9 \
  "every dispatched brief names its report path"

section "the clauses the milestone proved revertible"

# T2's and T4's reviewers measured these by mutation: each revert left ALL SIX
# SUITES GREEN. One pin per clause, and the label names the clause rather than
# the count, so a RED reads as a fact. `flat` (the fourth argument) is used only
# where the clause's own text is split by a markdown wrap in the file as it
# stands — the three sites that qualify are named in their comments. A pin whose
# needle has no reachable mutation is noise and none is written here: every pin
# below reverts to a real one-clause edit.

# T2 M-A. The spine dispatch's supply list names the correction body beside the
# two item templates; deleting `and correction templates` left the suite green.
pin "$EXEC_MD" 'item verifier and correction templates' \
  "the spine dispatch's supply list names the correction body"

# T2 M-B. The six atomic-rename REPORT_PATH slots — three spine-layer, two
# PR-layer, one close-review-writer. The `REPORT_PATH=` count pins above count the
# PREFIX, which a revert to a non-atomic mechanism leaves untouched; this is the
# mechanism itself. The writer's slot was the sixth and escaped T2 entirely: its
# finding named five, so "5/5 identical" was measured over the five it knew, and
# this file's slot kept the pre-fix wording for a whole milestone (T7b).
ATOMIC='replaced whole — a temp file in the same directory renamed over the path, never in pieces'
n_eq "$BRIEFS_MD" "$ATOMIC" 3 "all three spine-layer report slots rename atomically"
n_eq "$PRBRIEFS_MD" "$ATOMIC" 2 "both PR-layer report slots rename atomically"
n_eq "$WRITER_MD" "$ATOMIC" 1 "the close-review writer's report slot renames atomically"
# The generic layer's nine, added with the writer's slot in T7b. Not part of the
# six T2's finding named, but the same class and the same file set: measured, a
# revert of ONE of these nine left every suite green, exactly the hole the writer's
# slot was. The set is now 9+3+2+1 = all fifteen slot lines in shipped prose, so a
# revert of any one of them goes RED. The counter is the plain one — measured, this
# needle sits whole on one line in all fifteen, so no `flat` is needed here.
n_eq "$GENERIC_BRIEFS_MD" "$ATOMIC" 9 "all nine generic brief slots rename atomically"

# T2 M-E. The identity anchor: reverting it to a four-part "fingerprint" left the
# suite green. The four ids straddle a wrap, so this is two contiguous halves —
# the capture, then the ids and the contract that declares them.
pin "$NESTED_MD" 'capture the item'"'"'s identity as the result declares it — `head_oid`,' \
  "the nested run's step 5 captures the item identity the result declares"
pin "$NESTED_MD" '`tree_oid`, `report_oid` and `spec_oid`, the four ids the external-executor result envelope' \
  "the identity anchor names all four ids and the contract that declares them"
# #552, and the half that must NOT walk back in: the anchor once claimed these
# four are "the same four the close guard fingerprints", which is false of
# `close/references/work-item-close.md` — it compares no oid. `flat`: the removed
# sentence wrapped between "four the" and "close", so only the squeezed count
# catches a reintroduction that breaks the line somewhere else.
#
# THREE needles, not one, and the label is narrowed to what they assert. Review of
# T7 measured the one-needle form counting 0 for `close-guard fingerprints` (the
# hyphenated spelling that form's own label taught), `close guard's fingerprints`,
# `close guard fingerprint covers` and `fingerprinted by the close guard` — four
# honest rewordings of the claim the pin exists to exclude, each of which it would
# have called absent. The set below catches all four, and both wrap-break positions
# of the hyphenated form (`close-guard` broken at its hyphen squeezes to
# `close- guard`). So the label says the guard is NAMED nowhere rather than that no
# such claim exists. What that still leaves uncovered, and why it is accepted: a
# spelling that makes the claim without naming the guard in any of these three
# forms. Any realistic reintroduction names it, and the residual failure direction
# is the loud one — a future TRUE sentence that merely mentions the close guard
# false-REDs, which its author sees at once.
absent_any "$NESTED_MD" \
  "the identity anchor names no close guard, so it cannot carry the fingerprint claim" flat \
  'close guard' 'close-guard' 'close- guard'

# T4 G1. Reverting roles.md wholesale dropped all of these: the #516c probe
# conditioning — pinned in both of its halves, the profile's and the route's —
# the pilot's F2 precondition, and the teardown pointer.
pin "$ROLES_MD" 'Both files must exist before this sequence is run' \
  "roles.md's launch states the both-files precondition (pilot F2)"
pin "$ROLES_MD" 'a seat is sent one only when' \
  "the context probe is conditioned, not sent to every retained seat"
pin "$ROLES_MD" 'the send route that reaches it' \
  "the probe's second condition is the route, not the profile's can: alone"
pin "$ROLES_MD" 'A seat is released as `herdr-mechanics.md`'"'"'s' \
  "roles.md points teardown at herdr-mechanics.md instead of restating it"

# T8b. The shipped summaries of that conditioning, pinned next door to the rule
# they summarise. T8 rewrote the two it could reach to carry the condition and the
# fallback — the README's parenthetical had asserted a check the excluded class never
# gets — and then MEASURED that reverting both left all six suites green (527/0): the
# rule is pinned above, its summaries were pinned by nothing, so a later edit could
# restore the false reading in silence. `flat` on both, measured rather than assumed:
# each clause's own text is split by a markdown wrap in the file as it stands (per-line
# count 0, squeezed count 1), and the shorter fragment that DOES sit whole on one
# line is a prefix of the clause — what this suite's header says a pin must not
# assert on its own. The needle carries the `roles.md` pointer too, because the
# pointer is half of what the fix is: the summary points, it does not restate.
pin "$PLUGIN_README_MD" 'checked by `/context` at each task boundary for a seat that can answer the probe — one that cannot rotates at its item boundary instead, `references/roles.md`)' \
  "README's retained-implementer summary carries the conditioned probe and its fallback" flat
pin "$SKILL_MD" 'the one `/context` reply at each task boundary for a seat that can answer the probe — one that cannot rotates at its item boundary instead (`references/roles.md`)' \
  "SKILL.md's bounded-reads list conditions the probe and gives the fallback" flat

# Fix round 2, on the whole-branch review's finding 3 and the controller's ruling: the
# third site of the same three, `lifecycle.md` step 5 — the only one that still carried
# one condition until the round above two-conditioned it, and the Open item that round
# flagged rather than pinned, because its brief named two. The ruling: the asymmetry is
# worse than the extra assertion, and a revert of this one would leave the suite green,
# which is the class this milestone spent its last four tasks closing. Same shape, same
# counter, measured the same way: this clause is wrap-split in the file as it stands
# (per-line count 0, squeezed count 1), so `flat`. The needle is the conditioned subject
# and not the sentence's action: `send /context … before attaching the next task` is text
# this fix did not touch, and asserting it would buy false REDs on an honest rewording of
# the action for no extra claim. Not the shorter fragment either (`whose profile can run a
# local slash command and whose send route carries one` measures 1 too) — that is a prefix
# of the clause, which this suite's header says a pin must not assert on its own.
pin "$LIFECYCLE_MD" 'for a retained implementer whose profile can run a local slash command and whose send route carries one' \
  "lifecycle step 5's probe sentence names both conditions the rule turns on" flat

# The whole-branch review's finding 1: README's What-ships row for `briefs.md` counted
# five dispatched templates where the file ships nine — the four ossify dispatch
# templates absent from the listing surface a reader opens first. Measured on a scratch
# copy before this pin existed: with the row reverted to "Five dispatched brief
# templates …", the whole suite stayed green (528/0 — 55 in config, the one assertion a
# standalone clone skips being the repo-root marketplace sweep), so the row was
# revertible in silence, exactly as the reviewer reported. The needle is the clause and
# not the count alone: it names the four templates, because their absence was half the
# finding. Per-line, and it sits whole on the row's one line; a later reword of the row
# fails it loudly rather than silently, which is the direction this suite accepts.
pin "$PLUGIN_README_MD" 'Nine dispatched brief templates — the generic five (planned implementer, fast implementer, reviewer, verifier, fix round) and the four dedicated dispatch templates the ossify dispatches use (lane driver, doctor dispatch, direct work-item, non-spine close)' \
  "README's What-ships row counts the nine dispatched templates and names the four dedicated ones"

# T4 G2. Deleting these from lifecycle.md left the suite green. The last is
# `flat` because the file breaks its line inside the clause today.
pin "$LIFECYCLE_MD" 'creates it again first and binds the id that call returns' \
  "a launch whose run workspace is gone recreates it and rebinds the returned id"
pin "$LIFECYCLE_MD" 'its machine label where the seat is not on this machine, and,' \
  "step 13's handoff records each live seat's machine label"
pin "$LIFECYCLE_MD" 'Write the handoff, recording every seat'"'"'s pane id, with its' \
  "the rotation's own handoff records each live seat's machine label"
pin "$LIFECYCLE_MD" 'through the machine the handoff names for a remote one' \
  "a resumed top re-arms each remote pane through the machine it names" flat

# T4 G3 and the P3 it drew. "`mv`, which this command allows" is a CROSS-FILE
# truth: the dagr write's own sentence and the top's command allowlist are two
# halves of one claim, so both are pinned and they sit together. `flat`: the
# sentence is split at its comma by a wrap in the file as it stands.
pin "$LIFECYCLE_MD" '`mv`, which this command allows' \
  "lifecycle's dagr write names the mv the top's own command allows" flat
pin "$COMMAND_MD" 'Bash(mv:*)' \
  "commands/orchestrate.md's allowlist is what permits that mv"

# T9b. The item verifier is the seat `roles.md` places in a canonical worktree for
# a fresh frame (#537) — the location whose project rules do not load, which is the
# slot's whole purpose — and its template was the one session brief in this file
# without the RULES slot. T1 added the slot to `briefs.md`'s generic reviewer and
# verifier and left this file's item verifier to "a later task"; no later brief
# carried it, and T9's walk found the gap. Measured, the absence was unguarded: at
# that head, with this template's slot missing (199 lines), all six suites were
# green. A count over the file's three session briefs, not a `pin`: the slot line
# is byte-for-byte the same in all three, so there is no unique needle on the line
# itself. The correction message is a send, not a session, and carries none.
# Residual, stated: a slot MOVED between templates in this file would keep the
# count — closing that needs a span helper this suite does not have, and a move is
# not the one-line revert this pin exists to catch. The slot sits flush under
# CLAIMS with the blank line before DONE because the file is at its 200-line gate
# and only one net line fit: measured over the plugin's fifteen shipped slots, the
# blank that FOLLOWS a slot is universal while the leading one is absent in eight,
# so the trailing one is the one to keep.
n_eq "$BRIEFS_MD" 'RULES THAT DO NOT LOAD HERE' 3 \
  "all three session briefs carry the rules slot"

section "reference line budgets"

budget "$EXEC_MD" "ossify-execution.md is within the reference budget"
budget "$NESTED_MD" "ossify-nested-run.md is within the reference budget"
budget "$PRBRIEFS_MD" "ossify-pr-briefs.md is within the reference budget"
budget "$BRIEFS_MD" "ossify-briefs.md is within the reference budget"
budget "$WRITER_MD" "ossify-close-writer.md is within the reference budget"

# #514, L1: the shape, asserted rather than assumed — a counter re-copied into any
# suite shadows the hoisted one and keeps passing. This suite's copies were the
# largest, so it is also the one most worth asserting from.
section "the hoisted counters are not re-copied"
assert_hoisted_counters

report
