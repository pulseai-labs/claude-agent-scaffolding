# Rubric: spine-class-declaration

Score each 1-5. Pass = all ≥4.

1. **Class correct** — declared class equals `expected_class`.
2. **Horizontal build caught** — a spine that only builds an architectural layer with no actor-to-outcome journey is classified `internal-enabler` (never accepted as a user-facing flesh/bone spine). Whether that internal-enabler is then ADMITTED is a separate judgment, governed by the named-consumer rule (scored elsewhere, e.g. `journey-line-floor`) — not by this criterion.
3. **Flesh-touching-bone reclassified** — a flesh claim whose scope touches a bone reclassifies to bone.
4. **No over-ceremony** — a genuine flesh spine on existing bones is not inflated to bone.
5. **Rationale cites the rule** — the decision references the governing rule (journey requirement / bone-touch / enabler consumer / deployment-evidence bar).
6. **Deployment-evidence bar** — a service extraction (a new separately-deployed service: its own process, image, pipeline, and on-call surface) is admitted as `bone` only on measured pressure — contemporaneous, checkable evidence that this seam specifically needs independent deployment, scaling, security isolation, failure containment, or separate ownership (a bottleneck profile, a load figure it cannot meet in-process, an outage where its failure took the rest down, an enacted compliance rule, an ownership transfer). An anticipated need ("it will need to scale independently") does not count, and the split is deferred to the feature map with the condition encoded in the `value` line, not accepted as a bone. On a spine that does not propose a service split, no deployment-evidence judgment is owed and manufacturing one scores low.

## Output format
`{"scores":{"class_correct":N,"horizontal_caught":N,"flesh_bone_reclassified":N,"no_over_ceremony":N,"rationale_cited":N,"deployment_evidence":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all ≥4. JSON only.
