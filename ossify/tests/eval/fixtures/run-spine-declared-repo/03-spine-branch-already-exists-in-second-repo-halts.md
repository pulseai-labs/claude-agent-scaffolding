---
scenario_id: 03-spine-branch-already-exists-in-second-repo-halts
expected_outcome: halt
expected_reason: the already-exists guard (issue 133) must be checked against EVERY hosting repo, not canonical alone — svc-billing still carries a stale branch named spine/r1.s4-invoice-export-pipeline from a botched earlier attempt, even though canonical's copy was deleted and it would cut cleanly on its own; the §2 loop halts on this before any item is dispatched, and canonical alone gives no evidence of the collision regardless of iteration order. A ceremony still doing the old canonical-only lane also halts, but for a different reason and later — its §2 only ever touches canonical (no branch there, so the old cut succeeds and canonical is checked out on the spine branch), so it proceeds to spawn r1.s4.w1 (target_repo canonical) — journaling that worktree as active — before r1.s4.w2 (target_repo svc-billing) trips the old §3 guard `[ "$target_repo" = "canonical" ] || halt`, which fires unconditionally. The old lane never runs `show-ref` against svc-billing at all, so it never discovers the stale branch; its halt is "not canonical," not "collision," and it fires only after real work (r1.s4.w1's worktree, the canonical cut) already happened
---

`.ossify/topology.json` declares two repos: `canonical` (root
`/Users/ops/repos/product-api`) and `svc-billing` (root
`/Users/ops/repos/svc-billing`). Spine `r1.s4` ("invoice export pipeline")
has one round with two work items: `r1.s4.w1` (`target_repo: canonical`) and
`r1.s4.w2` (`target_repo: svc-billing`).

A first `/run-spine r1.s4` was invoked yesterday, cut the spine branch in
both hosting repos, and got as far as merging `r1.s4.w1` before a bad merge
forced the operator to abandon the attempt. To retry cleanly, the operator
deleted `spine/r1.s4-invoice-export-pipeline` in `canonical` (`git -C
/Users/ops/repos/product-api branch -D spine/r1.s4-invoice-export-pipeline`)
and reset `product-api` back to `main` — but forgot `svc-billing` still
carries the same branch name, never deleted, still pointing at yesterday's
cut.

Now, at the start of a fresh `/run-spine r1.s4`: `git -C
/Users/ops/repos/product-api status --porcelain` prints nothing, and
`product-api` is checked out on `main` with no branch named
`spine/r1.s4-invoice-export-pipeline` — the delete above removed it cleanly.
`git -C /Users/ops/repos/svc-billing status --porcelain` also prints
nothing — `svc-billing` is clean — but `git -C /Users/ops/repos/svc-billing
show-ref --verify --quiet refs/heads/spine/r1.s4-invoice-export-pipeline`
succeeds: the branch is still there, though `svc-billing` is currently
checked out on `main`, not on the spine branch. No live worktrees exist
under either repo's `.worktrees/`.
