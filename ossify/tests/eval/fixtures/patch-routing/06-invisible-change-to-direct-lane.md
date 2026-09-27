---
scenario_id: 06-invisible-change-to-direct-lane
expected_outcome: refuse-route-to-direct-commit-lane
expected_reason: A typo in a source comment that no generated doc renders changes nothing a user or a demo line can observe, so it needs no version and no PR lane. /ossify:patch refuses it and routes it to close's direct-commit patch lane (close/references/patch-lane.md — touch_check, a commit on the base branch, patch_add). No fix/ branch, no version bump, no tag.
---
PulseDB (`pulseai-labs/PulseDB`, default branch `main`). The main checkout is on
`main`, clean. No API documentation is generated or published from source
comments, and no demo line reads comments.

Issue #155 is open, labelled `from:pulse-guard-ai`: "Typo in the doc comment on
`Db::scan` in `src/storage/scan.rs`: 'exlusive' should be 'exclusive'."

The operator says: "/ossify:patch 155".
