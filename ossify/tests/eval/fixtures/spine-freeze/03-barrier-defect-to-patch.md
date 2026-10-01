---
scenario_id: 03-barrier-defect-to-patch
expected_outcome: barrier-unchanged-route-to-patch
expected_reason: At the round-1 barrier the spine's items are fixed. #147 is a defect in shipped 0.8.2 behaviour, so it goes to /ossify:patch, not in as w4. Round 2 starts with w2 and w3 exactly as planned, because every round-1 item is complete.
---
`/ossify:run-spine r3.s1` is running PulseDB's spine r3.s1. Round 1 (w1) is
`complete` and merged into the spine branch; round 2 holds w2 and w3, both `planned`.

At the barrier the operator says: "Before round 2, slip in a fix for #147 — the
reverse-scan bug pulse-guard hit in 0.8.2. Just add it as w4 in round 2."

Issue #147 is open, labelled `from:pulse-guard-ai`: "`Db::scan` in reverse skips the
first key (0.8.2); 0.8.1 did not."
