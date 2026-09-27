---
scenario_id: 02-retired-code-gone
expected_outcome: retire-with-evidence
expected_reason: The legacy_index line overlaps the index area this spine plans, and the code it names is gone — ls-files prints nothing and the deletion commit is known. It is retired: the evidence is shown, the line is deleted from tech-debt.md in the AI workspace, and the retirement is noted in SPINE.md. The other line does not overlap and is not listed.
---
PulseDB, release r3. Spine r3.s3 ("secondary indexes") is planned with no work
items yet; its release plan names `src/index/**`. No open issue carries a `from:`
label.

`/home/dev/projects/PulseDB-ai/.claude/memory-bank/tech-debt.md`:

- [KL] src/legacy_index/btree.rs — range lookups on the legacy index are O(n) — accepted: legacy index is read-only — revisit when src/index replaces it (PR #61)
- [TD] src/net/server.rs — idle connections are never reaped → #97

`git -C /home/dev/projects/PulseDB ls-files src/legacy_index` prints nothing.
`git -C /home/dev/projects/PulseDB log --diff-filter=D --format=%h -1 -- src/legacy_index`
prints `a1b2c3d` (the 0.8.0 commit that removed it).

The operator says: "/ossify:plan-spine r3.s3".
