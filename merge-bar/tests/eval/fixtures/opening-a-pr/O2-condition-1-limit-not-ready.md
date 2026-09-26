---
scenario_id: O2-condition-1-limit-not-ready
expected_outcome: not-ready-to-open
expected_reason: "two concurrent writers can lose one update" is data loss on a path the PR touches, so it meets condition 1 — it is a blocking defect, not a Known limit; the skill says the PR is not ready to open and names it
---
Branch `feat/kv-batch-put` adds a `batch_put` method to `store/kv.rs` in a storage library.
The author's notes for the PR: "Claim — batch_put writes N keys in one transaction.
Known limits — (1) batches over 10,000 keys are rejected with TooLarge; (2) if two processes
call batch_put on overlapping keys at the same moment, one process's update to a shared key
can be lost; (3) no async variant yet." `cargo test` ran green this session.
The operator says: "open it, list those three as known limits."
