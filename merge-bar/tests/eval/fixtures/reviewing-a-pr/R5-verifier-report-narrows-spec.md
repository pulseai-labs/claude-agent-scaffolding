---
scenario_id: R5-verifier-report-narrows-spec
expected_outcome: claim-only-cites-verifier
expected_reason: with `--verifier` given, the header names that report's path and the Claim/Spec axis checks the Claim's sentences only, citing the verifier report for the spec (WI-3's AC1–AC4 met, 41 passed) instead of re-walking AC1–AC4 itself; that Claim check finds that `--since` refuses ISO-8601 dates (`since_arg` calls `int(text)`, eventlog/cli/export.py:23) although the Claim and the flag's help promise them — one class, sweep stated (one site), condition 2 (condition 1 also met is acceptable), direction "refuses valid input"; standards come from the paired workspace's `/home/dev/projects/eventlog-ai/CODING_STANDARDS.md`, named in the header; a report that says `Verifier report: none`, ignores the report, or verifies the spec's acceptance criteria one by one as its own Spec work fails inputs_resolved
---
Review PR `acme/eventlog#91` ("export: `--since` filter"), opened by a crew run for work item
WI-3. Invoked as
`/merge-bar:review-pr 91 --verifier /home/dev/.cache/crew-runs/r7/verify-WI-3.md` from the
checkout `/home/dev/projects/eventlog`. Round 1. Everything the review can read is below. A
search of the checkout finds only what is shown.

`gh pr view 91 --json body,headRefOid,baseRefName,files`: `headRefOid`
`7c2b9d4e1f0a3b5c6d8e9f0a1b2c3d4e5f6a7b8c`, `baseRefName` `main`, files
`eventlog/cli/export.py`, `tests/test_export.py`. `git rev-parse HEAD` prints the same SHA.

`/home/dev/projects/eventlog-ai/.workspace/pairing.json` names canonical `eventlog`; that
workspace's root holds `CODING_STANDARDS.md`:

```markdown
- Parse user input at the boundary; internal code takes typed values.
- Each test asserts on observable output, never on a mock's call list.
```

The verifier report, `/home/dev/.cache/crew-runs/r7/verify-WI-3.md`:

```markdown
# Verify — WI-3 at 7c2b9d4e1f0a3b5c6d8e9f0a1b2c3d4e5f6a7b8c
Spec: eventlog-ai/docs/specs/wi-3.md
- AC1 `--since 1700000000` exports only events with ts >= 1700000000 — met
  (tests/test_export.py::test_since_epoch, run)
- AC2 a negative `--since` is a usage error, exit 2 — met (test_since_negative, run)
- AC3 with no `--since`, export is unchanged — met (test_no_since, run)
- AC4 `--since` composes with `--type` — met (test_since_and_type, run)
`pytest` — 41 passed. Verdict: WI-3 meets its spec.
```

The spec it cites, `eventlog-ai/docs/specs/wi-3.md`, lists exactly AC1–AC4 as above; it says
nothing about date formats.

The PR body:

```markdown
## Claim
`events export --since T` exports only events at or after T, where T is epoch seconds or an
ISO-8601 date such as `2026-10-01`. Without `--since`, export is unchanged.

## Scope
Touches: `eventlog/cli/export.py`, `tests/test_export.py`. Deliberately does not touch: the
event store, `eventlog/cli/tail.py`.

## Known limits
- Timezones in ISO input are not supported — every timestamp is UTC.

## Merge danger
Door: two-way — a read-only filter; a revert removes the flag.
Blast radius: scripts that pass `--since` to `events export`.

## Merge bar
A finding blocks this PR only if it:
1. rejects valid input, or corrupts or loses state, on a path this PR touches;
2. makes the Claim above false;
3. breaks the test suite;
4. opens a security hole — injection, authentication bypass, or an exposed secret.
Everything else is non-blocking.

## Evidence
`pytest` — 41 passed (verifier run, see WI-3 report).

## Closes
Closes #88
```

The diff:

`eventlog/cli/export.py`:

```python
22+ def since_arg(text: str) -> int:
23+     value = int(text)
24+     if value < 0:
25+         raise argparse.ArgumentTypeError("must be >= 0")
26+     return value
31+     parser.add_argument("--since", type=since_arg, default=None,
32+                         help="epoch seconds or ISO-8601 date (UTC)")
44+     if args.since is not None:
45+         events = (e for e in events if e.ts >= args.since)
```

`tests/test_export.py` (new tests): `test_since_epoch`, `test_since_negative`,
`test_no_since`, `test_since_and_type` — each runs the CLI on a fixture store and asserts on
the exported lines. All pass epoch integers; none passes a date.

Outside the diff: nothing else in the checkout parses `--since` or calls `since_arg`;
`eventlog/cli/tail.py` has no `--since` flag.
