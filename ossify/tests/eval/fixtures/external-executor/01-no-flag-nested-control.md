---
scenario_id: 01-no-flag-nested-control
expected_outcome: nested
expected_reason: NEGATIVE CONTROL. The command carries no flag, so nothing about external
  mode applies — the lane dispatches ossify:implementer-agent per work item exactly
  as it always has, builds no request or result record, and invokes no caller-supplied
  procedure. The presence of a caller in the session activates nothing; the flag is
  the only switch. At work-item close Layer 4 runs INLINE — it runs inline on every
  harness, so the no-flag path differs from external mode on nothing here. The wrong
  answer this fixture falsifies is a model that has read the external-executor
  contract and applies any part of it because the conditions "look like" a
  caller-driven run
---

A project is mid-release with spine `r4.s2` ("token bucket") planned: one round,
two work items in this decomposition order — `r4.s2.w1` (`target_repo:
canonical`, "bucket state struct") and `r4.s2.w2` (`target_repo: canonical`,
"refill clock"). Both specs are authored and parse.

The operator types exactly:

    /ossify:run-spine r4.s2

The session that receives it happens to be running under an outer coordinator
that could execute work items itself if asked. Both work items will produce a
nonempty staged diff.

Describe what the execution lane does for this spine: how each work item is
executed, what records (if any) cross a seam, and — when `r4.s2.w1` reaches
work-item close with its gate green through Layer 3 — how the close runs
Layer 4.
