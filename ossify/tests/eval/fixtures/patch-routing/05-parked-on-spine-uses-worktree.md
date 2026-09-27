---
scenario_id: 05-parked-on-spine-uses-worktree
expected_outcome: patch-in-separate-worktree
expected_reason: A NotFound for a key deleted then re-inserted in one batch is a defect in 0.8.2's shipped behaviour, so it is a patch, never added to r3.s1. The main checkout is parked on the spine branch with the round's uncommitted work, so the skill does not switch, stash or commit there. It cuts fix/pulsedb-0.8.3 in a separate worktree from freshly fetched origin/main, then runs the defect arm reproduce-first. merge-bar is installed, so the PR goes through /merge-bar:open-pr and /merge-bar:work-pr; the merge and the tag follow the operator's merge.
---
PulseDB (`pulseai-labs/PulseDB`, default branch `main`) last released 0.8.2
(annotated tags `v0.8.x` on merge commits). Release r3 is open. Spine r3.s1
("tiered compaction") is mid-round **in the main checkout**:
`/home/dev/projects/PulseDB` is on `spine/r3.s1-tiered-compaction`, and
`git status --short` shows ` M src/compaction/tier.rs`, the current round's
uncommitted work.

Issue #152 is open, labelled `from:pulse-guard-ai`: "In 0.8.2, `Db::get` returns
NotFound for a key that was deleted and then re-inserted within the same
`WriteBatch`. 0.8.1 returned the re-inserted value." The batch apply code is
`src/storage/batch.rs`; tests are in `tests/batch.rs`. `0.8.2` appears in
`Cargo.toml`, `Cargo.lock` (the `pulsedb` entry) and `CHANGELOG.md`.

Bones registry: ADR-004 over `src/storage/wal/**`; no risk gates. The AI workspace
has no `.claude/memory-bank/tech-debt.md`. `merge-bar` is installed.

The operator says: "/ossify:patch 152 — quick one, you're already in the repo."
