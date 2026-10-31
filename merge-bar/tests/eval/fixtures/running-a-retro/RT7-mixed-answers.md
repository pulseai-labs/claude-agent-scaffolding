---
scenario_id: RT7-mixed-answers
expected_outcome: stub-and-themed-entries-land-and-unanswered-gets-no-line
expected_reason: Four proposals are shown across two sections and three are answered. Section A (`gisting-ai`, an ossify stub): P1 is accepted, so `## Entries` starts there, `No project entries yet.` is removed and the entry sits under it; P2 is rejected with the operator's reason. Its log holds the run line, one `accepted` line and one `rejected` line. Section B (`tiles-ai`, hand-written): P1 is accepted with the operator's rewording, so it is `edited`; the entry lands under the existing heading `## Error handling`, no `## Entries` appears and no other line changes. Its log holds the run line and one `edited` line; P2 is unanswered, gets no log line and is raised again next run. Nothing is committed and the operator hears which files changed
---
This scenario has two runs in two projects, each with its own operator, today 2026-10-31. Score
each section on its own, then give one result. In both, `gh` works, `--last 10` is used, the
operator is present, and the run writes nothing into the reviewed repository.

**Section A: `/home/dev/projects/gisting`, repo `acme/gisting`.** Its parent directory holds
`gisting/` and `gisting-ai/`; only `gisting-ai/.workspace/pairing.json` has `canonical.name` =
"gisting". Merged PRs #41 to #50. Before the run, in `gisting-ai/`:

- `.claude/memory-bank/review-ledger.md` with lines for #42, #44 and #47. #42 and #44 both block
  "Retry loop has no upper bound"; #44 and #47 both block "Public function lacks a doc comment".
  Reports exist for each.
- `CODING_STANDARDS.md` is an ossify stub: `# Coding standards`, a paragraph, `## Read these where
  they live` with two pointers, and the sentence `No project entries yet.`. It has no
  `## Entries` heading.
- No `retro-log.md`.

The run's proposals are numbered P1 (retry bound) and P2 (doc comment). The operator replies: "P1 accept. P2 reject, our linter covers it."

**Section B: `/home/dev/projects/tiles`, repo `acme/tiles`.** Its workspace is `tiles-ai/`,
the only match. Merged PRs #101 to #110. Before the run, in `tiles-ai/`:

- `.claude/memory-bank/review-ledger.md` with lines for #103 and #108, both blocking
  "Error swallowed in a catch block". #105 and #109 both block "Magic number in layout code".
- `CODING_STANDARDS.md`, hand-written, with the headings `## Naming`, `## Error handling`,
  `## Layout`, each holding three or four entries, and no `## Entries` heading.
- No `retro-log.md`.

The run's proposals are numbered P1 (swallowed error) and P2 (magic numbers). The operator replies: "P1:
accept, but reword the rule to 'Catch blocks log or rethrow, never drop'." The operator does not
answer P2.

The run may write only the named workspace's `.claude/memory-bank/retro-log.md` and
`CODING_STANDARDS.md`, in each section's own `-ai` directory.
