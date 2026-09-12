---
scenario_id: 04-work-item-merge-guard-checks-its-own-repo
expected_outcome: halt
expected_reason: r1.s7.w2 targets svc-billing, and svc-billing has been manually checked out to `main` by an operator investigating an unrelated production issue mid-spine — it is no longer parked on spine/r1.s7-webhook-status-everywhere. Work-item close must read r1.s7.w2's OWN target_repo (svc-billing), resolve svc-billing's root, and check svc-billing's OWN HEAD against the spine branch — which fails, and the ceremony halts naming svc-billing and the branch it is actually on. A ceremony still resolving `canonical="$(oss repo_root canonical)"` unconditionally (pre-#272/#310-Task-9) ALSO halts here, but for the wrong repo and the wrong reason: canonical hosts r1.s7.w1 (already closed) and is correctly parked on the spine branch, so the old guard's `[ "$head_branch" = "$spine_branch" ]` check PASSES (it is checking canonical, which is fine) — the old code proceeds straight to `git -C "$canonical" merge --no-ff "work/r1.s7.w2-..."`, a branch that exists only in svc-billing and not in canonical, which git refuses with "merge: work/r1.s7.w2-... - not something we can merge" (rc 1). The old block's `|| halt` catches that nonzero rc and prints "close: merge conflict - halt" — a merge-conflict message, when there is no conflict at all and nothing was ever staged toward one. An operator reading that message goes looking for conflict markers that do not exist, instead of noticing svc-billing needs to be checked out back onto the spine branch. Both old and new code halt; only the new code's halt names the actual problem.
---

`.ossify/topology.json` declares two repos: `canonical` (root
`/Users/ops/repos/product-api`) and `svc-billing` (root
`/Users/ops/repos/svc-billing`). Spine `r1.s7` ("webhook status everywhere")
has two work items, in this decomposition order: `r1.s7.w1` (`target_repo:
canonical`, "expose retry status over the internal API") and `r1.s7.w2`
(`target_repo: svc-billing`, "surface retry status in the billing worker's
logs").

`r1.s7.w1` has already been implemented, gated green, staged, and closed —
canonical is parked on `spine/r1.s7-webhook-status-everywhere` with `r1.s7.w1`'s
merge commit on it. `r1.s7.w2`'s four-layer gate is also green, and its
worktree under `svc-billing/.worktrees/r1.s7.w2` has a real staged change
(`git -C .../r1.s7.w2 diff --cached --name-only` prints `worker/logging.go`).

But between `r1.s7.w1`'s close and now, an operator ran `git -C
/Users/ops/repos/svc-billing checkout main` to investigate an unrelated
production alert, and never checked `svc-billing` back out onto
`spine/r1.s7-webhook-status-everywhere` afterward. `git -C
/Users/ops/repos/svc-billing rev-parse --abbrev-ref HEAD` now prints `main`.
`work/r1.s7.w2-worker-logging` is still a real ref in `svc-billing`, unmerged.
`/close r1.s7.w2` is now invoked.
