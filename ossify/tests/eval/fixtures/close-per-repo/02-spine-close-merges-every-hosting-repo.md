---
scenario_id: 02-spine-close-merges-every-hosting-repo
expected_outcome: proceed
expected_reason: r1.s4 hosts items in two repos — canonical (r1.s4.w1) and svc-billing (r1.s4.w2) — both already work-item-closed, so both repos are still parked on spine/r1.s4-billing-webhook-fanout with their item's commit on it, and both have a resolvable base_branch (main in each). Spine close must switch EACH hosting repo back to its own base and merge there — landing r1.s4.w1's work in canonical/main AND r1.s4.w2's work in svc-billing/main — before the spine is complete. The discriminating fact here is NOT the top-level halt/proceed verdict — a ceremony still doing `canonical="$(oss repo_root canonical)"` unconditionally (pre-#272/#310-Task-9) ALSO returns proceed, because canonical hosts r1.s4.w1 and is correctly parked on the spine branch, so its single-repo merge succeeds and `oss spine_status r1.s4 closed` gets written. What differs is WHAT actually got merged: the old single-repo form never resolves or touches svc-billing at all — svc-billing stays checked out on spine/r1.s4-billing-webhook-fanout forever, r1.s4.w2's commit never reaches svc-billing/main, and the ceremony reports the spine closed anyway. A judgment that says "proceed" without naming that BOTH repos' merges must land — or that only checks canonical's merge before calling the spine closed — reproduces exactly that silent gap.
---

`.ossify/topology.json` declares two repos: `canonical` (root
`/Users/ops/repos/product-api`) and `svc-billing` (root
`/Users/ops/repos/svc-billing`). Spine `r1.s4` ("billing webhook fan-out",
class `flesh`) has two work items, already closed: `r1.s4.w1` (`target_repo:
canonical`, "add fan-out queue") and `r1.s4.w2` (`target_repo: svc-billing`,
"emit webhook events onto it"). `work_items[]` in state shows both `status:
complete`.

`canonical` is checked out on `spine/r1.s4-billing-webhook-fanout`; its tip is
`r1.s4.w1`'s merge commit, one commit ahead of `main`. `svc-billing` is
checked out on `spine/r1.s4-billing-webhook-fanout` too; its tip is `r1.s4.w2`'s
merge commit, one commit ahead of `main` there. Both handoffs' `## 2. Spine
context` sections record `base_branch: main` for their own repo, matching
`SPINE.md`'s spine-context section for both. Neither repo's working tree is
dirty. No merge conflicts are present in either repo — a plain fast-forward-free
merge of the spine branch into `main` applies cleanly in both.

Neither repo has a git remote — spine close's PR arm (#339) never fires here; the local merge arm is the correct one for this world.

The cumulative demo's `auto:` lines all pass against the composed tree. No
bone or risk-gate surface is touched by either repo's diff. `/close r1.s4` is
now invoked.
