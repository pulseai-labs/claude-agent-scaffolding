---
scenario_id: RT8-accepted-check
expected_outcome: issue-text-first-then-one-issue-and-failure-variant-logged
expected_reason: The check proposal's issue text is shown to the operator before anything is opened. After the "accept", Variant A opens one issue in `acme/ledgerly` with `gh issue create`; the body is the proposal and holds no standards entry and no path to `ledgerly-ai`. The `accepted` log line ends `issue #N`. In Variant B `gh issue create` fails, so the accepted entry stays written, the proposal text is printed, the log line ends `issue not opened: ` followed by the failure reason, and the operator is told; that line does not count as accepted earlier. Nothing is committed and nothing is written into `ledgerly/`
---
Two variants of one run. The operator runs `/merge-bar:retro --last 10` today, 2026-10-31, in
`/home/dev/projects/ledgerly` of the public repo `acme/ledgerly`. Its parent directory holds
`ledgerly/` and `ledgerly-ai/`; `ledgerly-ai/.workspace/pairing.json` has `canonical.name` =
"ledgerly", and only it matches. `gh pr list --state merged` returns #71 to #80.

What existed before the run, in `ledgerly-ai/`:

- `.claude/memory-bank/review-ledger.md` with lines for #72, #75 and #79. #72 and #79 both block
  "Fixture has no result file" (a fixture in `tests/eval/fixtures/<surface>/` with no matching
  file in `tests/eval/results/<surface>/`; #72 C1 lists one, #79 C2 lists two). #75 blocks
  "Comment restates the code". Reports exist for each.
- `CODING_STANDARDS.md` with `## Entries` and two entries, neither about fixtures or result files.
- No `retro-log.md`.

The run's proposals include P1, for the fixture/result pair. The operator replies: "P1: yes, open it." and nothing else.

In Variant A `gh issue create` succeeds and prints an issue URL ending `/issues/88`. In Variant
B `gh issue create` exits 1 with `GraphQL: Resource not accessible by integration`. `gh` otherwise
works in both.

The run may write only `ledgerly-ai/.claude/memory-bank/retro-log.md` and
`ledgerly-ai/CODING_STANDARDS.md`, may open one issue in `acme/ledgerly`, and writes nothing
into `ledgerly/`.
