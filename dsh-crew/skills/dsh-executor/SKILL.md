---
name: dsh-executor
description: The caller-supplied execution procedure for ossify's run-spine --external-executor when the caller is a DeepSeek Harness spine session on the crew-spine preset. Turns each request record into a subagent_implementer call, verifies the return with a subagent_verifier call, sends one correction on FAIL, computes ossify's result record from git and hands the round back. Use when run-spine hands you a round's request records. Defers every rule to ossify's external-executor.md and adds nothing to its contract.
---

# dsh executor — the round, as a dsh spine session runs it

## 1. You are here

You are the spine session, on the `crew-spine` preset, cwd inside the AI workspace, `oss`
on the PATH of the bash tool. `run-spine <spine-id> --external-executor` (ossify) has
prepared every item in the round (the spine-branch cut, the per-item worktrees and the
handoffs: `work-item/references/round-orchestration.md` §2–§4), built one request per item
(`work-item/references/external-executor.md` §2–§3), and now hands you the round's request
records, one per item, in declared decomposition order.
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
timeout_ms: 600000)`. When a job settles, its final text is the child's return. Parse it
as the one JSON object it must be:

- `mode: complete` → go to §4 for this item.
- `mode: gaps-surfaced` → go to §6 for this item.
- anything else, or a stop reason other than completed (error, refusal, max-tokens,
  killed) → this item failed. Write no record for it: stop the round here and report the
  item, its job id, the stop reason and the last output to the operator. Nothing is retried in v0.

## 4. Verify a complete return

Foreground, one item at a time, in declared order:

1. Fill the verifier prompt (`dsh-brief` §3): CLAIMS from the item's spec (one per
   acceptance criterion), the two fixed claims, the four paths.
2. Call `subagent_verifier` with `description: "verify <work_item_id>"` and that prompt.
3. Read the last lines. `VERDICT: PASS` → §5. `VERDICT: FAIL` → §4a.

### 4a. One correction, then the operator

1. Compute `head_oid` (`git -C <worktree_path> rev-parse HEAD`) and `tree_oid`
   (`git -C <worktree_path> write-tree`) now; they are the rejected result's identity.
2. Fill the correction prompt (`dsh-brief` §4) with the packet: `handoff_path`,
   `work_item_id`, `expected_branch` = the request's `branch`, `expected_head_sha`,
   `expected_tree_oid`, `failures` = the verifier's FAILURES lines.
3. Call `subagent_implementer` with `description: "correct <work_item_id>"`, foreground.
4. On its complete return, verify again (§4, once). PASS → §5. A second FAIL stops this
   item: report both verifier outputs to the operator, settle the round's other items,
   then stop before §7. The round is not handed back; the operator owns recovery.
   Never a third attempt.

A corrected item's result record is computed afresh in §5 and must pass the whole identity
table again (`external-executor.md` §7); the continuation's own return is never carried over.

## 5. Compute the result record

All values are read from the worktree and the documents, never from the child's words:

```bash
WT=<worktree_path>; REPORT=<report_path from the return>; SPEC=<spec_path>
git -C "$WT" rev-parse --abbrev-ref HEAD      # must equal the request's branch
git -C "$WT" rev-parse HEAD                   # head_oid; must equal the request's base_sha
git -C "$WT" write-tree                       # tree_oid
git -C "$WT" status --porcelain               # every line must start with a staged code (M, A, D, R, C in column 1) and have a space in column 2; no '??'
git hash-object "$REPORT"                     # report_oid
git hash-object "$SPEC"                       # spec_oid
```

Also check `REPORT` is `report.md` in the same directory as `spec_path` and
`handoff_path`. If the branch, `HEAD` or the status check disagree with the request, do not
build a record: stop, name the row that disagreed, and report to the operator — ossify's
§5a would halt on it anyway, and a record that hides it is worse than none.

Write the record in ossify's shape (`references/records.md`, "The result record"):
`coordinator_verdict: accepted`, `implementer_return` copied unextended from the return,
the four oids. `stage_status` is copied from the return; ossify recomputes it, never trusts
it.

## 6. A gaps return

Before anything else, check the worktree is untouched: `git -C <worktree_path> status
--porcelain` is empty, `rev-parse HEAD` equals the request's `base_sha`, `rev-parse
--abbrev-ref HEAD` equals the request's `branch`. Anything else means something else ran:
stop and report. Then write the gaps record (`references/records.md`, "The gaps record")
with the child's `gaps` copied unextended. It routes; it never reaches close. ossify's lane
surfaces the gaps, appends clarifications to the handoff, and hands you one new
single-item request (same `branch` and `worktree_path`, read off the original request);
run it through §2–§5 as a round of one.

## 7. Hand the round back

Write every record — results and gaps, one per request, no missing, extra or duplicate
`work_item_id` — as YAML blocks into
`<spine spec dir>/round-<n>-external-records.yaml`, then continue `run-spine`'s lane at
`external-executor.md` §5a with that file as the caller's return. Records are fed to close
in declared decomposition order, never arrival order; closes and merges stay serial; the
round barrier is untouched.

## 8. What you never do

You never commit, never push, never edit a worktree yourself, never write `.ossify/`
except through `oss`, never start a third attempt on an item, never soften
`coordinator_verdict`, and never invent a field. If a tool refuses you, report it verbatim
and stop that step. Recovery beyond one correction is the operator's.
