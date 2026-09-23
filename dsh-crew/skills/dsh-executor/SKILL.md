---
name: dsh-executor
description: The caller-supplied execution procedure for ossify's run-spine --external-executor when the caller is a DeepSeek Harness spine session on the crew-spine preset. Turns each request record into a subagent_implementer call, verifies the return with a subagent_verifier call, sends one correction on FAIL, computes ossify's result record from git and hands the round back. Use when run-spine hands you a round's request records. Defers every rule to ossify's external-executor.md and adds nothing to its contract.
---

# dsh executor — the round, as a dsh spine session runs it

## 1. You are here

You are the spine session, on the `crew-spine` preset or the headless `crew` profile, cwd
inside the AI workspace, `oss` on the PATH of the bash tool. `run-spine <spine-id>
--external-executor` (ossify) has prepared every item in the round (the spine-branch cut,
the per-item worktrees and the handoffs: `work-item/references/round-orchestration.md`
§2–§4), built one request per item (`work-item/references/external-executor.md` §2–§3),
and now hands you the round's request records, one per item, in declared decomposition
order.
Your tools for this: `subagent_implementer`, `subagent_verifier`, `job_output`,
`job_list`, `job_kill`, `bash`, `skill`. Prompts come from the `dsh-brief` skill (§2 the
implementer prompt, §3 the verifier prompt, §4 the correction prompt).

ossify state is the single authority. You write nothing into `.ossify/` except through
`oss`, and you never commit, never push. The records you produce are ossify's
(`references/records.md`), unextended.

## 2. Dispatch the round

For every request, in declared order:

1. Fill the implementer prompt (`dsh-brief` §2) with the seven request fields, verbatim.
2. Call `subagent_implementer` with `description: "work item <work_item_id>"`, that
   prompt, and `run_in_background: true`. Note the job id it returns against the item.

Items within a round are parallel by construction; dispatch them all, then wait.

## 3. Collect the returns

