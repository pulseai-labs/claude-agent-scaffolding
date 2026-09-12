#!/usr/bin/env bash
#
# orca-crew — the ossify spine execution seam, mechanical facts only.
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
#   - the sidecar's SCHEMA: its version string, its header key set, its three
#     fixed-procedure keys, and its assignment table's column set — each by set
#     equality, so a missing column and an added one are equally red
#   - the reviewer's ABSENCE from that schema (the sidecar is not where the
#     reviewer is chosen), scoped to the template block so prose about reviewer
#     timing cannot satisfy or break it
#   - zero subagent-invocation forms in the activated path's own references
#   - the exact command the spine session is briefed to run
#   - the four parent identities its brief must carry
#   - the nested Run's own mechanical values: the flag child traffic names and
#     the required nested worker depth
#   - the line budget these references are held to
#
# Counting is one awk index() pass: `grep -c` counts LINES, and `… | grep -q`
# can fail on a true match under pipefail. Every zero-count has a non-empty
# control beside it.
#
# Usage:   bash orca-crew/tests/test-ossify-spine-contract.sh
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
LIFECYCLE_MD="$REF/lifecycle.md"
ROLES_MD="$REF/roles.md"
GENERIC_BRIEFS_MD="$REF/briefs.md"
SKILL_MD="$PLUGIN_ROOT/skills/orchestrate/SKILL.md"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/_helpers.sh"

REF_BUDGET=200          # A3: each new Orca reference stays under about 200 lines

occurrences() {
  if [ -z "${2:-}" ]; then printf 'empty needle\n' >&2; return 1; fi
  [ -f "$1" ] || { printf 'no such file\n' >&2; return 1; }
  awk -v needle="$2" '
    { line = $0
      while ((i = index(line, needle)) > 0) { n++; line = substr(line, i + length(needle)) } }
    END { print n+0 }' "$1"
}

pin() {
  c="$(occurrences "$1" "$2")" || { fail "$3" "unreadable file or empty needle: $1"; return 0; }
  if [ "$c" -eq 1 ]; then pass "$3"
  elif [ "$c" -eq 0 ]; then fail "$3" "not found in ${1##*/} — reworded away, or the pin now spans a line wrap. pin: $2"
  else fail "$3" "found $c times in ${1##*/}; a pin must be unique. pin: $2"
  fi
}

