---
scenario_id: 07-detach-two-planned-exits-count-nothing
expected_outcome: detach
expected_reason: The command carries --detach as its third token after --external-executor, so the
  lane is in detached mode. Each lane session builds the round's requests, invokes the caller's
  procedure once, and ENDS - it does not wait for results, does not validate a result, does not
  close or merge. The lane counts no request in this mode, so it never calls oss work_item_dispatched
  in any of the three sessions, and dispatches stays 0 because nothing has been executed. The
  caller counts each execution, the first one included, and has executed nothing yet. The wrong
  answer this fixture falsifies is a lane that keeps the default counting (dispatches 1 after the
  first lane, 2 after the second) or that waits for the caller's results before ending
---

A project is mid-release with spine `r4.s2` ("token bucket") planned: one round, one work
item `r4.s2.w1` (`target_repo: canonical`, "bucket state struct"). Its spec is authored and
parses. `oss get` shows `dispatches` absent (zero) for it.

The operator types exactly:

    /ossify:run-spine r4.s2 --external-executor --detach

with a caller-supplied execution procedure in scope. The lane cuts the spine branch, creates
the worktree, authors the handoff, builds the request and invokes the caller's procedure.

The caller executes nothing. It re-enters the lane twice more, each time with the same
command: the item is `active`, its worktree is clean at `base_sha`, and no result has been
returned.

Describe, for each of the three lane sessions: what the lane does, whether it calls
`oss work_item_dispatched`, what `dispatches` reads at the end of the session, and how the
session ends.
