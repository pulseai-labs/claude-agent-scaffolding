---
scenario_id: 06-undeclared-repo-name-halts-different-reason
expected_outcome: halt
expected_reason: r1.s7.w2's target_repo is mobile-companion-app, a name that appears nowhere in .ossify/topology.json's declared repos — oss repo_root fails at rc 2 for it, unlike r1.s6.w2 in fixture 05 (ai_workspace), which resolves at rc 0 and is excluded on purpose despite resolving. The halt here must be attributed to "never declared," not folded into the same explanation as the ai_workspace carve-out — a model that reports both as the same kind of failure ("not canonical") or the same mechanism as the ai_workspace case gets the reason wrong even though the halt/proceed verdict is right
---

`.ossify/topology.json` declares two repos: `canonical` (root
`/Users/ops/repos/product-api`) and `svc-billing` (root
`/Users/ops/repos/svc-billing`). Spine `r1.s7` ("retry status everywhere")
has one round with two work items, in this decomposition order: `r1.s7.w1`
(`target_repo: svc-billing`, "expose retry status over the internal API") and
`r1.s7.w2` (`target_repo: mobile-companion-app`, "surface retry status in the
companion app" — the operator meant to declare this repo in the topology
before planning the spine and forgot to).

`r1.s7.w1` has already been spawned, dispatched, completed, and merged onto
the spine branch in `svc-billing`. The lane now reaches `r1.s7.w2`. `oss
repo_root mobile-companion-app` fails at rc 2, printing `oss: repo
'mobile-companion-app' is not declared (declared: canonical, svc-billing)`.
No worktree exists for `r1.s7.w2`, and nothing has been journaled for it in
state yet.
