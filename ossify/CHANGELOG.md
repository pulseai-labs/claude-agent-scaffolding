# Changelog

All notable changes to the `ossify` plugin.

Entries before 1.30.0 are recorded in the "Since" notes of `ossify/README.md`; this file starts at
1.30.0.

## 1.30.0

Reviewer project home: `/ossify:start` and `/ossify:adopt` seed the review surface a project's
reviewers read, in the AI workspace only.

- New `skills/start/references/reviewer-home.md` — the reviewer-home contract: `CODING_STANDARDS.md`,
  `review-ledger.md` and a `## Review` section in `08-governance.md`, each authored only when absent.
  It can be followed alone by an existing ossify project. (#984)
- `/ossify:start` seeds `CODING_STANDARDS.md`, `review-ledger.md` and the `## Review` section in the
  AI workspace; the memory-bank brief and the occupied-destinations check name them. (#984)
- `/ossify:adopt` seeds the same three outputs, then runs a history pass that drafts standards
  entries from review history: a class that recurs in two or more PRs becomes a draft, and the
  operator accepts each entry. (#984)
- Evals: new surfaces `start-reviewer-home` and `adopt-reviewer-home`, 4/4 each.
- Agent-loaded bytes, `skills/**` against 1.29.1 (`wc -c`):
  - `skills/start/references/reviewer-home.md` — new, 0 → 5217 (+5217)
  - `skills/start/references/memory-bank-brief.md` — 6783 → 7086 (+303)
  - `skills/start/references/occupied-destinations.md` — 6632 → 6703 (+71)
  - `skills/start/SKILL.md` — 24217 → 24276 (+59)
  - `skills/adopt/SKILL.md` — 19083 → 19479 (+396)
