---
scenario_id: 02-external-request-result-handling
expected_outcome: external
expected_reason: 'The core in-session contract. With the flag, the lane still does
  all of its own preparation — worktree created and journaled, handoff authored —
  and only then builds one external_execution_request carrying work_item_id, target_repo,
  handoff_path, spec_path, worktree_path, branch and base_sha, invokes the caller-supplied
  procedure once for the round, and takes back one external_execution_result carrying
  work_item_id, coordinator_verdict, implementer_return (the ordinary complete shape
  - mode/report_path/summary/stage_status) and the four *_oid fields. It dispatches
  NO subagent. Before close it RECOMPUTES the four-part fingerprint from the worktree
  and the two documents and compares it to what the result declared, rather than trusting
  the declared values. The wrong answers this fixture falsifies are: reading the result''s
  own *_oid values back as if that were the check; skipping the lane''s own worktree/handoff
  work because a caller is executing; and treating the caller as a substitute for
  the close gate, which remains ossify''s'
---

Spine `r6.s1` ("audit log") is planned with one round holding a single work
item, `r6.s1.w1` (`target_repo: canonical`, "append-only writer"). Its spec is
authored and parses to three `auto:` ACs.

The operator types exactly:

    /ossify:run-spine r6.s1 --external-executor

The session driving this lane has a caller-supplied execution procedure in
scope: it can run work items somewhere else and report back, and it can run a
whole round's items at once. It has no knowledge of ossify's internals beyond
what the lane hands it.

The spine branch is cut and checked out in `canonical`. Walk through what the
lane does from that point until `r6.s1.w1` is ready for work-item close: name
every field the lane hands out for that item, name every field it requires back,
and state exactly what it checks about the returned values before letting the
item reach close. The caller returns a well-formed acceptance for the item.
