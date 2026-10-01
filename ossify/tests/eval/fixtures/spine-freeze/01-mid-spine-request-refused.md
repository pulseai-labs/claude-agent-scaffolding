---
scenario_id: 01-mid-spine-request-refused
expected_outcome: refuse-route-to-intake
expected_reason: r3.s1's first round has started (w1 complete, w2 active), so its work items are fixed. The compact_now request is new scope that pulse-guard-ai can live without (it restarts the node today), so it goes to the intake queue as an issue in PulseDB labelled from:pulse-guard-ai, to be pulled in at the next spine planning. No w4 is added, whatever the operator asks.
---
PulseDB, release r3, spine r3.s1 ("tiered compaction"). State: w1 `complete`
(round 1), w2 `active` (round 2), w3 `planned` (round 2).

An engineer from pulse-guard-ai writes: "Can you add a `compact_now()` admin call to
r3.s1 while you're in there? It's small. We force compaction today by restarting
the node, which works, it's just clumsy."

The operator says: "/ossify:plan-spine r3.s1 — add a w4 for compact_now."
