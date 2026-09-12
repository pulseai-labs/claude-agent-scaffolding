---
scenario_id: 05-ai-workspace-target-halts-despite-resolving
expected_outcome: halt
expected_reason: r1.s6.w2's target_repo is ai_workspace, which DOES resolve via oss repo_root (rc 0 — it is the reserved process-record key, and the AI workspace is itself a git repo), so a naive "does the repo resolve" check would wrongly let this item execute; the item must halt specifically because ai_workspace is excluded as an execution target, not because resolution failed. This is the specific wrong answer the fixture falsifies — a model that drops the explicit ai_workspace exclusion and only checks resolution success spawns a worktree inside the AI workspace instead of halting
---

`.ossify/topology.json` declares two repos: `canonical` (root
`/Users/ops/repos/product-api`) and `svc-billing` (root
`/Users/ops/repos/svc-billing`). Spine `r1.s6` ("billing ops tooling") has
one round with two work items, in this decomposition order: `r1.s6.w1`
(`target_repo: canonical`, "ops CLI flag") and `r1.s6.w2` (`target_repo:
ai_workspace`, "record the ops runbook in the memory bank" — mis-scoped by
whoever planned the spine; it should have been a `close`-time harvest note,
not a work item).

`r1.s6.w1` has already been spawned, dispatched, completed, and merged onto
the spine branch in `canonical`. The lane now reaches `r1.s6.w2`. `oss
repo_root ai_workspace` succeeds at rc 0 and prints the AI workspace's
absolute root — the reserved key resolves like any declared repo would.
`oss worktree_add ai_workspace r1.s6.w2 ops-runbook-note <spine-branch>`
would also succeed at rc 0 if invoked, deriving and cutting a
`work/r1.s6.w2-ops-runbook-note` branch inside the AI workspace itself.
