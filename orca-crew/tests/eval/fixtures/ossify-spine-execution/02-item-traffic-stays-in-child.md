---
scenario_id: 02-item-traffic-stays-in-child
expected_outcome: proceed
expected_reason: 'Routing, in both directions. The two item plan questions arrived
  on the CHILD Run and are answered there - but not by the spine session on its own
  authority: it gathers the rounds available plans into ONE ordered parent ask, the
  top returns an INDEPENDENT approve-or-amend per item, and the spine session replies
  to each ORIGINAL child message id. No edit starts before that reply lands. The w1
  verifiers per-item worker_done settles in the child and never reaches the parent
  inbox - note that this verifier exists at all only because w1 already returned complete,
  which is when its terminal is created; a verifier standing by before any complete
  return would itself be a contract violation. The spine sessions own final completion
  uses the INJECTED parent task and dispatch ids, which settles the tops Dispatch
  while the child Run stays bound - and before sending it the spine session releases
  every item pair and names the child Run id in the body, so nothing of its own outlives
  the spine and the top can still find the Run. The wrong answers this fixture falsifies
  are: the spine session approving the plans itself because it can read them; relaying
  two separate asks when one ordered ask carries the round; answering both child questions
  on one message id; forwarding the verifier completion up as progress; and inventing
  a close-the-Run step, which the CLI does not expose'
---

You are the spine session for `r6.s1`. Your brief injected these parent
identities and you created and bound a child Run, `run_child77`, for item tasks:

    PARENT_RUN_ID=run_parent41
    SPINE_TASK_ID=task_spine08
    SPINE_DISPATCH_ID=ctx_spine08
    ORCA_EXECUTION_PATH=/repos/product-ai/docs/specs/r6/r6.s1-ledger-export/orca-execution.md

Round 1 holds three items. `r6.s1.w1` has already come back complete; you
captured its four-part fingerprint and created its verifier terminal at that
point, and that verifier has just sent a `worker_done` on the child Run with its
all-claims report.

The round's other two items, `r6.s1.w2` and `r6.s1.w3`, are still at the plan
gate: both implementer terminals have confirmed their models and read their
handoffs, and both have now posted implementation plans as blocking questions on
the child Run — `r6.s1.w2`'s on child message `msg_c31`, `r6.s1.w3`'s on child
message `msg_c34`. Neither has edited anything yet.

State what you do with each of these three messages: where each one goes, what
you send up and in what shape, what comes back, and how each implementer learns
it may start. Then state which ids you will use for your own final completion at
the end of the spine, and what the top orchestrator will and will not have seen
by then.
