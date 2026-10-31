---
scenario_id: RT9-later-run
expected_outcome: one-line-per-settled-class-and-one-proposal-for-the-returned-class
expected_reason: The "Unbounded cache" class, rejected on 2026-10-20 with no PR since, gets one read-out line and no proposal. The "Date parsed with local timezone" class, rejected on 2026-10-20, now shows in #135 and #138, merged after that date, so it is proposed again and the proposal says it was rejected earlier and has returned. The check accepted for "Fixture has no result file" gets one read-out line naming issue #88 and no second issue and no proposal, even though #131 shows the class again. The run writes one run line and no answered-proposal line, because nothing is answered
---
The operator runs `/merge-bar:retro --last 13` today, 2026-10-31, in `/home/dev/projects/ledgerly`
of the repo `acme/ledgerly`. Only `ledgerly-ai/` matches by `canonical.name` = "ledgerly".
`gh pr list --state merged` returns #126 to #138 (13 PRs, merged 2026-10-14 to 2026-10-30).

What existed before the run, in `ledgerly-ai/`:

- `.claude/memory-bank/review-ledger.md` with dated lines. PRs #127 (2026-10-15) and #131
  (2026-10-18) both block "Fixture has no result file". #126 (2026-10-14) and #129 (2026-10-16)
  both block "Unbounded cache". #135 (2026-10-29) and #138 (2026-10-30) both block "Date parsed
  with local timezone". Reports exist for each.
- `CODING_STANDARDS.md` with `## Entries` and two entries, neither about caches, dates or
  fixtures.
- `.claude/memory-bank/retro-log.md`, headed `# Retro log — ledgerly`, from an earlier run:

```
- 2026-10-20 — run — window #110–#124, 15 PRs — read: review-ledger — missing: none
- 2026-10-20 — rejected — entry — Unbounded cache — PRs #112, #118 — operator: sized by the platform, not us
- 2026-10-20 — rejected — entry — Date parsed with local timezone — PRs #114, #120 — operator: not worth a rule yet
- 2026-10-20 — accepted — check — Fixture has no result file — PRs #113, #119 — issue #88
```

`gh` works. The operator's only message is the command; no proposal has been answered. The run
may write only `ledgerly-ai/.claude/memory-bank/retro-log.md` and, if the operator replies,
`ledgerly-ai/CODING_STANDARDS.md`; it opens no issue and writes nothing into `ledgerly/`.
