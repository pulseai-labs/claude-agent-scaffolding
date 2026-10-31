---
scenario_id: RT4-covered-class
expected_outcome: one-covered-line-and-one-check-proposal
expected_reason: "Comment says what the code does, not why" (#152, #157) is judgment and the entry "Comments explain why, not what" covers it, so it gets one read-out line (covered, still recurring) and no duplicate entry and no proposal. "Eval fixture has no result file" (#153, #158) is covered by the entry "Every eval fixture has a result file", but it is a file-pair fact a check can decide on a closed input, so it becomes one check proposal (arm: closed input) citing #153 and #158, with Runs, Misses and the other check fields, and no second entry. Nothing is written without a reply
---
The operator runs `/merge-bar:retro --last 10` today, 2026-10-31, in `/home/dev/projects/widgets`
of the repo `acme/widgets`. Its parent directory holds `widgets/` and `widgets-ai/`;
`widgets-ai/.workspace/pairing.json` has `canonical.name` = "widgets", and only it matches.
`gh pr list --state merged --limit 10` returns #151 to #160.

What existed before the run, in `widgets-ai/`:

- `.claude/memory-bank/review-ledger.md`, headed `# Review ledger — widgets`, with lines for
  #152, #153, #157 and #158 only. Reports exist at `~/.cache/runs/<N>/r1/report.md` for each.
- `CODING_STANDARDS.md` with `## Entries` and three entries: "Comments explain why, not what",
  "Every eval fixture `fixtures/<surface>/<name>.md` has a result file
  `results/<surface>/<name>.json`", and "Shell scripts quote every expansion".
- No `retro-log.md`, and `tech-debt.md` has no line naming these PRs.

The ledger names, as blocking: #152 and #157 "Comment says what the code does, not why";
#153 and #158 "Eval fixture has no result file". The repo's eval fixtures live in
`tests/eval/fixtures/<surface>/` and results in `tests/eval/results/<surface>/`. #153 C4 lists
two fixtures with no result file; #158 C1 lists one. #152 C2 and #157 C3 each quote a comment
that restates the next line of code.

`gh` works. The operator's only message is the command; no proposal has been answered. The run
may write only `widgets-ai/.claude/memory-bank/retro-log.md` and, if the operator replies,
`widgets-ai/CODING_STANDARDS.md`; it writes nothing into `widgets/`.
