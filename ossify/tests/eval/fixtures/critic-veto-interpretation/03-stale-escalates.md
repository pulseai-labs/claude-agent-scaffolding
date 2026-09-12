---
scenario_id: 03-stale-escalates
expected_disposition: escalate
---
The audit's finding on spine r0.s4 references a module (`src/legacy/adapter.rs`) that no longer exists in the current plan — the finding is stale relative to the spine's actual scope.
