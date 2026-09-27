---
scenario_id: 03-large-request-to-plan-spine
expected_outcome: refuse-route-to-plan-spine
expected_reason: Multi-tenant isolation spans storage, the API, auth and quotas — several work items, far past one — and the consumer cannot fake server-side enforcement. It is a large can't-fake request, so /ossify:patch refuses it and routes it to planning a spine for it now (/ossify:plan-spine under open release r3, or /ossify:plan-release first). It is not added to the running spine r3.s1. No branch is cut, no version is bumped, no PR is opened.
---
PulseDB (`pulseai-labs/PulseDB`, default branch `main`), release r3 open, spine
r3.s1 ("tiered compaction") mid-round. The main checkout is on `main`, clean.

Issue #150 is open, labelled `from:pulse-guard-ai`: "Add multi-tenant isolation —
per-tenant keyspaces, per-tenant write quotas, and a tenant id on every API call.
We can't do this on our side: isolation has to be enforced by the server." The
requester's own note: "this touches the storage layer, the API, auth and the
quota subsystem."

The operator says: "/ossify:patch 150 — they need it soon."
