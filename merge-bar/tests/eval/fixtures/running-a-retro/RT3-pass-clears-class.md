---
scenario_id: RT3-pass-clears-class
expected_outcome: entry-not-check
expected_reason: "New environment variable is undocumented" is in #141, #146 and #150. A check that looks for the variable's name in the docs is mechanical, but its pass would mark the class clear for the reviewer when the docs name the variable and still state the wrong default or no reader (the case in #141 and #146), so it fails the check test and becomes a standards entry under `## Entries`. The proposal cites #141, #146 and #150 and carries no check fields. Nothing is written without a reply
---
The operator runs `/merge-bar:retro --last 10` today, 2026-10-31, in `/home/dev/projects/widgets`
of the repo `acme/widgets`. Its parent directory holds `widgets/` and `widgets-ai/`;
`widgets-ai/.workspace/pairing.json` has `canonical.name` = "widgets", and only it matches.
`gh pr list --state merged --limit 5000 --json number,mergedAt`, sorted on `mergedAt`, ends in #141 to #150 as its last ten.

What existed before the run, in `widgets-ai/`:

- `.claude/memory-bank/review-ledger.md`, headed `# Review ledger — widgets`, with a line for
  each of #141, #146 and #150; their blocking lists name "New environment variable is
  undocumented" and nothing else that appears twice. Reports exist at
  `~/.cache/runs/<N>/r1/report.md` for all three.
- `CODING_STANDARDS.md` with `## Entries` and two entries: "Shell scripts quote every
  expansion" and "A new CLI flag is listed in `--help`". No entry about environment variables.
- No `retro-log.md`, and `tech-debt.md` has no line naming these PRs.

The three reports share the `Rule:` "every environment variable the code reads is listed in
`docs/env.md` with its default and the module that reads it". #141 C3: `WIDGETS_CACHE_TTL` is
named in `docs/env.md`, with a default of 60 where the code defaults to 300. #146 C1:
`WIDGETS_PROXY` is named in `docs/env.md` with a default and no reader. #150 C2:
`WIDGETS_LOG_JSON` is not named anywhere in `docs/`. In each report `Sweep:` is `rg
"environ|getenv" src/` with 4 to 6 hits.

`gh` works. The operator's only message is the command; no proposal has been answered. The run
may write only `widgets-ai/.claude/memory-bank/retro-log.md` and, if the operator replies,
`widgets-ai/CODING_STANDARDS.md`; it writes nothing into `widgets/`.
