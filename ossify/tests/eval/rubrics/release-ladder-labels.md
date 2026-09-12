# Rubric: release-ladder-labels

Score each 1-5 (5 criteria). Pass = all ≥4. `expected_label` vocabulary:
`skeleton` | `mvp` | `v1` | `v1.x` | `v2` | `vN` — the ladder label the
scenario warrants.

This surface scores `plan-release` SKILL.md §9's rolling-wave judgment
(`references/rolling-wave.md` §4) — the release ladder is evidence-gated, not
counted, and a label is confirmed by evidence at planning, never assigned in
advance.

**Every criterion is scored on every fixture.** There is no N/A.

1. **v2 bar correct** — a release is labelled `v2` only on a changed product
   promise, a new primary journey, or an intentionally breaking public
   contract; accumulated features alone stay `v1.x`. On a release of
   accumulated features, `v1.x` is correct and `v2` is wrong.
2. **MVP bar correct** — `mvp` is the **first** release at which the product
   can be used independently (cold start, real data lifecycle, a recovery path
   appropriate to solo scale); not "skeleton + N spines" as an arithmetic rule.
   A later release that still meets the independence bar is `v1.x`, not a second
   `mvp`; scoring a past-MVP release as `mvp` scores low, and so does scoring
   the first-attaining release as anything other than `mvp`.
3. **Evidence-gated, not counted** — labels are confirmed by evidence at the
   release's planning, never assigned in advance as a milestone; a label
   pre-assigned ("release 3 = mvp") scores low.
4. **No dating** — releases are not dated; the ladder is evidence-gated and a
   date is a wish. A release record carrying a date scores low.
5. **Sketch label is a hypothesis** — a next-release label named in the sketch
   is a hypothesis ("next: mvp if the paper loop lands"), not a commitment or a
   promise to a stakeholder. A sketch label stated as a commitment scores low.

## Output format
`{"scores":{"v2_bar":N,"mvp_bar":N,"evidence_gated":N,"no_dating":N,"sketch_label_hypothesis":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all ≥4. JSON only.