absent() {
  c="$(occurrences "$1" "$2")" || { fail "$3" "unreadable file: $1"; return 0; }
  if [ "$c" -eq 0 ]; then pass "$3"
  else fail "$3" "'$2' occurs $c time(s) in ${1##*/}"; fi
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

printf '%sorca-crew — ossify spine execution seam (mechanical)%s\n\n' "$DIM" "$RST"

section "the sidecar schema"

nonempty "$EXEC_MD" "references/ossify-execution.md exists"

pin "$EXEC_MD" 'schema: orca-execution/v1' \
  "the sidecar declares its schema version exactly once"

assert_set "$(keys "$EXEC_MD" '# Orca execution assignments' '')" \
  "schema spine_id spine_plan spine_plan_oid ratification ratified_in_run" \
  "the sidecar header carries exactly its six identity fields"

assert_set "$(keys "$EXEC_MD" '## Fixed procedures' '')" \
  "implementation_plan_gate implementer_entrypoint verifier_procedure" \
  "the fixed-procedure block carries exactly its three keys"

pin "$EXEC_MD" 'implementation_plan_gate: worker-authored/top-orchestrator-approved' \
  "the plan gate's value is byte-exact"
pin "$EXEC_MD" 'implementer_entrypoint: /ossify:work-item <handoff path>' \
  "the implementer entry point's value is byte-exact"
# #435: an angle-bracket slot, not a $NAME the sidecar never injects.
absent "$EXEC_MD" '$HANDOFF_PATH' \
  "the entry point spends no uninjected \$NAME"
pin "$EXEC_MD" 'verifier_procedure: all-claims-work-item-verify/v1' \
  "the verifier procedure's value is byte-exact"

# D24: the spine-session seat is a ratified block BESIDE the item table, so the
# table's item-set equality is untouched. Four keys by set equality — a fifth, or
# a reviewer key smuggled in here, is as red as a missing one. This set is also
# the control for dropping the two 'spine_*' needles from the template's absent
# list below, which D24 turned from absences into real keys.
assert_set "$(keys "$EXEC_MD" '## Spine session' '')" \
  "spine_command spine_effort spine_expected_model spine_profile_reason" \
  "the spine-session block carries exactly its four keys"

pin "$EXEC_MD" 'ratified with the item rows in the same phase' \
  "the spine-session block is ratified with the item rows, not separately"
pin "$EXEC_MD" 'its absence halts on an activated spine' \
  "a sidecar with no spine-session block halts"
absent "$EXEC_MD" "follows this skill's lane-driver policy" \
  "the spine-session profile is no longer excluded from the sidecar"

# The assignment table's columns, by set equality: an added reviewer_* or
# spine_* column is as red as a dropped implementer_effort.
hdr="$(awk '/^\| work_item_id \|/ { print; exit }' "$EXEC_MD")"
if [ -n "$hdr" ]; then
  cols="$(printf '%s\n' "$hdr" | tr '|' '\n' | sed 's/^ *//; s/ *$//' | grep -v '^$' | LC_ALL=C sort)"
  assert_set "$cols" \
    "work_item_id implementer_terminal_command implementer_expected_model implementer_effort verifier_terminal_command verifier_expected_model verifier_effort" \
    "the assignment table carries exactly its seven columns"
else
  fail "the assignment table carries exactly its seven columns" "no '| work_item_id |' header row in ossify-execution.md"
fi

section "the reviewer is not in the sidecar"

# Scoped to the template block, so prose stating WHEN the reviewer is chosen
# neither satisfies nor breaks this. Extract it, then assert on the extract.
tmpl="$(mktemp)"
awk '!seen && index($0, "# Orca execution assignments") > 0 { seen = 1 }
     seen { print }
     seen && /^```[[:space:]]*$/ && printed { exit }
     seen { printed = 1 }' "$EXEC_MD" > "$tmpl"
nonempty "$tmpl" "the sidecar template block extracts (control for the counts below)"
for k in 'reviewer_' 'code_review'; do
  absent "$tmpl" "$k" "the sidecar schema carries no '$k' field"
done
rm -f "$tmpl"

section "no subagent invocation in the activated path"

nonempty "$BRIEFS_MD" "references/ossify-briefs.md exists"
nonempty "$NESTED_MD" "references/ossify-nested-run.md exists"
nonempty "$PRBRIEFS_MD" "references/ossify-pr-briefs.md exists"
for f in "$EXEC_MD" "$NESTED_MD" "$BRIEFS_MD" "$PRBRIEFS_MD"; do
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
# `SPINE_ID=` is not a substring of `SPINE_TASK_ID=` or `SPINE_DISPATCH_ID=`, so the
# exactly-once count is unambiguous.
for id in PARENT_RUN_ID SPINE_TASK_ID SPINE_DISPATCH_ID SPINE_ID ORCA_EXECUTION_PATH; do
  pin "$BRIEFS_MD" "$id=" "the brief injects $id exactly once"
done
# D24/D28: the ratified model the banner must match, and the revalidation that
# runs before EVERY item launch rather than once at step 1.
pin "$BRIEFS_MD" 'SPINE_EXPECTED_MODEL=' \
  "the spine brief injects the ratified expected model exactly once"
pin "$BRIEFS_MD" 'immediately before each item terminal is created' \
  "the sidecar is revalidated before every item launch"

section "the nested Run's mechanical values"

# Mechanical, not judgment: an exact flag and an exact number. The prose that
# carries them moved out of ossify-execution.md, so without these two the split
# would leave them asserted nowhere.
pin "$NESTED_MD" '--run $CHILD_RUN_ID' \
  "child task traffic names the child Run explicitly"
pin "$NESTED_MD" 'must be `2`' \
  "the required nested worker depth is byte-exact"

section "the sidecar is identical at every launch, not merely valid"

# R1-1. The value checks pass on an edited-but-still-valid row, so identity of the
# FILE is what catches a changed terminal command. Mechanical: a recorded blob id
# and an equality requirement, plus the one way the baseline may move.
pin "$NESTED_MD" 'Every item launch requires that same blob id' \
  "the recorded sidecar blob id gates every item launch"
# R2-3 re-words this rule around the injected name; the rule is unchanged.
pin "$NESTED_MD" 'names the new `SIDECAR_OID`' \
  "a sidecar rewrite moves the baseline through the reply, not by re-reading"
pin "$BRIEFS_MD" 'require the hash to still equal the baseline' \
  "the spine brief carries the same baseline into its per-launch check"

section "the sidecar baseline is the top's, and it is quoted"

# R2-1/R2-3. The child cannot be the source of its own baseline: a sidecar edited
# between ratification and step 1 would become it. The top records the oid when it
# writes the file and injects it; step 1 proves equality. And the hash is of the
# PATH's contents, so the expansion must be quoted.
pin "$BRIEFS_MD" 'git hash-object "$ORCA_EXECUTION_PATH"' \
  "the sidecar hash reads the injected path, quoted"
absent "$BRIEFS_MD" 'git hash-object ORCA_EXECUTION_PATH' \
  "the unquoted literal-name form is gone"
pin "$BRIEFS_MD" 'SIDECAR_OID=' \
  "the spine brief injects the ratified sidecar oid exactly once"
pin "$BRIEFS_MD" 'must equal SIDECAR_OID' \
  "step 1 proves the file on disk is the ratified one"
pin "$EXEC_MD" 'records that blob id as SIDECAR_OID' \
  "the top records the oid at write time, not the child at read time"

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
pin "$NESTED_MD" 'a sidecar rewrite' \
  "a replacement at a different profile goes back through ratification"
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
pin "$NESTED_MD" 'halt-shaped worker_done' \
  "a halted item returns a halt-shaped completion on the injected parent ids"
pin "$BRIEFS_MD" 'halt-shaped worker_done' \
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
pin "$PRBRIEFS_MD" 'confirm PRFIX_EXPECTED_MODEL from its banner' \
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
pin "$PRBRIEFS_MD" 'released after its worker_done validates' \
  "the delegated review runs once and its seat is released"
pin "$PRBRIEFS_MD" 're-fetch the GitHub review signals' \
  "each new head is covered by re-fetching the signals, not by a second review"
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
pin "$PRBRIEFS_MD" 'the top dispatches a fresh close session' \
  "a halt settles the dispatch; the top re-dispatches after remediation"
absent "$PRBRIEFS_MD" 're-invoke close after a halt' \
  "the dead-end NEVER clause is gone"
pin "$NESTED_MD" 'a complete PR list or `closed`' \
  "nothing downstream starts on a partial close"
pin "$NESTED_MD" 'one SUCCESSFUL record pass' \
  "single means one that succeeded, not one attempt"

section "four seats, one voice"

# D26. Mechanical: the close seat's freshness, the record pass's precondition,
# the exact work-pr invocation the brief injects, and the two names without which
# that invocation cannot be built.
pin "$NESTED_MD" 'always a fresh terminal' \
  "the close session is a fresh terminal, never the spine driver's"
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
pin "$LIFECYCLE_MD" 'dispatch a work-PR session' \
  "1b dispatches a work-PR session per returned PR"
pin "$SKILL_MD" 'the `orca-execution.md` sidecar' \
  "SKILL.md's write set names the sidecar"
pin "$ROLES_MD" 'three seats' \
  "roles.md budgets three seats outside the per-item budget"

# R1-5/R1-6/R1-9. The record pass has a precondition a `closed` return fails; the
# spine seat is launched from its ratified block, not the generic policy; and the
# close is named in ossify's namespace everywhere.
pin "$LIFECYCLE_MD" 'a closed return skips the record pass' \
  "a close that recorded outright goes straight to teardown"
# R2-10. The teardown gate names a merged PR; a `closed` spine never had one.
pin "$LIFECYCLE_MD" 'closed spine has no PR to confirm' \
  "teardown after a closed return validates the local landing instead"
pin "$ROLES_MD" 'from the ratified spine_session block' \
  "roles.md launches the spine seat from the sidecar block"
pin "$BRIEFS_MD" 'from the ratified spine_session block' \
  "the spine brief header launches from the sidecar block"
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
pin "$BRIEFS_MD" 'exactly as found before `worker_done`' \
  "the item verifier leaves the worktree as it found it"

section "the release is declared once and agreed everywhere"

# The CHANGELOG's head version is the single declaration; both manifests are
# checked AGAINST it rather than against a literal repeated here, so a bump edits
# one file. The literal below is what stops that from being a round trip.
CHANGELOG_MD="$PLUGIN_ROOT/CHANGELOG.md"
pin "$CHANGELOG_MD" '## 0.4.0' "the CHANGELOG opens a 0.4.0 section"
for d in D24 D25 D26 D27 D28; do
  pin "$CHANGELOG_MD" "- **$d" "the CHANGELOG records $d exactly once"
done
head_ver="$(awk '/^## /{sub(/^## /, ""); print; exit}' "$CHANGELOG_MD")"
for m in "$PLUGIN_ROOT/.claude-plugin/plugin.json" "$PLUGIN_ROOT/.codex-plugin/plugin.json"; do
  mv_="$(awk -F'"' '/"version"/{print $4; exit}' "$m")"
  if [ "$mv_" = "$head_ver" ]; then pass "${m%/*.json} manifest version matches the CHANGELOG head ($mv_)"
  else fail "${m%/*.json} manifest version matches the CHANGELOG head" "manifest '$mv_' vs CHANGELOG '$head_ver'"; fi
done

section "reference line budgets"

budget "$EXEC_MD" "ossify-execution.md is within the reference budget"
budget "$NESTED_MD" "ossify-nested-run.md is within the reference budget"
budget "$PRBRIEFS_MD" "ossify-pr-briefs.md is within the reference budget"
budget "$BRIEFS_MD" "ossify-briefs.md is within the reference budget"

report
