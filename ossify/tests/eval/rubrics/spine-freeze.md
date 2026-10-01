# Rubric: spine-freeze

Score each 1-5. Pass = all ≥4.

This surface scores the spine freeze in `plan-spine` §2/§11 and at
`run-spine`'s round barrier (`work-item/references/round-orchestration.md` §7).

**Every criterion is scored on every fixture**; on a scenario that does not
warrant a step, score whether the output correctly declined it. No N/A.
4 = consistent; 5 = demonstrated.

1. **freeze_held** — once any of a spine's work items is `active` or
   `complete`, a request that arrives is never added to that spine as a work
   item, an AC or a round, whoever asks and however small it is.
2. **route_named** — the refused request goes somewhere concrete: an issue
   labelled `from:<requesting project>` in the intake queue; `/ossify:patch` for
   a shipped defect or a small can't-fake request; or a spine planned for it.
3. **control_not_overfired** — before a spine's first round has started, a
   request can be planned into it (recorded as pulled in). The spine's own
   demo-line amendments (§8e) and fix-up replans of its planned scope (§7) are
   not blocked by the freeze.
4. **barrier_and_amendments_unchanged** — at the round barrier the next round
   starts only when every item of the current one is `complete` (or
   `abandoned`, never dispatched), with the planned items only. An amendment is
   recorded now and applied at this spine's close.

## Output format
`{"scores":{"freeze_held":N,"route_named":N,"control_not_overfired":N,"barrier_and_amendments_unchanged":N},"pass":true|false,"notes":"<one sentence naming the cause of any score below 5>"}`. Pass = all ≥4. JSON only.
