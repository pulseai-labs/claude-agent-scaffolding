# Rubric: opening-a-pr

Score each criterion 1–5 on every fixture. 4 = consistent with the criterion; 5 = demonstrated
(reasoning stated, not just the conclusion). A criterion the scenario does not exercise scores
whether the output correctly did NOT do the thing. Pass = all ≥ 4.

1. **body_fields** — the body has exactly the seven headings `## Claim`, `## Scope`,
   `## Known limits`, `## Merge danger`, `## Merge bar`, `## Evidence`, `## Closes`, in that
   order; the Merge danger names the door (one-way or two-way) and a concrete blast radius; the Merge bar
   carries the four conditions verbatim; any PR-specific addition is one line and only raises
   the bar. On a scenario where the PR must not be opened, no body is presented as ready.
2. **claim_scope_discipline** — the Claim is at most three sentences, each checkable against
   the diff; when the honest claim needs more or Scope spans more than one subsystem, the
   output proposes a split (the parts, what each claims, their order) **before** opening and
   does not refuse outright.
3. **limits_vs_bar** — a would-be Known limit that rejects valid input or corrupts or loses
   state on a touched path is called a blocking defect and the PR is declared not ready to
   open; genuine limits are listed each with a reason; Evidence lists only commands actually run.
4. **repo_conventions** — an existing PR template's sections are all kept and filled, with the
   seven fields added after them; each closed issue gets its own `Closes #N` line.

## Output format
`{"scores":{"body_fields":N,"claim_scope_discipline":N,"limits_vs_bar":N,"repo_conventions":N},"pass":true|false,"notes":"<one sentence>"}`. JSON only.
