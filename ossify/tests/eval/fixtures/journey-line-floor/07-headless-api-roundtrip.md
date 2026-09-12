---
scenario_id: 07-headless-api-roundtrip
expected_verdict: accept
expected_reason: a downstream API round trip is a verb + observable value outcome; no UI is invented
---
A headless library with no UI proposes its `user:` line as: "a downstream service posts a batch of records and receives the transformed results in one round trip." The library has no user interface and invents none; the actor is a downstream service and the observable outcome is the transformed batch returned. This is not an internal `auto:`-only spine, so no named consumer is owed; and no deepening pass claims a measured quality, so no before/after evidence is owed.
