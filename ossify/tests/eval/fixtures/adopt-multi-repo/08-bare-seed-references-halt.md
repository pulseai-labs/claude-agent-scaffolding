---
scenario_id: 08-bare-seed-references-halt
expected_outcome: halt
expected_reason: C3 step 1a maps both bare seed filenames to ADR-0001, names 0001-hexagonal-core.md in canonical and 0001-idempotency.md in svc-payments, mints no bone and asks the operator to reconcile the collision
---

The topology declares canonical and svc-payments, both on recorded default
branch main. A0–A5 and C1–C2 passed; every repo and the AI workspace are clean,
no legacy worktrees survive, and the baseline table records each repo's HEAD.

canonical's docs/adr holds 0001-hexagonal-core.md.
svc-payments' docs/adr holds 0001-idempotency.md. The files describe different
decisions. Each would be registered as ADR-0001 under bones-registry §3's
filename convention. The bones registry is empty. Continue adoption through C3.
