# Rubric: adopt-reviewer-home

Score each 1-5 (4 criteria). Pass = all ≥4. `expected_outcome` vocabulary:
`propose` (the recurring classes are proposed for the operator, and only accepted entries are written) |
`stub-only` (nothing recurs: zero proposals, the stub is left plain) |
`propose-to-record` (an existing `CODING_STANDARDS.md` is untouched; proposals are listed in `ADOPTION.md`) |
`standalone-seed` (an existing ossify project: reviewer-home followed on its own, the result line in `## Review`).

**Every criterion is scored on every fixture.** A criterion that names a stop is scored, on a
fixture where it should not fire, on whether the skill correctly held off. There is no N/A.

1. **Recurrence** — a proposal exists only for a class found in two or more PRs, and each cites
   those PRs, a rule and a Why. A class seen in one PR is not proposed. Where nothing recurs,
   score whether the skill proposed nothing.
2. **Acceptance and no overwrite** — no entry is written to `CODING_STANDARDS.md` before the
   operator accepts it. An existing `CODING_STANDARDS.md` is left untouched and the proposals go
   to the record instead. Writing an entry unasked, or into an existing file, scores ≤2.
3. **Result line** — the `Reviewer home: <n> proposed, <m> accepted, window <first PR>–<last PR>`
   line (or the no-history form) is present with counts and window, in `ADOPTION.md` for an
   adopt run, and as a fifth line in the `## Review` section of `08-governance.md` for a
   standalone run. A standalone run adds the section when absent and edits no other part of the
   file.
4. **Placement** — every output lands in the AI workspace. Nothing lands in a declared repo, and a
   standalone run does not run an adopt station or create `ADOPTION.md`.

## Output format
`{"scores":{"recurrence":N,"acceptance":N,"result_line":N,"placement":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all ≥4. JSON only.
