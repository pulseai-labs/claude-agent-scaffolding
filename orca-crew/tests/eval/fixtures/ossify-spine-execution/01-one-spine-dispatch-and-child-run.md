---
scenario_id: 01-one-spine-dispatch-and-child-run
expected_outcome: proceed
expected_reason: 'All four activation facts hold, so the phase applies. The top agrees
  every item seat AND the three coordinator seats - spine, close and work-PR session -
  with the operator in ONE phase and writes nothing until all of it is decided,
  records the approved set in the project file''s section for this spine, injects it
  into the spine session''s brief as its SEATS block, confirms nested worker depth is
  2 (no CLI read proves it), and
  starts EXACTLY ONE spine session - it launches no item terminal itself - injecting
  that sessions identities including the spine id it will spend. The spine session
  checks the SEATS block against SPINE.md - every planned item has exactly one
  implementer row and one verifier row, and no row names an item the plan does not;
  a failure halts and asks, never substitutes - then creates and binds a CHILD Run
  for item tasks and runs
  the lane in external-executor mode. The wrong answers this fixture falsifies are:
  the top creating one dispatch per work item (three dispatches instead of one); the
  top launching the item terminals because it is the session holding the approved
  seats;
  skipping the depth confirmation because no command can read the setting, which is
  the reason it is confirmed with the operator rather than a reason to skip it; and
  the spine session re-reading the project file for seats when the SEATS block in its
  brief is the whole authority.
  An answer that also notes what happens after the spine sessions completion is correct
  rather than out of scope, provided it says the top DISPATCHES /ossify:close as a
  task and waits on its worker_done - close is a dispatched command, not one the top
  runs in its own session'
---

You are the orchestrator session. A Run is bound for the objective, this session
has just completed `/ossify:plan-spine` for spine `r5.s2` ("ledger export"), and
the spine directory exists at
`/repos/product-ai/docs/specs/r5/r5.s2-ledger-export/` holding `SPINE.md` and
three work-item directories.

`SPINE.md` declares three work items across two rounds: round 1 holds
`r5.s2.w1` ("export schema", touches a public interface) and `r5.s2.w2` ("CSV
writer", one file, mechanical); round 2 holds `r5.s2.w3` ("export CLI flag"),
which depends on both.

The project file has no section for this spine yet. The operator is at the
keyboard and available.

State what you do next, in order, up to and including the moment the spine's
first round begins executing. Name every Orca dispatch you create and say who
creates it. Say what you check before starting anything, and what you do about
Orca's nested worker depth setting.
