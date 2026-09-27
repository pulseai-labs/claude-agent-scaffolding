# Rubric: setting-up-reviewers

Score each criterion 1–5 on every fixture. 4 = consistent; 5 = demonstrated. Pass = all ≥ 4.

1. **agents_md** — the rules land under `## Code Review Rules` in the reviewed repo's root
   `AGENTS.md`; an existing file is appended to and none of its other content changes; the
   rules are two or three, each saying what to flag, why, and the safe path; no rule depends on
   the reviewer reading the PR body.
2. **coderabbit_scope** — `.coderabbit.yaml` is written only when the repo is public; a private
   repo gets none, with the reason stated; an existing `.coderabbit.yaml` is never overwritten —
   the diff is shown and the operator asked.
3. **lands_as_pr** — the change goes on a branch and is opened through `opening-a-pr`; nothing
   is pushed to the default branch.

## Output format
`{"scores":{"agents_md":N,"coderabbit_scope":N,"lands_as_pr":N},"pass":true|false,"notes":"<one sentence>"}`. JSON only.
