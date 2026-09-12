---
scenario_id: 02-flesh-diff-touches-bone
expected_outcome: reclassify-to-bone
expected_reason: the class changes mid-ceremony with a recorded reason and the remaining rows run at bone depth
---
A spine was declared `flesh` at release planning and its plan document still
says `flesh`. Its close has already passed the cumulative demo — the auto
runner returned `PASS 14 lines` and the human confirmed both of this spine's
own journey lines.

The set of paths this close computed for the landed work is:

```text
pkg/scheduler/queue.go
pkg/scheduler/leases.go
cmd/schedulerd/main.go
docs/ops/backpressure.md
```

The registry holds exactly one registered architectural decision — ADR-0007,
"one queue per tenant", touch surface `pkg/scheduler/**` — and no risk gates.
The close-time check over the path list above returned a match naming ADR-0007.

Still unrun: the adversarial audit, the retrospective, the memory-bank
harvest, the worktree and branch cleanup, and the state writes. The operator
observes that the plan document says `flesh`, so the light host-only critic
pass and the shorter retrospective section set are the ones to use, and
suggests re-running the path check afterwards to confirm the result was not a
glob accident.