Loop: `job_list()`; for each item's job not yet settled, `job_output(job_id, wait: true,
timeout_ms: 600000)`. When a job settles, the child's return is the LAST JSON object in
its final text (text before it is allowed, `returns.md` §5). It is usable only if it is
exactly one of `returns.md` §1's two shapes — every key present, no extra key, each enum
value one of ossify's, a non-empty `gaps` whose every element carries exactly `section`,
`question` and `severity`:

- `mode: complete` → go to §4 for this item.
- `mode: gaps-surfaced` → go to §6 for this item.
- anything else, or a stop reason other than completed (error, refusal, max-tokens,
  killed) → the stop rule, below. Nothing is retried in v0.

**The stop rule.** Every child return that is not a usable result ends the same way: write
no record for that item; let the round's other jobs settle and take them through §4–§6, so
no child is left running; then stop before §7 and report to the operator the item, its job
id, the stop reason and the last output. The round is not handed back; the operator owns
recovery. `job_kill` only on the operator's word.

## 4. Verify a complete return

Foreground, one item at a time, in declared order:

1. Fingerprint the item: `head_oid` (`git -C <worktree_path> rev-parse HEAD`), `tree_oid`
   (`git -C <worktree_path> write-tree`), `git -C <worktree_path> status --porcelain`, and the
   blob ids of the report, the spec and the handoff (`git hash-object`) — the handoff sits
   outside the worktree, so nothing else in this procedure covers it.
2. Fill the verifier prompt (`dsh-brief` §3): CLAIMS from the item's spec (`dsh-brief` §3 —
   one per `auto:` AC, none for a `user:` row), the two fixed claims, the four paths.
3. Call `subagent_verifier` with `description: "verify <work_item_id>"` and that prompt.
4. Fingerprint again. Any difference means the verifier changed the item: the stop rule (§3).
5. Gate the worktree, whatever the verdict turns out to be: the branch, `HEAD` against the
   request's `base_sha`, the staged-only status and the report's placement (§5's block), each
   against the request. Any disagreement is the stop rule (§3) — never a correction, never a
   record, and never a packet built from the state that failed the gate.
6. Read the reply. PASS only when every claim you issued has exactly one line and each says
   `pass`, followed by `VERDICT: PASS` → §5. A well-formed reply naming a `fail` or
   `cannot determine`, with `VERDICT: FAIL` → §4a. A reply missing a claim, repeating one, or
   whose verdict contradicts its lines is not a verification: the stop rule (§3).

### 4a. One correction, then the operator

1. The fingerprint from §4 step 1 is the rejected result's identity, and §4 step 5 has
   already confirmed it against the request — so the packet can never encode a state that
   gate would have refused: `head_oid` and `tree_oid` go into the packet. A correction is a
   dispatch of the item and counts against ossify's cap of three dispatches
   (`correction-continuation.md` §4, `round-orchestration.md` §6) — the original, every gaps
   replacement, every correction.
   If this correction would be the fourth, it is not sent: the stop rule (§3).
2. Fill the correction prompt (`dsh-brief` §4) with the packet: `handoff_path`,
   `work_item_id`, `expected_branch` = the request's `branch`, `expected_head_sha`,
   `expected_tree_oid`, `failures` = the verifier's FAILURES lines.
3. Call `subagent_implementer` with `description: "correct <work_item_id>"`, foreground.
4. On a return that passes §3's usability test and is `complete`, verify again (§4, once);
   PASS → §5. A second FAIL (report both verifier outputs), a refusal
   (`correction-continuation.md` §3 step 2), a return that fails §3's usability test, or any
   other return → the stop rule (§3).
   Never a third attempt.

A corrected item's result record is computed afresh in §5 and must pass the whole identity
table again (`external-executor.md` §7); the continuation's own return is never carried over.
A correction packet ossify's close sends back after rejecting an item (`external-executor.md`
§7, "to the same executor") is a new invocation of this procedure, run as a round of one:
`dsh-brief` §4 with that packet, then §4 verify, then §5 afresh, then §7. The
one-correction limit above counts attempts within one invocation; ossify's three-dispatch
cap (step 1) counts across them and applies to a close-sent packet as to any correction.
How many close rejections an item gets is ossify's (`close/references/impl-check.md` §6),
not this skill's.

## 5. Compute the result record

All values are read from the worktree and the documents, never from the child's words — the
same rows §4 step 5 gated on, read again here to build the record:

```bash
WT="<worktree_path>"; REPORT="<report_path from the return>"; SPEC="<spec_path>"
git -C "$WT" rev-parse --abbrev-ref HEAD      # must equal the request's branch
git -C "$WT" rev-parse HEAD                   # head_oid; must equal the request's base_sha
git -C "$WT" write-tree                       # tree_oid
git -C "$WT" status --porcelain               # every line must start with a staged code (M, A, D, R, C, T in column 1) and have a space in column 2; no '??'
git hash-object "$REPORT"                     # report_oid
git hash-object "$SPEC"                       # spec_oid
```

Also check `REPORT` is `report.md` in the same directory as `spec_path` and
`handoff_path`. If the branch, `HEAD` or the status check disagree with the request, do not
build a record: name the row that disagreed and apply the stop rule (§3) — ossify's §5a
would halt on it anyway, and a record that hides it is worse than none.

Write the record in ossify's shape (`references/records.md`, "The result record"):
`coordinator_verdict: accepted`, `implementer_return` copied unextended from the return,
the four oids. `stage_status` is copied from the return; ossify recomputes it, never trusts
it.

## 6. A gaps return

Before anything else, check the worktree is untouched: `git -C <worktree_path> status
--porcelain` is empty, `rev-parse HEAD` equals the request's `base_sha`, `rev-parse
--abbrev-ref HEAD` equals the request's `branch`. Anything else means something else ran:
the stop rule (§3). Otherwise write the gaps record (`references/records.md`, "The gaps
record") with the child's `gaps` copied unextended; it goes back through §7 with the
round's other records. It routes; it never reaches close. After §7, ossify's lane surfaces
the gaps, appends clarifications to the handoff, and invokes this procedure again with one
new single-item request (same `branch` and `worktree_path`, read off the original
request); run that through §2–§7 as a round of one.

## 7. Hand the round back

Write every record — results and gaps, one per request, no missing, extra or duplicate
`work_item_id` — as YAML blocks into
`<spine spec dir>/round-<n>-external-records.yaml`, then continue `run-spine`'s lane at
`external-executor.md` §5a with that file as the caller's return. Records are fed to close
in declared decomposition order, never arrival order; closes and merges stay serial; the
round barrier is untouched.

A follow-up invocation never overwrites an earlier records file: a gaps replacement (§6)
writes `<spine spec dir>/round-<n>-<work_item_id>-gaps-<k>-external-records.yaml` and a
close-sent correction (§4a) writes
`<spine spec dir>/round-<n>-<work_item_id>-correction-<k>-external-records.yaml`, where `k`
is that item's gap or correction iteration.

## 8. What you never do

You never commit, never push, never edit a worktree yourself, never write `.ossify/`
except through `oss`, never start a third attempt on an item within one invocation, never soften
`coordinator_verdict`, and never invent a field. If a tool refuses you, report it verbatim
and stop that step. Recovery beyond one correction is the operator's.
