# The review report

One Markdown report per round. Field names are fixed; the work-PR session and later rounds
read them. Target ≤ ~1,500 words in all; ≤ ~150 words per class plus its site list.

```markdown
PR: <owner/repo#N>
Head: <full SHA>
Round: <n>
Door: one-way | two-way | unstated (treated one-way)
Standards: <path> | baseline only — <why>
Bar: body | template (body has none)
Verifier report: <path> | none (full Spec axis)
Previous report: <path or URL> | none                      ← round 2+ only

## Coverage
| File | Standards axis | Claim/Spec axis |
|---|---|---|
| <path> | read | not read — <why> |

## Spec                                                    ← Verifier report: none only
<spec or plan item> — met | not met — C<n>

## Classes
### C<n> — <one-line defect>
Axis: Standards | Claim/Spec | Standards, Claim/Spec
Bar: condition <n> | condition <n> (also <m>) | raising line | non-blocking
Direction: refuses valid input | correctly refuses unsupported input | admits what it cannot handle | n/a
Rule: <the standard, or the Claim sentence, it breaks — quoted>
Sweep: <the search run> — <hit count>
Sites:
<path:line> — <the defect at this site> — in scope | outside scope
Closes: <prior C-id>  |  Still open: <sites>                ← round 2+ only
New mechanism: yes — <what>                                ← round 2+, when it applies
```

- **Header.** Every line is filled; a fallback says which one and why (`Round: 1 — round 2
  requested, no previous report: <why>`).
- **Coverage.** Every file in the diff under review, one row each. A file an axis did not read
  is `not read — <why>`; never leave it out, and never call a gap clean.
- **Spec.** Only with `Verifier report: none (full Spec axis)`: each spec or plan item once,
  with its result.
- **Classes.** Blocking first, then non-blocking. No classes: write `None found.` under the
  heading, and only when Coverage has no gap. A refuted point gets one line after the classes:
  `Refuted: <point> — <why>`.
- **Axis.** A class both axes found is one entry: `Axis: Standards, Claim/Spec`.
- **Bar.** The lowest-numbered condition met, then any others: `condition 1 (also 2)`. Never a
  severity word.
- **Sweep.** The search and its hit count, then which hits are sites. One site: say the sweep
  found one. Hits that are not sites (already guarded, input refused upstream) stay out of
  `Sites:` and are counted out on the `Sweep:` line.
- **Sites.** One per line, each naming the defect at that site and marked by the body's Scope;
  a site with a different defect is another class. More than ~15: list the in-scope sites and a
  sample, then `… <k> more not shown; <total> sites` — the `Sweep:` line reproduces the full
  list.
- **Round 2+.** Each prior class gets `Closes:` or `Still open:`. A class new in the fix diff
  gets the next free `C<n>`. `New mechanism:` marks a fix that adds behaviour rather than
  closing a class — the work-PR session may cut or split it.
