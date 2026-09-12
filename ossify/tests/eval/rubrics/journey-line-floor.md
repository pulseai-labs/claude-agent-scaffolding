# Rubric: journey-line-floor

Score each 1-5 (7 criteria). Pass = all ≥4.

1. **Verdict correct** — accept/reject matches `expected_verdict`.
2. **Inspector phrasing caught** — a `user:` line phrased as inspection ("inspect", "view", "open the record") is rejected as a journey line.
3. **Verb + observable outcome** — an accepted journey line is an action the user performs for value (verb + observable outcome), not artifact inspection.
4. **Internal-spine consumer rule** — an internal (`auto:`-only) spine is admitted only if it names a committed user-facing consuming spine scheduled in the current or next release (one-release-ahead cap); otherwise rejected.
5. **No false reject** — a legitimately value-phrased journey line is not rejected.
6. **Before/after evidence** — a deepening pass claiming a measured quality (performance/reliability/cost) is rejected unless it states before/after evidence in its demo contribution.
7. **Real seams present** — narrowing is accepted only when the real agent, runtime, and observable-result seams are still present; if any seam is removed, the narrowed I/O is rejected, not accepted.

## Output format
`{"scores":{"verdict_correct":N,"inspector_caught":N,"verb_outcome":N,"consumer_rule":N,"no_false_reject":N,"before_after_evidence":N,"real_seams_present":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all ≥4. JSON only.
