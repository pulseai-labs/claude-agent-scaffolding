---
scenario_id: RT9-later-run
expected_outcome: one-line-per-settled-class-and-one-proposal-for-the-returned-class
expected_reason: The "Unbounded cache" class was rejected on 2026-10-20 and its PRs in this window (#119, #122) merged before that date, so it gets one read-out line and no proposal. The "Date parsed with local timezone" class was rejected on 2026-10-20 and one PR merged after it, #138, shows it again; with the log's #114 and #120 that is enough, so it is proposed again and the proposal says it was rejected earlier and has returned. The check accepted for "Fixture has no result file" gets one read-out line naming issue #88, no proposal and no second issue, even though #131 (merged 2026-10-24, after the acceptance) shows the class again. The entry accepted for "SQL built by string concatenation" is covered by that entry: its class shows again in #125 and #133, so it gets one covered-still-recurring read-out line and no duplicate entry; it is not "accepted earlier", which is for checks. The run writes one run line and no answered-proposal line, because nothing is answered
---
The operator runs `/merge-bar:retro --last 20` today, 2026-10-31, in `/home/dev/projects/ledgerly`
of the repo `acme/ledgerly`. Only `ledgerly-ai/` matches by `canonical.name` = "ledgerly".
`gh pr list --state merged` returns #119 to #138 (20 PRs, merged 2026-10-10 to 2026-10-30).

What existed before the run, in `ledgerly-ai/`:

- `.claude/memory-bank/review-ledger.md` with dated lines. PRs #121 (2026-10-16) and #131
  (2026-10-24) both block "Fixture has no result file". #119 (2026-10-12) and #122 (2026-10-17)
  both block "Unbounded cache". #125 (2026-10-21) and #133 (2026-10-27) both block "SQL built by
  string concatenation". #138 (2026-10-30) blocks "Date parsed with local timezone". Reports exist
  for each.
- `CODING_STANDARDS.md` with `## Entries` and three entries: "Shell scripts quote every expansion", "Public functions
  carry a doc comment" and "SQL is built with bound parameters, never string concatenation".
- `.claude/memory-bank/retro-log.md`, headed `# Retro log — ledgerly`, from an earlier run:

```
- 2026-10-20 — run — window #110–#124, 15 PRs — read: review-ledger — missing: none
- 2026-10-20 — rejected — entry — Unbounded cache — PRs #112, #118 — operator: sized by the platform, not us
- 2026-10-20 — rejected — entry — Date parsed with local timezone — PRs #114, #120 — operator: not worth a rule yet
- 2026-10-20 — accepted — entry — SQL built by string concatenation — PRs #115, #116 — Entries
- 2026-10-20 — accepted — check — Fixture has no result file — PRs #113, #117 — issue #88
```

`gh` works. The operator's only message is the command; no proposal has been answered. The run
may write only `ledgerly-ai/.claude/memory-bank/retro-log.md` and, if the operator replies,
`ledgerly-ai/CODING_STANDARDS.md`; it opens no issue and writes nothing into `ledgerly/`.
