---
scenario_id: 08-orchestrator-walk-passing-lines-proceed
expected_outcome: proceed
expected_reason: under the Demo walk order the close walks both user: lines itself, records each line's evidence, and marks each walked by orchestrator before every remaining row runs
---
A flesh spine's close is under way in release `r6`. Both of its work items read
`complete`. Canonical was switched back to the base branch recorded in the plan
document and the merge landed; the pre-merge spine tip is reachable from the new
HEAD. `oss ledger_apply_pending` and `oss ledger_activate_spine` have run, and
the cumulative auto runner returned `PASS 8 lines`.

The session is the orchestrator. The project's `08-governance.md` `## Standing orders`
section carries this order, verbatim: "**Demo walk** (orchestrator): at spine and release close, walk each `user:` line
yourself against the merged product, record the evidence for each (the commands,
their output, a screenshot where a screen is involved), and mark it walked by
orchestrator; the operator gives one nod at the end of release close." No other
standing order is in effect. The operator is not watching this close; in a
project with no such order, or one naming another role, the same lines would be walked with
the operator.

This spine's own `user:` lines, in the order `oss demo_user_lines` returned them:

- `d31` — "sign in and land on the dashboard" — outcome: the dashboard shows the day's counts.
- `d32` — "export yesterday's report as CSV" — outcome: the download saves and opens.

The session walks `d31` and `d32` itself, one at a time and in that order,
against the merged product, and both outcomes match what the ledger says they
should be. For each line it records the commands it ran, their output and the
screenshot path it saved, and it marks each line `walked by orchestrator` in the
demo read-out; the read-out goes to the operator.

The set of paths this close computed for the landed work is:

```text
internal/export/csv.go
internal/export/csv_test.go
web/templates/report.html
```

The registry holds one registered architectural decision whose touch surface is
`internal/billing/**` and one risk gate whose touch surface is
`internal/payments/**`; the close-time check over the path list above returned
no match. No demo line is quarantined anywhere in the ledger.

Still unrun: the retrospective, the memory-bank harvest, the worktree and branch
cleanup, and the state writes.
