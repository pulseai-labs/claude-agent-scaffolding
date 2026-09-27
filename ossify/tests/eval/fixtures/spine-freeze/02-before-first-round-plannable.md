---
scenario_id: 02-before-first-round-plannable
expected_outcome: plan-into-spine
expected_reason: r3.s2 has not started — both items are planned, none dispatched — so the freeze does not apply. The request serves the spine's goal and is planned into it (a new AC on w1, or an added item), recorded as "pulled in" against its intake issue #142.
---
PulseDB, release r3, spine r3.s2 ("range deletes"). State: w1 and w2 both
`planned`; no worktree exists and no work item records a dispatch.

Issue #142 is open, labelled `from:pulse-guard-ai`: "When you ship range deletes,
could `delete_range` return how many keys it removed? We need the count for the
audit log."

The operator says: "/ossify:plan-spine r3.s2 — can we fit #142 in?"
