---
scenario_id: RT8-accepted-check
expected_outcome: issue-text-first-then-one-issue-and-failure-variant-logged
expected_reason: The proposal batch carries P1's issue text, and nothing is opened until the operator replies. After the reply, Variant A opens one issue in `acme/ledgerly` with `gh issue create`; the title is the class line, and the body holds Rule, Why, Sources (PR numbers only), Arm, Runs and Misses (False stops if any), with no report path, no class ID, no standards text and no path to `ledgerly-ai`. The `accepted` log line ends `issue #88`. In Variant B `gh issue create` fails, so P2's accepted entry stays written, the proposal text is printed, the check's log line ends `issue not opened: ` followed by the failure reason, and the operator is told; that line does not count as accepted earlier. Nothing is committed and nothing is written into `ledgerly/`
---
Two variants of one run. The operator runs `/merge-bar:retro --last 10` today, 2026-10-31, in
`/home/dev/projects/ledgerly` of the public repo `acme/ledgerly`. Its parent directory holds
`ledgerly/` and `ledgerly-ai/`; `ledgerly-ai/.workspace/pairing.json` has `canonical.name` =
"ledgerly", and only it matches. `gh pr list --state merged` returns #71 to #80.

What existed before the run, in `ledgerly-ai/`:

- `.claude/memory-bank/review-ledger.md` with lines for #72, #75, #78 and #79. #72 and #79 both block
  "Fixture has no result file" (a fixture in `tests/eval/fixtures/<surface>/` with no matching
  file in `tests/eval/results/<surface>/`; #72 C1 lists one, #79 C2 lists two). #75 and #78 both
  block "Comment restates the code". Reports exist for each.
- `CODING_STANDARDS.md` with `## Entries` and two entries, neither about fixtures or result files.
- No `retro-log.md`.

The run's proposals are numbered P1 (the fixture/result pair) and P2 ("Comment restates the
code"). The operator replies "P1: yes, open it." In Variant B the operator also replies "P2:
accept."; in Variant A, P2 is not answered.

In Variant A `gh issue create` succeeds and prints an issue URL ending `/issues/88`. In Variant
B `gh issue create` exits 1 with `GraphQL: Resource not accessible by integration`. `gh` otherwise
works in both.

The run may write only `ledgerly-ai/.claude/memory-bank/retro-log.md` and
`ledgerly-ai/CODING_STANDARDS.md`, may open one issue in `acme/ledgerly`, and writes nothing
into `ledgerly/`.
