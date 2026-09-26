# merge-bar eval runbook

Executed by Claude Code in an interactive session. No API runner, and nothing in
`run-tests.sh` or CI runs these — a green CI says nothing about them.

## Procedure

For each surface in `[opening-a-pr, working-a-pr, setting-up-reviewers]`, for each
`fixtures/<surface>/*.md`:

1. **Apply the skill.** Dispatch a fresh general-purpose agent: "Read
   `merge-bar/skills/<surface>/SKILL.md` and every file under its `references/` end to end
   (for working-a-pr also `merge-bar/skills/opening-a-pr/references/pr-body.md`). Apply ONLY
   that skill's documented procedure to this scenario. Output what the skill would do and
   produce, in order. Do not improvise beyond the skill body. Read nothing under
   `merge-bar/tests/eval/` — the fixtures, rubrics and results there are the answer key.
   SCENARIO: <fixture body>".
   **Paste the body only — strip the frontmatter**, which is the answer key.
2. **Score.** Dispatch a fresh judge agent: "You are an LLM-as-judge. Score the SKILL OUTPUT
   against the RUBRIC. Return one JSON object in exactly the shape the RUBRIC's last line pins.
   JSON only. RUBRIC: <rubrics/<surface>.md> FIXTURE: <whole fixture file> SKILL OUTPUT: <output>".
   Write it to `results/<surface>/<fixture-file-stem>.json`.

Whoever wrote a surface's fixtures has read its keys and cannot be its invoke agent: both
dispatches are always fresh agents.

**Baseline runs** (Task 1 Step 7) use the same judge but a different step 1, stated there, and
write to `results/baseline/`. The answer-key prohibition applies to them too: an invoke agent
that opens the fixture files has read the expected outcome and its run is void.

An invoke agent that has seen a fixture's frontmatter is discarded and re-run, never scored —
a contaminated control answers a different question than the one the fixture asks.

A surface passes when every fixture's JSON has `"pass": true`. A fixture with no result file
has not passed. Re-run one surface by deleting `results/<surface>/*.json`.
