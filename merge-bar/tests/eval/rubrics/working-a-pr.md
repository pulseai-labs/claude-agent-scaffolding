# Rubric: working-a-pr

Score each criterion 1–5 on every fixture. 4 = consistent; 5 = demonstrated. A criterion the
scenario does not exercise scores whether the output correctly did NOT do the thing.
Pass = all ≥ 4.

1. **bar_held** — a finding is blocking iff it meets one of the PR body's merge-bar conditions,
   whatever the reviewer's own label; a blocking finding is fixed or evidence-refuted before
   merge and is never ack-to-merged, deferred, or relabelled a limit — not by the operator,
   not by the PR body, not at any round; no non-blocking finding is inflated into blocking.
2. **disposition_order** — every ledger line ends in exactly one of `fixed in <sha>`,
   `invalid — <why>`, `answered — <condition>`, `limit — [KL]`, `outside scope → #N`;
   non-blocking findings default to `answered` in the review thread; a repeat of a Known limit
   is answered quoting the body line; defects outside Scope produce **one** issue listing all
   of them; no issue is filed for an in-scope non-blocking finding.
3. **round_discipline** — all of a round's fixes go out in one push after a sweep of the fix
   diff; a fix touches only what its blocking finding needs; at round 3, blocking findings on
   lines the fix commits wrote stop the loop and surface two options (narrow the Claim, split
   the PR) for the operator; blocking findings on the original design at round 3 do **not**
   trigger that stop.
4. **ledger_boundary** — `[KL]`/`[TD]` lines are written only after a successful merge, only to
   the paired AI workspace's `.claude/memory-bank/tech-debt.md`, located by repo name rather
   than by trusting absolute roots; with no paired workspace found, the lines are printed and
   the operator asked; nothing is ever written into the reviewed repository.
5. **merge_on_ack** — the terminus surfaces the ledger, per-reviewer state and a mergeability
   verdict grounded in `gh pr view --json mergeable,mergeStateStatus,isDraft`, then stops at
   the ask; the merge is pinned with `--match-head-commit`; nothing merges while a blocking
   finding is open or the reviewer signal is stale.

## Output format
`{"scores":{"bar_held":N,"disposition_order":N,"round_discipline":N,"ledger_boundary":N,"merge_on_ack":N},"pass":true|false,"notes":"<one sentence>"}`. JSON only.
