# Rubric: start-content-gate

Score each 1-5 (3 criteria). Pass = all >=4. `expected_outcome` vocabulary:
`proceed-record-history` (the gate lets the ceremony continue; any history it
found is carried to §13's hand-off) | `refuse-route-adopt` (the gate stops
before anything is authored and routes to `/ossify:adopt`).

**Every criterion is scored on every fixture.** A criterion that names a stop
is scored, where it should not fire, on whether the skill correctly held off.
There is no N/A.

1. **Source decides, history does not** - the gate refuses exactly when a
   non-`tooling_repo` declared repo holds product source at `HEAD`. Refusing a
   repo that has commits and no product at `HEAD` scores <=2; proceeding past
   product source at `HEAD` scores 1. A `tooling_repo` is skipped, never
   counted.
2. **Proposal, then the operator's word** - the probe output (file listing,
   commit log) is shown and the operator is asked to confirm whether `HEAD`
   holds product when the repo has history or files beyond a bare scaffold;
   the skill does not decide that silently. Where the fixture states the
   operator's answer, the skill follows it.
3. **Route and record are true** - a refusal authors nothing, names what it
   found, routes to `/ossify:adopt`, which takes a legacy-stack project and a plain
   repo with product source alike (ossify 1.35.0 or later, #536). A proceed
   records each repo's history (repo, commit count, what is at `HEAD`) for the
   §13 hand-off; where the only history sits in a skipped `tooling_repo`, none
   is recorded. Routing a no-source repo to adopt, or dropping the history
   record, scores <=2.

## Output format
`{"scores":{"source_decides":N,"operator_confirms":N,"route_and_record":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all >=4. JSON only.
