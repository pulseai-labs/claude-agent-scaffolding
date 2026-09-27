---
scenario_id: 01-overlap-only
expected_outcome: one-line-surfaced
expected_reason: Only the tombstone line overlaps the spine's planned paths, so only it is surfaced. It gets one disposition — pulled in as an AC of the item that writes tombstones, or still accepted with its reason, noting that its revisit trigger (r3.s1 closing) has not fired because r3.s1 is still running. The src/net and src/storage/wal lines are not listed. Nothing is written to state or to the PulseDB repo.
---
PulseDB, release r3. Spine r3.s2 ("range deletes") is planned with no work items
yet; its release plan names `src/storage/delete.rs`, `src/storage/tombstone.rs` and
`src/api/delete.rs`. Spine r3.s1 is still running. No open issue carries a `from:`
label.

`/home/dev/projects/PulseDB-ai/.claude/memory-bank/tech-debt.md`:

- [KL] src/storage/tombstone.rs — tombstones are never compacted below L2 — accepted: L2 compaction lands with r3.s1 — revisit when r3.s1 closes (PR #131)
- [TD] src/net/server.rs — idle connections are never reaped → #97
- [KL] src/storage/wal/ — WAL segments are not checksummed — accepted: single-node only — revisit when replication ships (PR #118)

The operator says: "/ossify:plan-spine r3.s2".
