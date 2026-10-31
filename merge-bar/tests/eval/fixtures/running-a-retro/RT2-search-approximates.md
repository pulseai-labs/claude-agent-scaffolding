---
scenario_id: RT2-search-approximates
expected_outcome: entry-not-check
expected_reason: "Old wording survives beside its replacement" is in #131, #134 and #139, so it is a candidate. A grep for the retired term finds some sites but not all (the other spellings in #134 show a search only approximates it), and recognising a survivor needs meaning, so the mechanical-first step fails and it becomes a standards entry under `## Entries`, not a check; no existing entry covers it. The proposal cites #131, #134 and #139 and has the entry fields (Entry line), none of the check fields. Nothing is written without a reply
---
The operator runs `/merge-bar:retro --last 10` today, 2026-10-31, in `/home/dev/projects/widgets`
of the repo `acme/widgets`. Its parent directory holds `widgets/` and `widgets-ai/`;
`widgets-ai/.workspace/pairing.json` has `canonical.name` = "widgets", and only it matches.
`gh pr list --state merged --limit 10` returns #131 to #140.

What existed before the run, in `widgets-ai/`:

- `.claude/memory-bank/review-ledger.md`, headed `# Review ledger — widgets`, with a line for
  each of #131, #134 and #139 (the other seven PRs have none). Their blocking lists name the
  class "Old wording survives beside its replacement" and nothing else that appears twice.
  Reports exist at `~/.cache/runs/<N>/r1/report.md` for all three.
- `CODING_STANDARDS.md` with `## Entries` and two entries: "Shell scripts quote every
  expansion" and "A new CLI flag is listed in `--help`". No entry about replaced wording.
- No `retro-log.md`, and `tech-debt.md` has no line naming these PRs.

The three reports. #131 C1: `docs/setup.md` still says "run `widgets init`" after the command
became `widgets bootstrap`; `Sweep: rg "widgets init" — 1 hit`. #134 C5: the new `--format` flag
replaces `--output-type`; `Sweep: rg -- "--output-type" — 3 hits`; the report adds that the same
retired flag survives at two more sites spelled "output type" in a table header and `outputType`
in a JSON example, which the search did not match. #139 C2: the section was renamed from
"Quick start" to "Tutorial" but a link text, an anchor and a sentence still say "quick start";
the `rg` sweep found the link and the anchor only.

`gh` works. The operator's only message is the command; no proposal has been answered. The run
may write only `widgets-ai/.claude/memory-bank/retro-log.md` and, if the operator replies,
`widgets-ai/CODING_STANDARDS.md`; it writes nothing into `widgets/`.
