---
scenario_id: 03-parallel-fresh-pairs-exact-profiles
expected_outcome: proceed
expected_reason: 'THE DISCRIMINATING FIXTURE for this surface. Each item gets its
  own FRESH implementer seat created from that item''s SEATS row, verbatim, using
  the exact resolved profile as written - including a profile the operator chose
  specifically for this item, which is a legitimate row value here even though the
  generic role table would launch this class of item from a different profile. TWO
  seats for two items at this point, not four: the verifier
  is NOT created at round launch, because it has nothing to verify until that items
  complete return and the identity that result declares exist; it is created and
  dispatched later, from its own row. Each item keeps its own workspace, since
  Paseo ties one workspace to one path and the two items sit in two different
  worktrees ossify already prepared - so this is two workspaces, each isolation
  "local" against that item''s existing tree, never one shared container; and their
  two item tasks live in the run.json the spine session owns; the two items may run
  concurrently. The model is confirmed with `paseo inspect --json` against each
  row''s provider/model segment and by the worker''s own first-reply check; the
  effort is the launch argument, with no runtime attestation. The wrong answers
  this fixture falsifies are: dispatching one lane-driver session that spawns per-item
  subagents through the Agent tool (which is what the pre-change contract prescribed);
  creating all four seats now, which gives each verifier nothing to do and a stale
  worktree to sit on; reusing one implementer across both items because it is retained
  by the generic rule; and substituting the row''s named profile for the generic role
  table''s default because profile choice is normally the operator''s to set in the
  project file - that rule governs an ordinary seat''s selection, not an approved
  SEATS row, which is frozen into the brief and spent verbatim'
---

You are the spine session for `r5.s2`, with the `run.json` you own bound to your
run. Round 1 holds two
work items whose worktrees, handoffs and execution requests are ready:
`r5.s2.w1` ("export schema") and `r5.s2.w2` ("CSV writer"). The plan declares
them independent within the round.

Your brief's SEATS block reads:

    SEATS — the operator-approved seats for this spine. Use them verbatim.
    r5.s2.w1 implementer: opus-heavy | anthropic/claude-opus-5 | mode: default | thinking: xhigh
    r5.s2.w1 verifier:    strong-coder-high | acme/strong-v2 | mode: default | thinking: high
    r5.s2.w2 implementer: fast-coder | acme/fast-v1 | mode: default | thinking: (provider default)
    r5.s2.w2 verifier:    strong-coder-high | acme/strong-v2 | mode: default | thinking: high

You checked the block against `SPINE.md` at step 1: both items have exactly
one implementer row and one verifier row, and no row names an item the plan does
not have. A `strong-coder-high` implementer seat from an earlier, unrelated
work item in this run is still alive and idle.

State exactly which seats you create for this round and from which profiles,
how many there are, where they live, whether the two items may proceed at the
same time, and how you satisfy yourself that each seat is running the model
its row names. Say what you do about the idle seat.
