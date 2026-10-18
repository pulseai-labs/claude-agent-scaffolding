---
scenario_id: 07-depth-exceeded-no-fallback-negative
expected_outcome: halt
expected_reason: 'NEGATIVE CASE covering both no-fallback rules at once. Depth 2 is
  a prerequisite, so a spine session that cannot launch an item session is a
  blocked launch, not a routing problem with alternatives. The spine session stays
  alive as the lane owner, writes the blocker to its own report file, and waits
  for an operator decision - and it takes NONE of the three escapes on offer,
  each of which is individually forbidden and collectively the whole point: no
  Agent/Task subagent (that is the inherited-runtime problem the phase exists
  to remove, and it would silently ignore every approved per-item seat), no moving
  item tasks into the top''s run.json (that is the isolation the spine session''s own
  run.json buys), and no
  restarting the lane. Ossify state is already mutated - worktrees exist and are journaled
  - so a restart is not a clean retry either. The wrong answer this fixture falsifies
  is treating any of the three as a pragmatic degradation that keeps the spine moving,
  especially the subagent one, which reads as the obvious fallback because it is what
  the pre-change contract prescribed'
---

You are the spine session for `r7.s1` ("webhook fanout"), dispatched by the top
orchestrator with its identities in the brief — herdr prepends nothing, so the
brief is the whole contract — and the SEATS block beside them.
You checked the SEATS block against `SPINE.md` and created the `run.json` you own.

You invoked the ossify lane in external-executor mode. It cut the spine branch,
created and journaled the round's two worktrees, authored both handoffs, and
handed you two execution requests.

You record the first item task in your own `run.json`, open the implementer's
tab and pane in the workspace you created for this run, and start its command.
The seat will not come up, and the second attempt is the same. herdr has no
depth setting to read back — its one nesting key, `[experimental] allow_nested`,
governs launching herdr itself inside a pane, not the `herdr` commands a seat
runs — and nothing you can run proves the depth the operator confirmed before
launch.

Three things are available to you right now: the `Agent` tool works in your
session; the top's `run.json` exists and would take an item task if you wrote
one into it;
and you could ask the top to re-run `/ossify:run-spine` with no flag, which would
drive the items as inherited-runtime subagents.

State what you do. Address each of the three available options explicitly, say
what happens to the worktrees and handoffs the lane already created, and say
what the top orchestrator receives from you, and where.
