---
scenario_id: 02-second-hosting-repo-dirty-halts
expected_outcome: halt
expected_reason: the pre-round-1 dirty-tree check must run against EVERY repo hosting one of the spine's items, not canonical alone — svc-billing's dirty tree halts the §2 cut, before any item is dispatched, even though canonical is clean and would otherwise cut without incident. A ceremony still doing the old canonical-only lane also halts, but for a different reason and later — its §2 only ever touches canonical (clean, so the old cut succeeds), so it proceeds to spawn r1.s3.w1 (target_repo canonical) — journaling that worktree as active — before r1.s3.w2 (target_repo svc-billing) trips the old §3 guard `[ "$target_repo" = "canonical" ] || halt`, which fires unconditionally regardless of svc-billing's tree state. The old lane never inspects svc-billing's working tree at all; its halt is "not canonical," not "dirty," and it fires only after r1.s3.w1's worktree already exists and is journaled active — the dirty tree is a latent hazard the old halt happens to mask, not one it catches
---

`.ossify/topology.json` declares two repos: `canonical` (root
`/Users/ops/repos/product-api`) and `svc-billing` (root
`/Users/ops/repos/svc-billing`). Spine `r1.s3` ("billing webhook retries")
has one round with two work items: `r1.s3.w1` (`target_repo: canonical`) and
`r1.s3.w2` (`target_repo: svc-billing`).

Before `/run-spine r1.s3` starts: `git -C /Users/ops/repos/product-api
status --porcelain` prints nothing. `git -C /Users/ops/repos/svc-billing
status --porcelain` prints one line (the leading space is the porcelain
unstaged-modification column, and it is significant):

```text
 M src/webhooks/retry.go
```

an
uncommitted edit left over from manual debugging earlier the same day. Both
repos are checked out on `main`. Neither repo has a branch named
`spine/r1.s3-billing-webhook-retries` yet. No live worktrees exist under
either repo's `.worktrees/`.

`r1.s3`'s spec directory holds a fully authored `spec.md` for both work
items, each parsing to a non-empty, well-formed set of `auto:` ACs.
