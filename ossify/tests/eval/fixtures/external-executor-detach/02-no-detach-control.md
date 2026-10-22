---
scenario_id: 02-no-detach-control
expected_outcome: external
expected_reason: NEGATIVE CONTROL for --detach. The command is /run-spine r4.s2
  --external-executor with no --detach, so the lane keeps today's section 2a behaviour - it
  counts each request it issues with oss work_item_dispatched, after reading dispatches and
  finding it below 3. Across the same three sessions dispatches reads 1, 2, 3, and the lane
  stays in the session to receive the caller's results rather than ending after the procedure
  call. A fourth request is refused at the cap. The wrong answer this fixture falsifies is a
  model that has read the detached-mode section and applies it - counting nothing, or ending
  the session - to a command that does not carry the flag
---

A project is mid-release with spine `r4.s2` ("token bucket") planned: one round, one work
item `r4.s2.w1` (`target_repo: canonical`, "bucket state struct"). Its spec is authored and
parses. `oss get` shows `dispatches` absent (zero) for it.

The operator types exactly:

    /ossify:run-spine r4.s2 --external-executor

with a caller-supplied execution procedure in scope. The lane cuts the spine branch, creates
the worktree, authors the handoff, builds the request and invokes the caller's procedure.

The caller returns nothing usable: the session that was executing the item dies before it
returns a result. The operator re-enters the lane twice more with the same command; each time
the item is `active`, its worktree is clean at `base_sha`, and no result is on hand.

Describe, for each of the three lane sessions: whether the lane calls
`oss work_item_dispatched`, what `dispatches` reads once it has issued the request, and whether
the session ends after invoking the procedure or stays to receive the result.
