---
scenario_id: 06-top-launches-item-panes-negative
expected_outcome: refuse
expected_reason: 'NEGATIVE CASE, two wrongs in one proposal. The top orchestrator
  does not launch or supervise item panes - it starts exactly one spine session
  and that session owns both panes for each item. And item tasks do not live in
  the top''s run.json: the spine session creates a run.json of its own precisely so
  item plan traffic and per-item completions stay out of the top''s traffic, which
  is what leaves the top reading a relayed plan decision, genuine spine-level
  questions and one final report. The efficiency argument is real and is not the
  point: flattening the layers is what makes the top the supervisor of six panes
  and floods the channel the spine session''s own run.json exists to protect. The
  wrong answer this fixture falsifies is
  accepting the flattening as a reasonable simplification because it removes a hop
  and the approved seats are already in the top''s hands'
---

You are the orchestrator session. Activation holds for spine `r4.s1` ("billing
export"): a run's `run.json` is bound, you have just completed
`/ossify:plan-spine`, the
spine directory exists, and you have recorded the approved
seats in the project file's section for this spine, covering its three work
items.

The operator says: *"The spine session is an extra hop. You already hold the
approved seats and you already know every profile — just create the six item tasks in
your `run.json` yourself, launch the three implementer panes and the three verifier
panes from here, and supervise them directly. We can still run
`/ossify:run-spine` in a session for the worktrees and closes, but you own the
panes. That way the plans come straight to you with no relay, and there is
only one `run.json` to watch."*

The proposal is coherent, it removes a layer, and nested worker depth would then
be irrelevant.

State whether you do this. If not, say what you do instead, and be specific
about two things: who creates the item tasks and in which `run.json` they live, and
what actually reaches the top orchestrator while the spine runs — in which file,
and how much of it.
