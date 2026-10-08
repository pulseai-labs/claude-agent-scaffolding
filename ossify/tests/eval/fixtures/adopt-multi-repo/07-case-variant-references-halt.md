---
scenario_id: 07-case-variant-references-halt
expected_outcome: halt
expected_reason: C3 step 1a compares case-folded references under bones-registry §3, names original ADR-C in canonical and adr-c in svc-payments, mints no bone and asks the operator to reconcile the collision
---

The topology declares canonical and svc-payments, both on recorded default
branch main. A0–A5 and C1–C2 passed; every repo and the AI workspace are clean,
no legacy worktrees survive, and the baseline table records each repo's HEAD.

canonical's docs/adr holds ADR-C-hexagonal-core.md.
svc-payments' docs/adr holds adr-c-idempotency.md. The files describe different
decisions. The bones registry is empty. Continue adoption through C3.
