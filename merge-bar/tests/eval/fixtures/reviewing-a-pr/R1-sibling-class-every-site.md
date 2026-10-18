---
scenario_id: R1-sibling-class-every-site
expected_outcome: one-class-four-sites
expected_reason: the `args.<flag> or DEFAULT_<X>` fallback turns a documented valid 0 into the default; that is ONE class with exactly four sites — cli/fetch.py:48, cli/fetch.py:49 and cli/upload.py:31 (in scope) and cli/sync.py:57 (listed and marked outside scope) — found by a stated repo-wide sweep with its hit count; cli/upload.py:30 (`chunk_size`, where 0 is refused upstream by `positive_int`) and cli/upload.py:32 and cli/sync.py:58 (already `is not None`) are not sites; the class is sorted condition 1 (condition 2 also met is acceptable), direction "refuses valid input"; all four diff files appear in the coverage table; a report that names only cli/fetch.py:48, gives the sites as separate unclassed findings, or omits cli/sync.py:57 because the diff does not touch it fails class_complete
---
Review PR `acme/fetchkit#412` ("cli: configurable retries and timeout"). Invoked as
`/merge-bar:review-pr 412`. This is round 1. Everything the review can read is below: the
commands' output and the checkout's files. A search of the checkout finds only what is shown.

`gh pr view 412 --json body,headRefOid,baseRefName,files` returns `headRefOid`
`4f1c2a9e7b3d5f60812a4c6e8b0d2f4a6c8e0b1d`, `baseRefName` `main`, and four files:
`cli/options.py`, `cli/fetch.py`, `cli/upload.py`, `tests/test_retries.py`. In the checkout,
`git rev-parse HEAD` prints `4f1c2a9e7b3d5f60812a4c6e8b0d2f4a6c8e0b1d`. Single repo: no
`.workspace/pairing.json` exists beside it. The repo root has `CODING_STANDARDS.md`:

```markdown
# Coding standards — fetchkit
- Public functions carry type hints.
- No `print` in library modules under `fetchkit/`; use `logging`.
- Every new CLI flag has a test that passes it.
```

The PR body (it names issue #398 as its spec; no verifier report exists):

```markdown
## Claim
`fetch` and `upload` accept `--max-retries N` and `--timeout S`. As `--help` says, 0 means
no retries and no timeout.

## Scope
Touches: `cli/options.py`, `cli/fetch.py`, `cli/upload.py`, `tests/test_retries.py`.
Deliberately does not touch: `cli/sync.py` (its flags are reworked in #415).

## Known limits
- Negative values are refused by argparse with a usage error — they have no meaning.

## Merge danger
Door: two-way — a revert restores the fixed defaults; nothing persists.
Blast radius: scripts that call `fetch` or `upload` with the new flags.

## Merge bar
A finding blocks this PR only if it:
1. rejects valid input, or corrupts or loses state, on a path this PR touches;
2. makes the Claim above false;
3. breaks the test suite;
4. opens a security hole — injection, authentication bypass, or an exposed secret.
Everything else is non-blocking.

## Evidence
`pytest tests/test_retries.py` — 4 passed.

## Closes
Closes #398
```

Issue #398: "Let callers set retries and timeout on fetch and upload; 0 must disable each."

The diff (`git diff main...HEAD`), with new-file line numbers:

`cli/options.py` (existing file; lines 20–25 added):

```python
 3  DEFAULT_RETRIES = 3
 4  DEFAULT_TIMEOUT = 30.0
 5  DEFAULT_CHUNK = 8 * 1024 * 1024
 7  def positive_int(text: str) -> int:          # refuses 0 and negatives
12  def non_negative_int(text: str) -> int:      # refuses negatives, accepts 0
16  def non_negative_float(text: str) -> float:  # refuses negatives, accepts 0
20+ def add_retry_flags(parser: argparse.ArgumentParser) -> None:
21+     parser.add_argument("--max-retries", type=non_negative_int, default=None,
22+                         help="retries before giving up; 0 = no retries (default 3)")
23+     parser.add_argument("--timeout", type=non_negative_float, default=None,
24+                         help="seconds per request; 0 = no timeout (default 30)")
25+
```

`cli/fetch.py`:

```python
44      parser = argparse.ArgumentParser(prog="fetch")
45      parser.add_argument("url")
46+     add_retry_flags(parser)
47      args = parser.parse_args(argv)
48+     retries = args.max_retries or DEFAULT_RETRIES
49+     timeout = args.timeout or DEFAULT_TIMEOUT
50+     client = Client(retries=retries, timeout=timeout if timeout > 0 else None)
```

(Removed: `client = Client(retries=DEFAULT_RETRIES, timeout=DEFAULT_TIMEOUT)`.)

`cli/upload.py`:

```python
26      parser.add_argument("--chunk-size", type=positive_int, default=None)
27+     add_retry_flags(parser)
28      args = parser.parse_args(argv)
29
30      chunk = args.chunk_size or DEFAULT_CHUNK
31+     retries = args.max_retries or DEFAULT_RETRIES
32+     timeout = args.timeout if args.timeout is not None else DEFAULT_TIMEOUT
33+     client = Client(retries=retries, timeout=timeout if timeout > 0 else None)
```

`tests/test_retries.py` (new): four tests through a `capture_client` fixture that records the
`Client` kwargs — `fetch --max-retries 5` → `retries == 5`; `fetch --timeout 10` →
`timeout == 10`; `upload --max-retries 2` → `retries == 2`; `upload --timeout 0` →
`timeout is None`. No test passes `--max-retries 0`.

Files in the checkout outside the diff:

`cli/sync.py` (unchanged by this PR):

```python
41      parser.add_argument("--max-retries", type=non_negative_int, default=None,
42                          help="retries before giving up; 0 = no retries (default 3)")
55      args = parser.parse_args(argv)
56      # --max-retries 0 disables retries (see --help)
57      retries = args.max_retries or DEFAULT_RETRIES
58      backoff = args.backoff if args.backoff is not None else DEFAULT_BACKOFF
```

`fetchkit/client.py`: `Client(retries: int, timeout: float | None)` — `retries=0` makes one
attempt; `timeout=None` waits without limit.

No other file in the checkout matches ` or DEFAULT_`, `max_retries` or `args.timeout`.
