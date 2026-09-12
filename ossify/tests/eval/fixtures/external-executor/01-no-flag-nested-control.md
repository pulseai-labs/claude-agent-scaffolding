---
scenario_id: 01-no-flag-nested-control
expected_outcome: nested
expected_reason: NEGATIVE CONTROL. The command carries no flag, so nothing about external
  mode applies — the lane dispatches ossify:implementer-agent per work item exactly
  as it always has, builds no request or result record, and invokes no caller-supplied
  procedure. The presence of a caller in the session, or of a Workflow tool, activates
  nothing; the flag is the only switch. At work-item close, with OSSIFY_NO_WORKFLOWS
  unset, a Workflow tool available and a nonempty staged diff, Layer 4 takes the DELEGATED
  path (six agents) — external mode is what would have forced it inline, and external
  mode was not entered. The wrong answer this fixture falsifies is a model that has
  read the external-executor contract and applies any part of it because the conditions
  "look like" a caller-driven run
---

A project is mid-release with spine `r4.s2` ("token bucket") planned: one round,
two work items in this decomposition order — `r4.s2.w1` (`target_repo:
canonical`, "bucket state struct") and `r4.s2.w2` (`target_repo: canonical`,
"refill clock"). Both specs are authored and parse.

The operator types exactly:

    /ossify:run-spine r4.s2

The session that receives it happens to be running under an outer coordinator
that could execute work items itself if asked, and the `Workflow` tool is
available in this harness. `OSSIFY_NO_WORKFLOWS` is unset. Both work items will
produce a nonempty staged diff.

Describe what the execution lane does for this spine: how each work item is
executed, what records (if any) cross a seam, and — when `r4.s2.w1` reaches
work-item close with its gate green through Layer 3 — which Layer 4 path the
close takes and why.
