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
#   - the SEATS contract: the injected block exists, is used verbatim, halts on
#     a missing row, and no sidecar token survives anywhere in shipped prose
#   - the reviewer's ABSENCE from that block (the seats are not where the
#     reviewer is chosen), scoped to the block itself so prose about reviewer
#     timing cannot satisfy or break it
#   - the three fixed-procedure keys, byte-exact
#   - zero subagent-invocation forms in the activated path's own references
#   - the exact command the spine session is briefed to run
#   - the parent identities its brief must carry
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
WRITER_MD="$REF/ossify-close-writer.md"
LIFECYCLE_MD="$REF/lifecycle.md"
ROLES_MD="$REF/roles.md"
GENERIC_BRIEFS_MD="$REF/briefs.md"
SKILL_MD="$PLUGIN_ROOT/skills/orchestrate/SKILL.md"
CONFIG_MD="$REF/config.md"
PLUGIN_README_MD="$PLUGIN_ROOT/README.md"
COMMAND_MD="$PLUGIN_ROOT/commands/orchestrate.md"
EVAL_FIXTURE14="$PLUGIN_ROOT/tests/eval/fixtures/ossify-spine-execution/14-close-brief-identities-and-workspace-records.md"
EVAL_RUBRIC_MD="$PLUGIN_ROOT/tests/eval/rubrics/ossify-spine-execution.md"

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
absent "$LIFECYCLE_MD" 'dispatch --inject' \
  "the lifecycle never launches a seat by inject"

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
# S3a/#446 RF9: the lifecycle id slots are GONE — a brief cannot know its own
# task/dispatch ids before `dispatch --inject` exists, so the spine session takes
# them from the Orca preamble instead. The absence controls live one section down.
for id in PARENT_RUN_ID SPINE_ID; do
  pin "$BRIEFS_MD" "$id=" "the brief injects $id exactly once"
done
# D24: the approved model the banner must match. D28's per-launch revalidation
# becomes the verbatim rule: every item terminal launches from its SEATS row.
pin "$BRIEFS_MD" 'SPINE_EXPECTED_MODEL=' \
  "the spine brief injects the approved expected model exactly once"
pin "$BRIEFS_MD" 'SPINE_COMMAND=' \
  "the spine brief injects its own command exactly once"
pin "$BRIEFS_MD" 'SPINE_EFFORT=' \
  "the spine brief injects its own effort exactly once"
pin "$BRIEFS_MD" 'from its SEATS row, verbatim' \
  "every item launch spends its SEATS row, not a re-read file"

section "lifecycle ids come from the preamble, not from brief slots"

# S3a/#446 RF9 + #454 + #447/#450 + #449, mechanical only: the removed declaration
# slots are gone, the new injected identities exist exactly once, the close-review
# halt has a result shape, the contradiction is deleted, and the spine brief names
# the terminal-close command that #455 requires. The BEHAVIOUR around each (who
# validates what, which branch runs first) is the rubric's, not this file's.
absent "$BRIEFS_MD" 'SPINE_TASK_ID=' \
  "the spine brief no longer declares its own task id"
absent "$BRIEFS_MD" 'SPINE_DISPATCH_ID=' \
  "the spine brief no longer declares its own dispatch id"
for k in 'CLOSE_TASK_ID=' 'CLOSE_DISPATCH_ID=' 'WORKPR_TASK_ID=' 'WORKPR_DISPATCH_ID='; do
  absent "$PRBRIEFS_MD" "$k" "the PR briefs no longer declare '$k'"
done
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
pin "$BRIEFS_MD" 'orca terminal close --terminal' \
  "the spine brief names the exact terminal-close command"
# R7: the halt path and the completion bullet must spend the preamble's
# identities, not the deleted declaration slots' phrase.
absent "$BRIEFS_MD" 'injected parent ids' \
  "the spine brief's halt path names no 'injected parent ids'"
absent "$NESTED_MD" 'injected parent ids' \
  "the nested Run's halt path names no 'injected parent ids'"
absent "$NESTED_MD" 'the **injected parent**' \
  "the nested Run's completion bullet names preamble identities"
pin "$GENERIC_BRIEFS_MD" 'Reviewed head: <sha>' \
  "the reviewer DONE carries its reviewed-head line exactly once"

section "the nested Run's mechanical values"

# Mechanical, not judgment: an exact flag and an exact number. The prose that
# carries them moved out of ossify-execution.md, so without these two the split
# would leave them asserted nowhere.
pin "$NESTED_MD" '--run $CHILD_RUN_ID' \
  "child task traffic names the child Run explicitly"
