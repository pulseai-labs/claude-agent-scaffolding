---
scenario_id: 04-own-demo-amendment-still-allowed
expected_outcome: amendment-allowed
expected_reason: Superseding an accumulated demo line whose flow this spine changes is the spine's own amendment path (§8e), not new scope, so the freeze does not block it. It is recorded now with ledger_supersede and a reason, and applied at r3.s1's close.
---
PulseDB, release r3, spine r3.s1 ("tiered compaction"), w1 `complete`, w2
`active`. w1 replaced the `pulsedb compact` CLI entry point with
`pulsedb admin compact`. The cumulative demo ledger holds `d3`, an `auto:` line
running `pulsedb compact --dry-run`, which the new entry point retires.

The operator says: "/ossify:plan-spine r3.s1 — d3 runs the old compact command;
point it at the new one."
