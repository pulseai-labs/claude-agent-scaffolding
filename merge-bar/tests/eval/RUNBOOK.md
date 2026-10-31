# merge-bar eval runbook

Executed by Claude Code in an interactive session. No API runner, and nothing in
`run-tests.sh` or CI runs these — a green CI says nothing about them.

## Procedure

For each surface in `[opening-a-pr, working-a-pr, setting-up-reviewers, reviewing-a-pr, running-a-retro]`,
for each `fixtures/<surface>/*.md`:

1. **Apply the skill.** Dispatch a fresh general-purpose agent: "Read
   `merge-bar/skills/<surface>/SKILL.md` and every file under its `references/` end to end
   (for working-a-pr also `merge-bar/skills/opening-a-pr/references/pr-body.md`; for
   reviewing-a-pr every file under `merge-bar/skills/reviewing-a-pr/`, and that same
   `pr-body.md`; for running-a-retro every file under `merge-bar/skills/running-a-retro/`, plus
   `merge-bar/skills/working-a-pr/SKILL.md` and
   `merge-bar/skills/reviewing-a-pr/references/report.md`, which it points at). Apply ONLY that skill's documented procedure to this scenario. Output what
   the skill would do and produce, in order. Do not improvise beyond the skill body. Read
   nothing under `merge-bar/tests/eval/` — the fixtures, rubrics and results there are the
   answer key.
   End your output with a line listing every file you read.
   SCENARIO: <fixture body>".
   **Paste the body only — strip the frontmatter**, which is the answer key.
2. **Score.** Dispatch a fresh judge agent: "You are an LLM-as-judge. Score the SKILL OUTPUT
   against the RUBRIC. Return one JSON object in exactly the shape the RUBRIC's last line pins.
   JSON only. RUBRIC: <rubrics/<surface>.md> FIXTURE: <whole fixture file> SKILL OUTPUT: <output>".
   Write it to `results/<surface>/<fixture-file-stem>.json`.

Whoever wrote a surface's fixtures has read its keys and cannot be its invoke agent: both
dispatches are always fresh agents.

**Check the read set before scoring.** Step 1's read list, and the invoke agent's own tool log,
are checked against the answer key before its result is written: an invoke that opened anything
under `tests/eval/` is discarded and re-run, never scored — a contaminated control answers a
different question than the one the fixture asks. Record the read sets with the results when a
whole surface is re-run.

**Baseline runs** write to `results/baseline/` and use the same judge with a different step 1.
They establish that a fixture discriminates, by running it against the behaviour the skill
replaces. Seven fixtures carry baselines, each judged with its own surface's rubric:

- `W1` and `W6` — the invoke agent reads `ossify/skills/work-pr/references/loop.md` end to end instead
  of any merge-bar skill, and is told to apply only that loop's documented procedure.
- `O1`, `RT2` and `RT7` — the invoke agent gets no skill: "You are a coding agent. Do what the operator asks."
- `R1` and `R3` — the invoke agent reads OMP's stock reviewer prompts at tag `v18.11.3`,
  `packages/coding-agent/src/prompts/agents/reviewer.md` and
  `packages/coding-agent/src/prompts/review-request.md`
  (`gh api repos/can1357/oh-my-pi/contents/<path>?ref=v18.11.3 --jq .content | base64 -d`),
  instead of any merge-bar skill, and is told to apply only them as the one reviewer task.
  Expected: R1 fails `class_complete`, R3 fails `round_scope`.
  Expected: RT2 fails `check_test` or `sort_outcome`.

Baselines are run once, when the fixtures are written, and are not re-run on later skill edits;
their committed results are the record that the behaviour the skill replaces fails the fixture.

A surface passes when every fixture's JSON has `"pass": true`. A fixture with no result file
has not passed. Re-run one surface by deleting `results/<surface>/*.json`.
