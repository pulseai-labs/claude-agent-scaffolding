---
scenario_id: 02-third-repo-off-default-branch-halts
expected_outcome: halt
expected_reason: every declared repo's checked-out branch must be compared to its own default, not canonical's alone; the third repo's tree is clean but it is parked on a feature branch, and adoption must halt naming it rather than proceeding because every working tree is clean
---

`.ossify/topology.json` declares three repos: `canonical`
(root `/Users/ops/repos/product-api`, default branch `main`), `svc-billing`
(root `/Users/ops/repos/svc-billing`, default branch `main`), and
`data-pipeline` (root `/Users/ops/repos/data-pipeline`, default branch
`main`). A0-A2 all pass, exactly as a clean run would.

At A3, the working-tree sweep finds every tree clean: `git status --porcelain`
against canonical, `svc-billing`, `data-pipeline`, and the AI workspace all
print nothing. No dirty lines anywhere.

The branch check that follows: canonical is checked out on `main`.
`svc-billing` is checked out on `main`. `data-pipeline` is checked out on
`feature/retention-cleanup` — a branch cut mid-slice under the legacy stack
and never merged or abandoned back to `main`. No live worktrees exist under
any repo's `.worktrees/`, and the legacy stack's active-context cursor sits
on a boundary.
