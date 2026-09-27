# Rubric: patch-routing

Score each 1-5. Pass = all ≥4.

This surface scores `skills/patch/SKILL.md`: whether work that arrives outside a
spine is placed in the right lane, and whether a patch runs the procedure its
kind needs and lands as a versioned PR.

**Every criterion is scored on every fixture.** On a scenario that does not
warrant a step, the criterion scores whether the output correctly **declined**
it. There is no N/A. 4 = consistent with the criterion; 5 = demonstrated (the
reasoning is stated, not just the conclusion).

1. **lane_routing** — a defect in shipped behaviour, or a small (one work item)
   request from another project that it cannot fake, is a patch. A large
   can't-fake request is refused and routed to planning a spine now
   (`/ossify:plan-spine`). A request the consumer can fake, or new scope with no
   defect behind it, is refused to the intake queue (the project's own idea: the
   feature map at the next `/ossify:plan-release`). A change nothing observes is
   refused to close's direct-commit patch lane. A fix that changes a bone's
   recorded decision is a spine. Nothing is ever added to a running spine. A
   refusal names its route and cuts no branch.
2. **kind_procedure** — a defect is reproduced first (a failing test, or a
   recorded failing command) and seen failing for the reported reason before
   any fix; the root cause is named; the fix is at the root; the proof is the
   reproduction passing and failing again with the fix reverted, plus the full
   suite green. A request gets acceptance criteria written from the issue (and
   posted to it) before any code, then built test-first one AC at a time. The two
   procedures are never swapped.
3. **surface_read** — the tech-debt ledger lines overlapping the patch's paths
   are each given a disposition and non-overlapping ones are not listed. On an
   ossify project `touch_check` runs on the fix's paths with rc read correctly
   (0 hit, 1 clean, 2 could-not-check, never clean); a risk-gate hit makes its
   controls required ACs.
4. **branch_and_version** — the branch is `fix/<plugin-or-project>-<version>`
   cut from the freshly fetched default branch in a clean tree. A checkout parked
   on a spine or work-item branch, or dirty, is never switched or stashed; the
   branch goes in a separate worktree, cut before the reproduction and the fix
   are written — they are never written into the parked checkout. The patch
   version is bumped on every surface that carries the current version.
5. **pr_and_merge** — with merge-bar installed: `/merge-bar:open-pr` then
   `/merge-bar:work-pr`. Without: `gh pr create` with the six-field body from
   ossify's `references/work-pr/pr-body.md` (Merge bar word for word), worked by
   the bundled loop. One `Closes #N` line per resolved issue. The merge is the
   operator's; the tag follows the project's convention, on the merge commit,
   after the merge.

## Output format
`{"scores":{"lane_routing":N,"kind_procedure":N,"surface_read":N,"branch_and_version":N,"pr_and_merge":N},"pass":true|false,"notes":"<one sentence naming the cause of any score below 5>"}`. Pass = all ≥4. JSON only.
