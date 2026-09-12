---
scenario_id: 05-fingerprint-mismatch-halts
expected_outcome: halt
expected_reason: 'The result is perfectly shaped - correct item, accepted verdict,
  ordinary complete return - and it still halts, because the fingerprint is RECOMPUTED
  and two of its four components disagree with what the result declared. The item
  moved after the caller finished. The lane names which components changed (the staged
  tree and report.md; HEAD and spec.md agree) and stops. The wrong answers this fixture
  falsifies are: passing the item because every field is present and the verdict is
  accepted (shape is not identity); reading the declared oid values back as the check,
  which can never disagree with itself; and repairing the drift by re-staging, re-reading,
  or re-running the caller instead of halting. Note also what a mismatch does NOT
  license - it is not evidence about WHO changed the files and not grounds to discard
  the worktree, whose state is the evidence'
---

Spine `r7.s2` ("schema registry") is running under `--external-executor`. One
round, one work item: `r7.s2.w1` (`target_repo: canonical`, "registry
loader"). The worktree exists at `/repos/product/.worktrees/r7.s2.w1-registry`,
is journaled, and its handoff is authored.

The caller returns one result for `r7.s2.w1` with `coordinator_verdict:
accepted` and an `implementer_return` of `{mode: complete, report_path:
<work-item-dir>/report.md, summary: "AC-1,2 pass; AC-3 fail (loader ignores
alias table) — see report", stage_status: all_staged}`. It declares:

    tree_oid:   4f2c9a...  head_oid:  91be07...
    report_oid: c30d5b...  spec_oid:  77aa1e...

The lane recomputes the same four from the worktree and the two documents
immediately before close and gets:

    tree_oid:   e88b41...  head_oid:  91be07...
    report_oid: 5a1f2c...  spec_oid:  77aa1e...

The worktree is not dirty, the staged diff is nonempty, and `report.md` exists
and is readable.

State what the lane concludes and what it does. Say what, if anything, the
disagreement establishes about how the files came to differ.
