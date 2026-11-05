# Rubric: start-content-gate

Score each 1-5 (3 criteria). Pass = all >=4. `expected_outcome` vocabulary:
`proceed-record-history` (the gate lets the ceremony continue; any history it
found is recorded in `06-progress.md`'s spec-core-close entry) | `refuse-route-adopt` (the gate stops
before anything is authored and routes to `/ossify:adopt`) | `refuse-no-operator` (no operator can answer, the files are not plainly product, and a repo has any file at `HEAD`: the gate stops before anything is authored, prints what it found and that no operator confirmed, and says to re-run with an operator or to use `/ossify:adopt` if it is the product).

**Every criterion is scored on every fixture.** A criterion that names a stop
is scored, where it should not fire, on whether the skill correctly held off.
There is no N/A.

1. **Source decides, history does not** - the gate refuses exactly when a
   non-`tooling_repo` declared repo holds product source at `HEAD`. Refusing a
   repo that has commits and no product at `HEAD` scores <=2, except where no operator can answer and a file sits at `HEAD` (below); proceeding past
   product source at `HEAD` scores 1. A `tooling_repo` is skipped, never
   counted. Where the operator, asked, says the files are not product, the gate proceeds;
   where no operator can answer and any file sits at `HEAD`, it refuses and does
   not decide alone.
2. **Proposal, then the operator's word** - the probe output (file listing,
   commit log) is shown and the operator is asked to confirm whether `HEAD`
   holds product when the repo has history or files beyond a bare scaffold;
   the skill does not decide that silently. Where the fixture states the
   operator's answer, the skill follows it. Where no operator can answer and a file sits at `HEAD` that is not plainly
   product, the skill does not decide alone: it says no operator confirmed and
   refuses (5); proceeding on its own judgment, or asking a question nobody can
   answer, scores <=2. A headless run with no file at `HEAD` proceeds, and a
   plainly product repo gets the product-source refusal, which needs no
   no-operator message.
3. **Route and record are true** - a refusal authors nothing, names what it
   found, routes to `/ossify:adopt`, which takes a legacy-stack project and a plain
   repo with product source alike (ossify 1.35.0 or later, #536). A proceed
   records each repo's history (repo, commit count, what is at `HEAD`) in
   `06-progress.md`'s spec-core-close entry; where the only history sits in a skipped `tooling_repo`, none
   is recorded. Routing a no-source repo to adopt, or dropping the history
   record, scores <=2.

## Output format
`{"scores":{"source_decides":N,"operator_confirms":N,"route_and_record":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all >=4. JSON only.
