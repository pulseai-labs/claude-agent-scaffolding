# Rubric: run-spine-declared-repo

Score each 1-5 (4 criteria). Pass = all ≥4. `expected_outcome` vocabulary:
`halt` | `proceed`. `halt` = the lane stops before completing the spine-branch
cut and/or before dispatching every eligible work item, naming the repo and
the reason. `proceed` = the lane cuts the spine branch in every hosting repo
it needs to and dispatches every work item whose `target_repo` is declared,
without halting.

**Every criterion is scored on every fixture.** A fixture that halts on one
gate is still scored on the other three — a criterion whose own condition
never fires on that fixture scores whether the skill correctly stayed silent
about it, the same convention `adopt-multi-repo` uses. There is no N/A.

1. **The spine-branch cut is a real loop over every hosting repo, not
   canonical alone.** Before round 1, the lane cuts and checks out the spine
   branch in every repo that hosts at least one of the spine's work items —
   the distinct `target_repo` values, not a fixed single repo. A dirty
   working tree, an already-existing spine branch, or a detached HEAD in
   *any* hosting repo halts the cut, even when canonical (or the first repo
   checked) is clean. Stopping the check after canonical comes back clean and
   never reaching a second or third hosting repo is a wrong answer here even
   when it happens to land on the right verdict for the fixture in front of
   it.
2. **Any declared repo executes a work item; the halt is not
   canonical-only.** A work item whose `target_repo` is a declared repo other
   than canonical gets a worktree, a dispatch, and a handoff — it does not
   halt with "only canonical executes" or any equivalent single-repo refusal.
   Refusing a work item solely because its `target_repo` differs from
   `canonical` is a wrong answer, independent of whether that repo is
   actually declared.
3. **`ai_workspace` halts for the right reason, and an undeclared name halts
   for a different one — each judged on its own fixture.** A work item
   targeting `ai_workspace` halts even though `oss repo_root ai_workspace`
   resolves at rc 0 (it is the reserved process-record key) — a model that
   treats "does the repo resolve" as the whole test, without the explicit
   `ai_workspace` exclusion, wrongly executes it and spawns a worktree inside
   the AI workspace. A work item targeting a name that is not declared
   anywhere in the topology halts too, but because `oss repo_root` fails at
   rc 2, not because of the `ai_workspace` carve-out. Attributing either halt
   to the wrong mechanism — calling the `ai_workspace` halt a resolution
   failure, or calling the undeclared-name halt the `ai_workspace` carve-out
   — is a wrong answer even though the verdict (halt) is right.
4. **Each work item's handoff records `repo:` matching its `target_repo`.**
   When a work item is dispatched, its handoff's spine-context section names
   the repo it actually executes in, not a copied-forward `canonical`
   default and not the spine's first hosting repo. A handoff whose `repo:`
   disagrees with the work item's own `target_repo` is a wrong answer even
   if the worktree itself was spawned in the right place.

## Output format
`{"scores":{"per_repo_branch_cut":N,"declared_repo_executes":N,"ai_workspace_vs_undeclared":N,"handoff_repo_field":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all ≥4. JSON only.
