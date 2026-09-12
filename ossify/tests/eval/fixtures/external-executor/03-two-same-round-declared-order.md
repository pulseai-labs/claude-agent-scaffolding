---
scenario_id: 03-two-same-round-declared-order
expected_outcome: gap-loop
expected_reason: 'Two things at once, and both are order-of-processing facts. First,
  arrival order is not processing order - w2s record arrived first but w1 is declared
  first, so w1 is validated and closed and merged before w2 is touched at all; an
  output that closes w2 first because it arrived first is wrong even though both items
  eventually close. Second, w2 did not come back as a result at all: an item stopped
  at pre-flight returns the SEPARATE external_execution_gaps record (work_item_id,
  coordinator_verdict, implementer_return in the gaps shape, and NO oids, because
  there is nothing to fingerprint), so section 5a''s five checks never see it. It
  routes into round-orchestration.md section 6s gap loop WITH THAT LOOPS DISPATCH
  STEP REPLACED: the lane surfaces the gaps, appends clarifications to w2s OWN handoff,
  and then issues ONE NEW SINGLE-ITEM REQUEST through the caller-supplied procedure,
  counted against the 3-iteration cap; it never reaches close. In external mode the
  lane dispatches nothing itself and says nothing about which executor the caller
  reuses - an answer that has ossify re-dispatching the same live implementer is describing
  the default nested path. The round barrier holds: round 2 does not start while w2
  is still open. The wrong answers this fixture falsifies are a model that runs the
  gaps record through the complete-result checks and halts the round on it, stranding
  w1s completed work, and one that expects oids on a gaps return'
---

Spine `r3.s4` ("retry policy") has one round with two work items in this
declared decomposition order: `r3.s4.w1` (`target_repo: canonical`, "backoff
calculator") and `r3.s4.w2` (`target_repo: canonical`, "retry budget config").
There is a second round behind this one, `r3.s4.w3`, which the plan declares
depends on both.

The lane is running under `--external-executor`. Both worktrees exist and are
journaled, both handoffs are authored, and both requests were handed to the
caller in one call. The caller ran the two items concurrently.

The caller returns two records. `r3.s4.w2`'s arrives first, and it is an
`external_execution_gaps` record — `coordinator_verdict: accepted`, an
`implementer_return` of `mode: gaps-surfaced`, and no `*_oid` of any kind — with one
blocking gap — *"AC-2 does not say whether an exhausted budget raises or returns
a sentinel."* `r3.s4.w1`'s arrives second as an ordinary
`external_execution_result`: `coordinator_verdict: accepted`, its
`implementer_return` reports `mode: complete` with `stage_status: all_staged`,
and its four declared `*_oid` values match what the lane recomputes.

`r3.s4.w2` has been dispatched once so far.

State what the lane does with each of the two returns, in what order it does it,
and what has to be true before `r3.s4.w3` starts.
