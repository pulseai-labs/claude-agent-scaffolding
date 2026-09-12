---
scenario_id: 03-parallel-fresh-pairs-exact-profiles
expected_outcome: proceed
expected_reason: 'THE DISCRIMINATING FIXTURE for this surface. Each item gets its
  own FRESH implementer terminal launched from that items ratified sidecar row, using
  the exact command as written - including a native claude --model ... --effort ...
  command, which is a legitimate row value here even though the generic role table
  launches by alias. TWO terminals for two items at this point, not four: the verifier
  is NOT created at round launch, because it has nothing to verify until that items
  complete return and fingerprint exist; it is created and dispatched later, from
  its own row command. Both terminals live in the child Run and the two items may
  run concurrently. The model is confirmed from the launch banner and the first reply;
  the effort is the launch argument, with no runtime attestation. The wrong answers
  this fixture falsifies are: dispatching one lane-driver session that spawns per-item
  subagents through the Agent tool (which is what the pre-change contract prescribed);
  creating all four terminals now, which gives each verifier nothing to do and a stale
  worktree to sit on; reusing one implementer across both items because it is retained
  by the generic rule; and rewriting the native command to an alias because alias,
  never --model is the general rule - that rule governs the generic seats, not a ratified
  sidecar row'
---

You are the spine session for `r5.s2`, with a bound child Run. Round 1 holds two
work items whose worktrees, handoffs and execution requests are ready:
`r5.s2.w1` ("export schema") and `r5.s2.w2` ("CSV writer"). The plan declares
them independent within the round.

The ratified sidecar's binding assignments read:

| work_item_id | implementer_terminal_command | implementer_expected_model | implementer_effort | verifier_terminal_command | verifier_expected_model | verifier_effort |
|---|---|---|---|---|---|---|
| r5.s2.w1 | claude --model claude-opus-5 --effort xhigh | claude-opus-5 | xhigh | claude-glm --effort high | glm-5.3 | high |
| r5.s2.w2 | claude-glm-flash | glm-5.3-flash | (alias default) | claude-glm --effort high | glm-5.3 | high |

`SPINE.md` hashes to the sidecar's recorded plan digest, both items have exactly
one complete row, and no row names an item the plan does not have. The sidecar's
`ratification` reads `operator-approved`, its `ratified_in_run` is the parent Run
you were dispatched from, and its `spine_id` is `r5.s2`. A `claude-glm` implementer terminal from an earlier, unrelated
work item in this Run is still alive and idle.

State exactly which terminals you create for this round and with what commands,
how many there are, where they live, whether the two items may proceed at the
same time, and how you satisfy yourself that each terminal is running the model
its row names. Say what you do about the idle terminal.
