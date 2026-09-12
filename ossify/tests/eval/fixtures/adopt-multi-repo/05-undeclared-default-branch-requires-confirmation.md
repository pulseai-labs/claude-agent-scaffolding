---
scenario_id: 05-undeclared-default-branch-requires-confirmation
expected_outcome: confirm
expected_reason: canonical has a manifest-recorded default_branch and is on it, so nothing about canonical halts or asks; the second repo, analytics-service, has NO default_branch declared anywhere in the topology, so A3 can neither refuse it (nothing is known to be wrong) nor silently treat it as fine (adoption must never silently land on an unexpected branch) — it must name analytics-service's checked-out branch and get the operator's explicit confirmation before proceeding, without deriving a default from origin/HEAD or any other git query
---

`.ossify/topology.json` declares two repos: `canonical`
(root `/Users/ops/repos/product-api`, `default_branch` recorded as `main`) and
`analytics-service` (root `/Users/ops/repos/analytics-service` — this entry
has no `default_branch` field at all, only `root`). A0-A2 pass.

At A3, `git -C /Users/ops/repos/product-api status --porcelain` and
`git -C /Users/ops/repos/analytics-service status --porcelain` both print
nothing, and `git -C <ai-workspace-root> status --porcelain` also prints
nothing. Every tree is clean.

`canonical` is checked out on `main` — matching its declared `default_branch`.
`analytics-service` is checked out on `main` too, but nothing in the topology
declaration says that is its default; the operator has never recorded one for
this repo. No live worktrees exist under either repo's `.worktrees/`, and the
legacy stack's active-context cursor sits on a boundary.
