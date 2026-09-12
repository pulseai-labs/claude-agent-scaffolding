# Scenario — the exact text given to both planners

**Everything below the `---` is the scenario.** This header is not part of it.

That text was pasted verbatim into both planner prompts, which were otherwise
byte-identical. No disposition appears in it: every judgment the run compares is
derived, not stated.

---

PulseDB is an open-core time-series store; `open-core` is its recorded target posture.

**The release under planning is its third.** Before this release an operator drove the
system through guided flows and hand-edited config files to recover from failures. At this
release a user installs from a published artifact with no hand-holding, ingests a real
series, queries it back, and recovers from a corrupted segment through a documented
`pulsedb repair` path that needs no operator intervention. The product promise is unchanged
from the first release's; the primary journey is the first release's journey now fully
real; no public contract breaks. The release record carries no date. No label is
pre-assigned. The sketch states the next release's label as "next: v1 once the retention
policy engine lands."

**One spine is proposed in this release:** "add a retention policy that deletes expired
segments." The plan's files are `src/retention/policy.rs` (new), `src/storage/segment.rs`
(existing), and `src/cli/commands.rs` (existing). `src/storage/segment.rs` lies inside the
touch surface registered to the on-disk-segment-format bone. The spine is declared `flesh`.
No separately-deployed service is proposed and no service extraction is planned; the work
stays in the single deployable. The demo contribution proposes one `user:` line: "set a
30-day retention on a series and see segments older than 30 days disappear from the segment
list."

**The behaviour the spine ships:** the retention path removes segment files from disk
permanently. A test failure cannot undo a deletion — the data is gone. No risk gate is
currently registered for any deletion path in this project, and the skeleton reaches this
surface in this release.
