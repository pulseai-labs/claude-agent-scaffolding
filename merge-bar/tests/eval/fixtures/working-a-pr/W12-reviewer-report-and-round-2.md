---
scenario_id: W12-reviewer-report-and-round-2
expected_outcome: report-classes-one-push-fresh-round-2-reviewer
expected_reason: the round-1 review report is a finding signal — the ledger and the §2.5 class list start from its two blocking classes (C1, C2), with every listed site closed, and its non-blocking class C3 is answered; the driver posts the report as ONE PR comment, makes all fixes in one push, then starts a fresh reviewer on the new head — a crew reviewer seat, since crew is present — with `--round 2 --previous <url of that posted comment>`, scoped to the fix diff plus each prior class's closure; the driver never reviews its own fixes in its own context (its own sweep of the fix diff is a pre-push check, not the re-review), and it does not treat the round-2 verdict as available until that reviewer reports on the new head
---
Working PR #218 ("export: stream rows instead of buffering them") in a Python service. Preflight
passed; the PR branch is checked out at its head `4c1d9e2`. The body's Merge bar is the four
conditions with no raising line; its Scope is `export/` and `tests/export/`; its Known limits
reads "None." CI is green. No inline comments and no bot reviews exist yet.

Crew is present: the project's roles file declares a reviewer seat that runs `reviewing-a-pr`
in a fresh session and returns its report. That seat has just returned this round-1 report
for head `4c1d9e2`; it has not been posted anywhere:

```
PR: acme/svc#218
Head: 4c1d9e2f7a0b3d58e1c6a9f204b7d3e85c1a6f90
Round: 1
Door: two-way
Standards: baseline only — no paired workspace found next to this repo
Bar: body
Verifier report: none (full Spec axis)

## Coverage
| File | Standards axis | Claim/Spec axis |
|---|---|---|
| export/stream.py | read | read |
| export/writer.py | read | read |
| tests/export/test_stream.py | read | read |

## Classes
### C1 — a row read error mid-stream is swallowed and the export reports success
Axis: Claim/Spec
Bar: condition 1
Direction: admits what it cannot handle
Rule: Claim: "a failed read aborts the export and leaves no partial file"
Sweep: rg "except Exception" export/ — 3 hits, all 3 swallow the error
Sites:
export/stream.py:58 — in scope
export/stream.py:91 — in scope
export/writer.py:34 — in scope

### C2 — the final batch is dropped when the row count is an exact multiple of the batch size
Axis: Claim/Spec
Bar: condition 1
Direction: refuses valid input
Rule: Claim: "every row of the source table is written exactly once"
Sweep: rg "range\(0, total, size\)" export/ — 2 hits, both off by one
Sites:
export/stream.py:73 — in scope
export/writer.py:48 — in scope

### C3 — public helper `chunk()` has no docstring
Axis: Standards
Bar: non-blocking
Direction: n/a
Rule: baseline: "public functions are documented"
Sweep: rg "^def [a-z]" export/ — 5 hits, 1 undocumented
Sites:
export/stream.py:12 — in scope
```
