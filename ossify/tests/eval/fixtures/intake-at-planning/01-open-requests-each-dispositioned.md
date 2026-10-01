---
scenario_id: 01-open-requests-each-dispositioned
expected_outcome: three-dispositions-closed-ignored
expected_reason: The queue is the open issues whose labels start with from:, listed by filtering labels by that prefix (never --label 'from:*', which gh matches literally). The list is bounded and checked for truncation. #140 fits the range-delete spine and is pulled in as a named work item or AC. #144 is unrelated and large, so it is deferred with a reason (the next release's grooming). #147 is a defect in shipped 0.8.2 behaviour, so it is routed to /ossify:patch. #131 is closed and is not in the queue; #150 and #151 carry no from: label and are not in the queue. Each disposition is written as one line in SPINE.md's Context and as a comment on its issue; nothing about the queue goes into ossify state. The ledger has no line on the spine's surface, which is one line.
---
PulseDB (`pulseai-labs/PulseDB`, remote `origin` = `git@github.com:pulseai-labs/PulseDB.git`,
`gh` authenticated), release r3 open. Spine r3.s2 ("range deletes") is planned by
plan-release and has no work items yet. Its release plan names the areas
`src/storage/delete.rs`, `src/storage/tombstone.rs` and `src/api/delete.rs`.

Issues in the repo:
- #140 open, labels `from:pulse-guard-ai`, `enhancement` — "delete a key range in one call"
- #144 open, label `from:pulsehive` — "embed a vector index in the storage engine"
- #147 open, label `from:pulse-guard-ai` — "`Db::scan` in reverse skips the first key (0.8.2); 0.8.1 did not"
- #131 closed, label `from:pulse-guard-ai` — "export compaction metrics" (shipped in 0.8.0)
- #150 open, label `bug` — "flaky test in tests/net.rs"
- #151 open, label `enhancement` — "rename the CLI's --dir flag"

The AI workspace `/home/dev/projects/PulseDB-ai` has
`.claude/memory-bank/tech-debt.md` with one line:
`- [TD] src/net/server.rs — idle connections are never reaped → #97`.

The operator says: "/ossify:plan-spine r3.s2".
