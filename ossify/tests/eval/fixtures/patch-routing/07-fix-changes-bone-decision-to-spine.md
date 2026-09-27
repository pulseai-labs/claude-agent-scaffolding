---
scenario_id: 07-fix-changes-bone-decision-to-spine
expected_outcome: refuse-route-to-spine-bone
expected_reason: The requested fix (fsync before acknowledging a write) sits on ADR-004's touch surface, src/storage/wal/**, and reverses the decision ADR-004 records (acknowledge after the group-commit buffer, fsync every 200 ms). A patch may touch a bone only when it keeps the recorded decision, so this is a spine — a bone spine planned through /ossify:plan-spine, with the ADR revisited there. No patch branch, no version bump, and nothing added to the running spine.
---
PulseDB (`pulseai-labs/PulseDB`, default branch `main`), release r3 open, spine
r3.s1 mid-round in its own worktree; the main checkout is on `main`, clean.

Bones registry: ADR-004 ("WAL durability: group commit") with touch surface
`src/storage/wal/**`. ADR-004's decision text reads: "A write is acknowledged once
it is in the group-commit buffer; the buffer is fsynced every 200 ms. Up to 200 ms
of acknowledged writes may be lost on a crash — accepted for throughput."

Issue #158 is open, labelled `from:pulse-guard-ai`: "After a crash we lose up to
~200 ms of writes PulseDB already acknowledged. We cannot fake durability on our
side. Please fsync before acknowledging." The change the requester proposes is two
lines in `src/storage/wal/commit.rs`. No risk gates are registered. The AI
workspace's `.claude/memory-bank/tech-debt.md` has no line on `src/storage/wal/**`.

The operator says: "/ossify:patch 158 — it's a two-line change."
