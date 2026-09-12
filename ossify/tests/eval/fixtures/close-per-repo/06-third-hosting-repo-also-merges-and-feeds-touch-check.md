---
scenario_id: 06-third-hosting-repo-also-merges-and-feeds-touch-check
expected_outcome: proceed
expected_reason: r1.s10 hosts work in THREE declared repos — canonical, svc-billing, and analytics-pipeline — not just canonical plus one other. All three are already work-item-closed and parked on spine/r1.s10-cross-repo-fanout-metrics with a resolvable base_branch (main in each). The spine-close loop must resolve and merge in EVERY ONE of the three — an implementation that generalized only as far as "canonical plus a second repo" (the shape a two-repo test fixture alone would validate) still fails analytics-pipeline exactly the way the pre-#272/#310-Task-9 single-repo form failed every non-canonical repo: analytics-pipeline never gets checked out to its base, never gets merged, and its spine branch is left dangling — even though nothing about this fixture involves a bone or a conflict. The same breadth question applies to the touch check: the aggregate path list must include analytics-pipeline's first-parent diff alongside the other two, not just two of the three, or a bone/risk-gate surface touched only in the third repo would be as invisible as one touched only in svc-billing was in fixture 03.
---

`.ossify/topology.json` declares three repos: `canonical` (root
`/Users/ops/repos/product-api`), `svc-billing` (root
`/Users/ops/repos/svc-billing`), and `analytics-pipeline` (root
`/Users/ops/repos/analytics-pipeline`). Spine `r1.s10` ("cross-repo fan-out
metrics", class `flesh`) has three work items, one per repo: `r1.s10.w1`
(`target_repo: canonical`, "emit a fan-out-started event"), `r1.s10.w2`
(`target_repo: svc-billing`, "emit a fan-out-completed event"), and
`r1.s10.w3` (`target_repo: analytics-pipeline`, "ingest both events into the
dashboard").

All three items are already work-item-closed. All three repos are checked out
on `spine/r1.s10-cross-repo-fanout-metrics`, each with its own item's merge
commit on the branch. Each repo's handoffs record `base_branch: main`,
matching `SPINE.md`'s spine-context section for that repo. No repo's working
tree is dirty, and merging the spine branch into `main` applies cleanly in
all three — there is no conflict anywhere.

None of the three repos has a git remote — spine close's PR arm (#339) never fires here; the local merge arm is the correct one for this world.

No bone or risk gate is registered over any path any of the three repos'
diffs touch. The cumulative demo's `auto:` lines all pass against the
composed tree. `/close r1.s10` is now invoked.
