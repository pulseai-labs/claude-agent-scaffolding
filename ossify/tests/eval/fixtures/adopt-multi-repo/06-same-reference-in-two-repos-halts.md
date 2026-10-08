---
scenario_id: 06-same-reference-in-two-repos-halts
expected_outcome: halt
expected_reason: C3 step 1a names colliding ADR-0001 and both canonical and svc-payments from the inventory, mints no bone, does not renumber source ADRs and does not qualify the reference with a repo key
---

The topology declares canonical and svc-payments, both on their recorded default
branch main. A0–A5 pass: both repos and the AI workspace are clean, there are no
live legacy worktrees, and the legacy cursor is on a boundary. C1 and C2 passed;
the baseline table records one HEAD per declared repo.

canonical's docs/adr directory holds ADR-0001-hexagonal-core.md, governing
src/domain/**. svc-payments holds ADR-0001-idempotency-key-on-charge-create.md,
governing src/payments/idempotency.rs. They describe different decisions.
The bones registry is empty. The operator asks adoption to continue through C3.
