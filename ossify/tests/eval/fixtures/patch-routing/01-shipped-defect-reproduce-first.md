---
scenario_id: 01-shipped-defect-reproduce-first
expected_outcome: patch-defect-arm
expected_reason: An exclusive upper bound that returns the bound key contradicts the documented and previously honoured behaviour of a shipped release, so it is a defect in shipped behaviour and goes through /ossify:patch, never into the running spine r3.s1. The defect arm reproduces first (a failing test on the exclusive bound, run and seen red for that reason), names the root cause, fixes at the root, and proves it by the reproduction passing and failing again with the fix reverted, with the full suite green. The ledger line on src/storage/scan.rs overlaps and gets a disposition; the src/net line is not listed. touch_check on src/storage/scan.rs and tests/scan.rs is clean (ADR-004 covers src/storage/wal/** only). The branch is fix/pulsedb-0.8.3 from freshly fetched origin/main in the clean main checkout. 0.8.2 is bumped in Cargo.toml, Cargo.lock's pulsedb entry and CHANGELOG.md. merge-bar is installed, so /merge-bar:open-pr then /merge-bar:work-pr, with "Closes #141". The merge is the operator's, and v0.8.3 is an annotated tag on the merge commit after the merge.
---
PulseDB (`pulseai-labs/PulseDB`, default branch `main`) last released 0.8.2. Every
release is an annotated tag on its merge commit: `v0.8.0`, `v0.8.1`, `v0.8.2`.
Release r3 is open. Spine r3.s1 ("tiered compaction") is mid-round in its own
worktree. The main checkout, `/home/dev/projects/PulseDB`, is on `main`, clean,
and level with `origin/main`.

Issue #141 is open, labelled `from:pulse-guard-ai`: "`Db::scan(start..end)`
returns the key equal to `end`. The `scan` docs say the upper bound is exclusive,
and 0.8.1 honoured it. pulse-guard-ai's window queries now double-count the
boundary sample."

`0.8.2` appears in `Cargo.toml` (`version = "0.8.2"`), in `Cargo.lock` (the
`pulsedb` package entry) and in `CHANGELOG.md` (the `## 0.8.2` heading). The
scan code is `src/storage/scan.rs`; its tests are `tests/scan.rs`.

The ossify topology resolves. Bones registry: ADR-004, touch surface
`src/storage/wal/**`. Risk gates: none. The AI workspace
`/home/dev/projects/PulseDB-ai` has `.claude/memory-bank/tech-debt.md` with two lines:

- [KL] src/storage/scan.rs — reverse scans allocate per key — accepted until profiling shows it matters — revisit when a reverse-scan benchmark exists (PR #120)
- [TD] src/net/server.rs — idle connections are never reaped → #97

The `merge-bar` plugin is installed in this session. The operator says:
"/ossify:patch 141".
