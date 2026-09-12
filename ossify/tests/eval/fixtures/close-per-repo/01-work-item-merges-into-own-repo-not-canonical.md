---
scenario_id: 01-work-item-merges-into-own-repo-not-canonical
expected_outcome: proceed
expected_reason: r1.s3.w1's target_repo is svc-billing, and svc-billing hosts every item of this spine — canonical hosts none of it, so the pre-round-1 cut (round-orchestration.md §2) never touched canonical at all, and canonical is still parked on main. Work-item close must read r1.s3.w1's OWN target_repo from state, resolve svc-billing's root, and run the commit/guard/merge entirely there — it succeeds, because svc-billing really is parked on spine/r1.s3-solo-svc-migration and the worktree has a real staged change. A ceremony still resolving `canonical="$(oss repo_root canonical)"` unconditionally (the pre-#272/#310-Task-9 form) never even looks at svc-billing: it reads canonical's HEAD, finds it on `main`, and halts immediately with "close: canonical is on 'main', not 'spine/r1.s3-solo-svc-migration' - halt" — before the commit, before the merge, before anything reaches svc-billing. That halt fires for EVERY item of a spine that never touches canonical, regardless of how ready the item's actual repo is. This is the specific wrong answer this fixture falsifies: a real, closeable item halting for a repo it was never going to touch.
---

`.ossify/topology.json` declares two repos: `canonical` (root
`/Users/ops/repos/product-api`) and `svc-billing` (root
`/Users/ops/repos/svc-billing`). Spine `r1.s3` ("solo svc-billing migration",
class `flesh`) has one round with a single work item: `r1.s3.w1`
(`target_repo: svc-billing`, "migrate the retry-queue schema"). No item of
this spine targets canonical.

The pre-round-1 cut already ran cleanly: `spine/r1.s3-solo-svc-migration` is
checked out in `svc-billing` (its one hosting repo). `canonical` was never
touched by this spine's cut — it is still checked out on `main`, exactly
where it was before `/run-spine r1.s3` ran, and `git -C
/Users/ops/repos/product-api status --porcelain` prints nothing.

`r1.s3.w1` has been implemented: the four-layer gate is green, and `git -C
/Users/ops/repos/svc-billing/.worktrees/r1.s3.w1 diff --cached --name-only`
prints one staged file, `retry_queue/schema.sql`. `work_items[]` in state
records `r1.s3.w1`'s `branch` as `work/r1.s3.w1-retry-queue-schema` and its
`worktree_path` as that same worktree. `svc-billing` is currently checked out
on `spine/r1.s3-solo-svc-migration`, with `work/r1.s3.w1-retry-queue-schema`
resolvable as a real ref there. `/close r1.s3.w1` is now invoked.
