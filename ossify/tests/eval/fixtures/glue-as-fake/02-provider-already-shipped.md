---
scenario_id: 02-provider-already-shipped
expected_outcome: adopt-no-fake
expected_reason: The provider has already shipped the capability, so there is nothing to wait for and nothing to fake. The spine adopts PulseDB 0.9.0 (the dependency bump and get_many belong to a work item). No glue, no fake_add, no intake issue.
---
pulse-guard-ai, release r2 open, spine r2.s3 ("anomaly windows") being planned. It
needs batch reads from PulseDB. PulseDB 0.9.0 shipped last week; its CHANGELOG
reads `## 0.9.0 — Db::get_many(keys) reads a batch in one call`. pulse-guard-ai
still depends on 0.8.2.

The operator says: "/ossify:plan-spine r2.s3 — we need batch reads."
