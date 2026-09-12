---
scenario_id: 04-third-declared-repo-item-executes
expected_outcome: proceed
expected_reason: r1.s5.w2's target_repo is analytics-pipeline — a declared repo that is neither canonical nor the spine's other hosting repo — so it must get a worktree, a dispatch, and a handoff whose repo field reads analytics-pipeline, exactly like a canonical-targeted item would; a ceremony still carrying the old `[ "$target_repo" = "canonical" ]` guard halts this item outright with "only canonical executes in this release" regardless of analytics-pipeline being declared, which is the wrong answer this fixture falsifies
---

`.ossify/topology.json` declares three repos: `canonical` (root
`/Users/ops/repos/product-api`), `svc-billing` (root
`/Users/ops/repos/svc-billing`), and `analytics-pipeline` (root
`/Users/ops/repos/analytics-pipeline`). Spine `r1.s5` ("cross-repo billing
analytics") has one round with two work items: `r1.s5.w1` (`target_repo:
svc-billing`, "emit billing events") and `r1.s5.w2` (`target_repo:
analytics-pipeline`, "ingest billing events into the warehouse"). Neither
canonical nor `r1.s5.w1` blocks `r1.s5.w2` — they are independent.

The pre-round-1 cut already ran cleanly: `spine/r1.s5-cross-repo-billing-analytics`
is checked out in both `svc-billing` and `analytics-pipeline` (the spine's two
hosting repos — canonical hosts no item of this spine and was never touched).
`r1.s5.w1` has already been dispatched, completed, and merged onto the spine
branch in `svc-billing`. `r1.s5.w2`'s spec parses to a non-empty, well-formed
set of `auto:` ACs, and no worktree yet exists for it. `.worktrees/` under
`analytics-pipeline` is otherwise empty.
