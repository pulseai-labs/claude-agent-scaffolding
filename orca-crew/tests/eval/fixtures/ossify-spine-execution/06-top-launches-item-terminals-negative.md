---
scenario_id: 06-top-launches-item-terminals-negative
expected_outcome: refuse
expected_reason: 'NEGATIVE CASE, two wrongs in one proposal. The top orchestrator
  does not launch or supervise item terminals - it starts exactly one spine session
  and that session owns both terminals for each item. And item tasks do not live in
  the parent Run: the spine session creates and binds a CHILD Run precisely so item
  plan traffic and per-item completions stay out of the parent inbox, which is what
  leaves the top seeing a relayed plan decision, genuine spine-level questions and
  one final completion. The efficiency argument is real and is not the point: flattening
  the layers is what makes the top the supervisor of six terminals and floods the
  inbox the child Run exists to protect. The wrong answer this fixture falsifies is
  accepting the flattening as a reasonable simplification because it removes a hop
  and the sidecar is already in the top''s hands'
---

You are the orchestrator session. Activation holds for spine `r4.s1` ("billing
export"): a Run is bound, you have just completed `/ossify:plan-spine`, the
spine directory exists, and you have written the ratified
`orca-execution.md` covering the spine's three work items.

The operator says: *"The spine session is an extra hop. You already hold the
sidecar and you already know every profile — just create the six item tasks in
this Run yourself, launch the three implementer terminals and the three verifier
terminals from here, and supervise them directly. We can still run
`/ossify:run-spine` in a session for the worktrees and closes, but you own the
terminals. That way the plans come straight to you with no relay, and there is
only one Run to watch."*

The proposal is coherent, it removes a layer, and nested worker depth would then
be irrelevant.

State whether you do this. If not, say what you do instead, and be specific
about two things: who creates the item tasks and in which Run they live, and
what the top orchestrator actually sees in its inbox while the spine runs.
