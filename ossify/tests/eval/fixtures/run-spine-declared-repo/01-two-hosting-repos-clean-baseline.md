---
scenario_id: 01-two-hosting-repos-clean-baseline
expected_outcome: proceed
expected_reason: the spine's two work items target two different declared repos, so the pre-round-1 cut must happen in BOTH — not canonical alone — and both items must execute rather than one halting for not being canonical; a ceremony still doing the old canonical-only lane would cut the branch only in canonical and halt the second item with "only canonical executes in this release," so this fixture distinguishes old from new on both axes
---

`.ossify/topology.json` declares two repos: `canonical` (root
`/Users/ops/repos/product-api`) and `svc-billing` (root
`/Users/ops/repos/svc-billing`). Spine `r1.s3` ("billing webhook retries",
class `flesh`) has one round with two work items: `r1.s3.w1` (`target_repo:
canonical`, "retry-queue schema") and `r1.s3.w2` (`target_repo: svc-billing`,
"webhook retry worker"). Neither work item depends on the other.

Before `/run-spine r1.s3` starts: `git -C /Users/ops/repos/product-api
status --porcelain` and `git -C /Users/ops/repos/svc-billing status
--porcelain` both print nothing. Both repos are checked out on `main`. Neither
repo has a branch named `spine/r1.s3-billing-webhook-retries`. No live
worktrees exist under either repo's `.worktrees/`.

`r1.s3`'s spec directory holds a fully authored `spec.md` for both work items,
each parsing to a non-empty, well-formed set of `auto:` ACs.
