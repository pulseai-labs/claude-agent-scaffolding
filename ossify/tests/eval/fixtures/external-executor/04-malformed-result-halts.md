---
scenario_id: 04-malformed-result-halts
expected_outcome: halt
expected_reason: 'Three independent validation failures land on one round and each
  is terminal on its own - an extra field the contract does not declare (retry_count)
  breaking field parity, a coordinator_verdict that is not the literal accepted however
  reasonable it reads, and an item-set that does not match the request set (a result
  for an item never requested, and no result for an item that was). The lane halts
  the round naming what failed. What it must NOT do is any of the three recoveries
  that look available: fall back to dispatching ossify:implementer-agent for the unanswered
  item, re-invoke the caller procedure for a second attempt at the round, or accept
  the softer verdict because the report looks finished. The operator owns the recovery
  choice; the lane holds the state lock and stops'
---

Spine `r5.s3` ("session store") is running under `--external-executor` with one
round holding two work items in declared order: `r5.s3.w1` (`target_repo:
canonical`, "store interface") and `r5.s3.w2` (`target_repo: canonical`,
"in-memory backend"). Both worktrees exist and are journaled, both handoffs are
authored, and both requests went to the caller in one call.

The caller returns two results:

The first names `work_item_id: r5.s3.w1`, carries `coordinator_verdict:
accepted-with-notes`, an `implementer_return` of `{mode: complete, report_path:
<abs>/report.md, summary: "AC-1..3 pass", stage_status: all_staged}`, the four
`*_oid` values, and one further field `retry_count: 1`.

The second names `work_item_id: r5.s3.w4` — an id that appears nowhere in this
spine's plan and for which no request was ever built. It is otherwise
well-formed and carries `coordinator_verdict: accepted`.

No result names `r5.s3.w2`. `r5.s3.w1`'s worktree does hold a plausible staged
diff and a written `report.md`.

State what the lane does with this round, everything it finds wrong, and what it
does next.
