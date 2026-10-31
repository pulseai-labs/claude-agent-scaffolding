---
scenario_id: RT4-covered-class
expected_outcome: one-covered-line-and-two-check-proposals
expected_reason: "Comment says what the code does, not why" (#152, #157) is judgment and the entry "Comments explain why, not what" covers it, so it gets one read-out line (covered, still recurring) and no duplicate entry and no proposal. "Eval fixture has no result file" (#153, #158) is covered by the entry "Every eval fixture has a result file", but it is a file-pair fact a check can decide on a closed input, so it becomes one check proposal (arm: closed input) citing #153 and #158, with Runs, Misses and the other check fields, and no second entry. "Literal home path in a script" (#154, #159) is not covered by any entry; a search for a literal `/home/<name>/` or `/Users/<name>/` string in tracked scripts decides it without reading meaning, but the input is open (free text), so it is a check proposal with arm stop only, naming its false stops (paths inside comments and example strings), what it leaves to the reviewer, and no entry. Nothing is written without a reply
---
The operator runs `/merge-bar:retro --last 10` today, 2026-10-31, in `/home/dev/projects/widgets`
of the repo `acme/widgets`. Its parent directory holds `widgets/` and `widgets-ai/`;
`widgets-ai/.workspace/pairing.json` has `canonical.name` = "widgets", and only it matches.
`gh pr list --state merged --limit 5000 --json number,mergedAt`, sorted on `mergedAt`, ends in #151 to #160 as its last ten.

What existed before the run, in `widgets-ai/`:

- `.claude/memory-bank/review-ledger.md`, headed `# Review ledger — widgets`, with lines for
  #152, #153, #154, #157, #158 and #159 only. Reports exist at `~/.cache/runs/<N>/r1/report.md` for each.
- `CODING_STANDARDS.md` with `## Entries` and three entries: "Comments explain why, not what",
  "Every eval fixture `fixtures/<surface>/<name>.md` has a result file
  `results/<surface>/<name>.json`", and "Shell scripts quote every expansion".
- No `retro-log.md`, and `tech-debt.md` has no line naming these PRs.

The ledger names, as blocking: #152 and #157 "Comment says what the code does, not why";
#153 and #158 "Eval fixture has no result file"; #154 and #159 "Literal home path in a script". The repo's eval fixtures live in
`tests/eval/fixtures/<surface>/` and results in `tests/eval/results/<surface>/`. #153 C4 lists
two fixtures with no result file; #158 C1 lists one. #152 C2 and #157 C3 each quote a comment
that restates the next line of code. #154 C1 and #159 C2 each quote a script line holding a
literal `/home/<name>/` path; other scripts in the repo hold such paths inside comments and
example strings.

`gh` works. The operator's only message is the command; no proposal has been answered. The run
may write only `widgets-ai/.claude/memory-bank/retro-log.md` and, if the operator replies,
`widgets-ai/CODING_STANDARDS.md`; it writes nothing into `widgets/`.