pin "$NESTED_MD" 'must be `2`' \
  "the required nested worker depth is byte-exact"

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
n_eq() { c="$(occurrences "$1" "$2")"; if [ "$c" -eq "$3" ]; then pass "$4 ($c)"; else fail "$4" "found $c, expected $3"; fi; }
n_eq "$BRIEFS_MD" "$ROW" 2 "the SEATS rows carry the full resolved profile"
n_eq "$PRBRIEFS_MD" "$ROW" 2 "the work-PR launched profiles carry the full resolved profile"
# Any profile carrier anywhere is complete — no partial rows, and no partial
# enumerations either: prose listing "command, expected model …" without the
# delivery fields is the same defect in a sentence. The sweep runs over every
# shipped surface and the evals, so a seventh site cannot land.
for f in "$REF"/*.md "$SKILL_MD" "$PLUGIN_README_MD" "$COMMAND_MD" \
         "$PLUGIN_ROOT"/tests/eval/fixtures/ossify-spine-execution/*.md \
         "$EVAL_RUBRIC_MD"; do
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
pin "$CONFIG_MD" '/ossify:run-spine' \
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
pin "$PRBRIEFS_MD" 'its model as the row'"'"'s `model_shows` says and from the first reply' \
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
# N8/#467: the work-PR session's alias-launched seats get the #455 teardown —
# close each terminal it created, then prove the list shows none of them.
pin "$PRBRIEFS_MD" 'orca terminal close --terminal <handle>' \
  "the work-PR session closes each terminal it created"
pin "$PRBRIEFS_MD" 'orca terminal list' \
  "the work-PR session verifies its terminals are gone"
# PR #470 row 4 (settles ledger row 9): the list always shows the top's and
# this session's own terminals — the check is none OF THEM, never none at all.
pin "$PRBRIEFS_MD" 'orca terminal list` showing none of them' \
  "the teardown check is none of the session's terminals, not none at all"
# PR #470 row 5: the budget ate the close seat's ask target — restore it.
pin "$PRBRIEFS_MD" 'questions go up to the top with `ask`' \
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
  "the 0.5.0 newest-only ledger choice is gone"
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
# contiguous tail of the old wording.
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
pin "$PRBRIEFS_MD" 'never a squash or rebase' \
  "the operator merge path is bound to the merge-commit convention too"
pin "$LIFECYCLE_MD" 'dispatch a work-PR session' \
  "1b dispatches a work-PR session per returned PR"
pin "$SKILL_MD" 'the spine'"'"'s seats in `.orca-crew/roles.md`' \
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
pin "$BRIEFS_MD" 'exactly as found before `worker_done`' \
  "the item verifier leaves the worktree as it found it"

section "the release is declared once and agreed everywhere"

# The CHANGELOG's head version is the single declaration; both manifests are
# checked AGAINST it rather than against a literal repeated here, so a bump edits
# one file. The literal below is what stops that from being a round trip.
CHANGELOG_MD="$PLUGIN_ROOT/CHANGELOG.md"
pin "$CHANGELOG_MD" '## 0.5.0' "the CHANGELOG opens a 0.5.0 section"
for b in '#446' '#447' '#453' '#454' '#455' '#448' '#449'; do
  pin "$CHANGELOG_MD" "- **$b" "the CHANGELOG records $b exactly once"
done
pin "$CHANGELOG_MD" '## 0.5.1' "the CHANGELOG opens a 0.5.1 section"
for b in '#466' '#467'; do
  pin "$CHANGELOG_MD" "- **$b" "the CHANGELOG records $b exactly once"
done
head_ver="$(awk '/^## /{sub(/^## /, ""); print; exit}' "$CHANGELOG_MD")"
for m in "$PLUGIN_ROOT/.claude-plugin/plugin.json" "$PLUGIN_ROOT/.codex-plugin/plugin.json"; do
  mv_="$(awk -F'"' '/"version"/{print $4; exit}' "$m")"
  if [ "$mv_" = "$head_ver" ]; then pass "${m%/*.json} manifest version matches the CHANGELOG head ($mv_)"
  else fail "${m%/*.json} manifest version matches the CHANGELOG head" "manifest '$mv_' vs CHANGELOG '$head_ver'"; fi
done

section "rotation past the context ceiling (0.6.0)"

pin "$LIFECYCLE_MD" "## Rotation past the context ceiling" "lifecycle.md carries the rotation section"
pin "$LIFECYCLE_MD" "orca orchestration run-use --id <parent run> --json" "a new top rebinds the parent Run with plain run-use"
pin "$BRIEFS_MD" "HANDOFF_PATH=<" "the spine brief takes HANDOFF_PATH"
pin "$BRIEFS_MD" "rotate: <handoff path>" "the spine brief returns rotate: past the ceiling"
pin "$NESTED_MD" "rotate: <handoff path>" "the top's spine-completion step handles rotate:"
pin "$PRBRIEFS_MD" "context-ceiling notice" "the work-PR brief returns open: past the ceiling"

section "#452: waits and completion bodies (0.6.0)"

pin "$LIFECYCLE_MD" "--timeout-ms 900000" "the rolling wait uses Orca's 15-minute window"
pin "$SKILL_MD" "check --ack <delivery> --wait --types worker_done,escalation,question --timeout-ms 900000" "a heartbeat-only wake gets one command"
pin "$GENERIC_BRIEFS_MD" "Files: <paths, including the report file" "the planned brief's body names its report file"

section "reference line budgets"

budget "$EXEC_MD" "ossify-execution.md is within the reference budget"
budget "$NESTED_MD" "ossify-nested-run.md is within the reference budget"
budget "$PRBRIEFS_MD" "ossify-pr-briefs.md is within the reference budget"
budget "$BRIEFS_MD" "ossify-briefs.md is within the reference budget"
budget "$WRITER_MD" "ossify-close-writer.md is within the reference budget"

report
