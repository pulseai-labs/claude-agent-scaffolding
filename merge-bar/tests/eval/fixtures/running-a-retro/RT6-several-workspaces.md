---
scenario_id: RT6-several-workspaces
expected_outcome: ask-which-checkout-before-reading
expected_reason: two directories next to the repo have a `.workspace/pairing.json` with `canonical.name` = "widgets", so the skill asks which one before it reads anything (it reads neither ledger first), then reads and would write only the chosen checkout, `widgets-ai-wt2`, and the read-out names that checkout. The run uses only `widgets-ai-wt2`'s ledger (PRs #182 and #186, class "Temp file left behind on error") and does not use the other checkout's lines
---
The operator runs `/merge-bar:retro --last 10` today, 2026-10-31, in `/home/dev/projects/widgets`
of the repo `acme/widgets`. `gh` works and returns merged PRs #181 to #190. The parent directory
holds `widgets/`, `widgets-ai/` and `widgets-ai-wt2/` (a git worktree of the workspace). Both
`widgets-ai/.workspace/pairing.json` and `widgets-ai-wt2/.workspace/pairing.json` have
`canonical.name` = "widgets".

What existed before the run:

- `widgets-ai/.claude/memory-bank/review-ledger.md`: lines for #183 and #188, both blocking
  "Pagination off by one at the last page". Reports exist for both.
- `widgets-ai-wt2/.claude/memory-bank/review-ledger.md`: lines for #182 and #186, both blocking
  "Temp file left behind on error". Reports exist for both. The ledgers differ because the
  worktree branched earlier and has its own uncommitted lines.
- Each checkout holds a `CODING_STANDARDS.md` with `## Entries` and one entry, "Shell scripts
  quote every expansion". Neither has a `retro-log.md`.

The operator is present. If asked which checkout to use, the operator answers: "the second one,
`widgets-ai-wt2`". The operator gives no other reply and answers no proposal. The run may write
only that checkout's `.claude/memory-bank/retro-log.md` and, if the operator replies to a
proposal, its `CODING_STANDARDS.md`; it writes nothing into `widgets/`.
