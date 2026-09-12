---
scenario_id: 03-touch-check-catches-hit-in-non-canonical-repo
expected_outcome: reclassify
expected_reason: Bone ADR-0301 covers `payments/ledger.go`, a path that exists only in svc-billing — canonical's copy of the repo has no such file. r1.s6's two work items are already merged per repo: canonical's diff (r1.s6.w1) touches only `docs/webhook-retry-notes.md`, a plain doc; svc-billing's diff (r1.s6.w2) touches `payments/ledger.go`, the bone surface. Spine close's touch check must be fed BOTH repos' first-parent diffs concatenated into one call, so the aggregate path list includes `payments/ledger.go` and `oss touch_check` reports the hit — reclassifying r1.s6 from flesh to bone mid-flight (spine-close.md §6.1) and running every remaining row at bone depth. A ceremony still doing `git -C "$canonical" diff --name-only "$merge_sha^1" "$merge_sha"` on canonical alone (pre-#272/#310-Task-9) never builds a path list that includes anything from svc-billing at all — its aggregate is just `docs/webhook-retry-notes.md`, `oss touch_check` reports clean (rc 1), and the spine closes as flesh, at the shallow host-only audit depth, having genuinely modified a bone surface nobody's touch check ever looked at. This is the single most consequential wrong answer in this scenario set: a real bone hit reported as clean because it lived in the repo the old code never reads.
---

`.ossify/topology.json` declares two repos: `canonical` (root
`/Users/ops/repos/product-api`) and `svc-billing` (root
`/Users/ops/repos/svc-billing`). Bone `ADR-0301` ("the ledger write path")
covers the pattern `payments/ledger.go` — registered at release planning,
before this spine started. Spine `r1.s6` ("webhook retry visibility") was
planned and declared as class `flesh`.

`r1.s6` has two work items, both already work-item-closed: `r1.s6.w1`
(`target_repo: canonical`, "document the retry backoff in the webhook
README") and `r1.s6.w2` (`target_repo: svc-billing`, "widen the ledger write
so a retried webhook doesn't double-post"). Both repos are parked on
`spine/r1.s6-webhook-retry-visibility` with their item's commit landed on it.

Spine close's step 2 (the per-repo merge) has just run cleanly in both repos:
canonical's merge commit's first-parent diff is exactly one path,
`docs/webhook-retry-notes.md`. svc-billing's merge commit's first-parent diff
is exactly one path, `payments/ledger.go` — the file `ADR-0301` covers. No
other bones or risk gates are registered. `/close r1.s6` has reached step 5,
the changed-path list and the touch check.


Neither repo has a git remote — spine close's PR arm (#339) never fires here; the local merge arm is the correct one for this world.