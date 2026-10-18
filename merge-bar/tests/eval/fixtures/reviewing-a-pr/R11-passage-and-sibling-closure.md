---
scenario_id: R11-passage-and-sibling-closure
expected_outcome: one-class-three-sites-sibling-by-meaning
expected_reason: `Settings` keeps every duration in milliseconds while the deleted `load_cfg()` handed callers seconds, so a duration passed to a seconds API without `/ 1000` waits 1000 times too long; that is ONE class with exactly three sites, all in scope — client/retry.py:28 (`time.sleep(settings.retry_delay_ms)`, the obvious one, pinned by the test's `[500, 500]`), client/retry.py:31 (`elapsed > settings.budget_ms`, seconds compared with milliseconds, three lines further down the same loop, changed by the diff only as part of the `cfg` → `settings` rename) and client/heartbeat.py:22 (`self._stop.wait(self.settings.heartbeat_every)`, a different file doing the same job — wait a configured duration — with no `sleep` and no `_ms` in its text, so the server's 60 s idle limit drops the connection) — found by a stated repo-wide sweep with its hit count over every read of a `Settings` duration field, not only of the first site's text; client/poll.py:12 (`time.sleep(settings.retry_delay_ms / 1000)`) is the decoy that a literal sweep of the first site hits and is correct, and is not a site; the class is sorted condition 2 (the Claim says no behaviour changes; condition 1 also met is acceptable), direction `n/a` or "admits what it cannot handle"; all six diff files appear in the coverage table; a report that names only client/retry.py:28, omits client/retry.py:31 or client/heartbeat.py:22, reports client/heartbeat.py:22 as a separate class, or lists client/poll.py:12 fails class_complete
---
Review PR `acme/wirecall#540` ("settings: replace the cfg dict with a typed Settings"). Invoked
as `/merge-bar:review-pr 540`. This is round 1. Everything the review can read is below: the
commands' output and the checkout's files. A search of the checkout finds only what is shown.

`gh pr view 540 --json body,headRefOid,baseRefName,files` returns `headRefOid`
`6a0d4f8b2e6c0a4e8b2d6f0a4c8e2b6d0f4a8c2e`, `baseRefName` `main`, and six files:
`app/config.py` (deleted), `app/settings.py` (new), `client/retry.py`, `client/poll.py`,
`client/heartbeat.py`, `tests/test_retry.py`. In the checkout, `git rev-parse HEAD` prints
`6a0d4f8b2e6c0a4e8b2d6f0a4c8e2b6d0f4a8c2e`. Single repo: no `.workspace/pairing.json` exists
beside it. The repo root has `CODING_STANDARDS.md`:

```markdown
# Coding standards — wirecall
- Public functions carry type hints.
- Configuration is read once, at startup, into one typed object.
- A refactor that claims no behaviour change has a test for each behaviour it moves.
```

The PR body (it names issue #533 as its spec; no verifier report exists):

```markdown
## Claim
Every module reads its settings from a frozen `Settings` instead of the untyped `cfg` dict.
No behaviour changes: the same `settings.yaml` produces the same waits and limits.

## Scope
Touches: `app/config.py` (removed), `app/settings.py`, `client/retry.py`, `client/poll.py`,
`client/heartbeat.py`, `tests/test_retry.py`.
Deliberately does not touch: `settings.yaml` (its keys and values stay as they are).

## Known limits
- An unknown key in `settings.yaml` now fails at startup instead of being ignored.

## Merge danger
Door: two-way — a revert restores `load_cfg()`; nothing persists.
Blast radius: every client call path.

## Merge bar
A finding blocks this PR only if it:
1. rejects valid input, or corrupts or loses state, on a path this PR touches;
2. makes the Claim above false;
3. breaks the test suite;
4. opens a security hole — injection, authentication bypass, or an exposed secret.
Everything else is non-blocking.

## Evidence
`pytest tests/test_retry.py` — 1 passed.

## Closes
Closes #533
```

Issue #533: "Replace `cfg` with a typed settings object. Pure refactor — nothing a user can
observe may change."

`settings.yaml` (unchanged): `retry_delay_ms: 500`, `budget_ms: 10000`, `heartbeat_every: 15000`.

The diff (`git diff main...HEAD`), with new-file line numbers:

`app/config.py` (deleted):

```python
- def load_cfg(path: str) -> dict:
-     raw = yaml.safe_load(open(path))
-     return {k.removesuffix("_ms"): v / 1000 for k, v in raw.items()}  # callers get seconds
```

`app/settings.py` (new):

```python
 6+ @dataclass(frozen=True)
 7+ class Settings:
 8+     """Field names are the settings.yaml keys. Every duration is in milliseconds."""
 9+     retry_delay_ms: int = 500
10+     budget_ms: int = 10_000
11+     heartbeat_every: int = 15_000
12+
13+     @classmethod
14+     def load(cls, path: str) -> "Settings":
15+         with open(path) as fh:
16+             return cls(**yaml.safe_load(fh))
```

`client/retry.py`:

```python
16- def call_with_retry(fn: Callable[[], T], cfg: dict, attempts: int = 3) -> T:
16+ def call_with_retry(fn: Callable[[], T], settings: Settings, attempts: int = 3) -> T:
17      """Call fn, retrying TransientError up to `attempts` times within the budget."""
18      started = time.monotonic()
19      last_error: Exception | None = None
20      for attempt in range(attempts):
21          try:
22              return fn()
23          except TransientError as exc:
24              last_error = exc
25          log.info("attempt %d/%d failed: %s", attempt + 1, attempts, last_error)
26          if attempt + 1 == attempts:
27              break
28-         time.sleep(cfg["retry_delay"])
28+         time.sleep(settings.retry_delay_ms)
29          elapsed = time.monotonic() - started
30          log.debug("retry budget used: %.1fs", elapsed)
31-         if elapsed > cfg["budget"]:
31+         if elapsed > settings.budget_ms:
32              break
33      raise RetryBudgetExceeded(last_error)
```

`client/poll.py`:

```python
 9- def wait_ready(conn: Conn, cfg: dict) -> None:
 9+ def wait_ready(conn: Conn, settings: Settings) -> None:
10      """Block until the server reports ready."""
11      while not conn.ready():
12-         time.sleep(cfg["retry_delay"])
12+         time.sleep(settings.retry_delay_ms / 1000)
```

`client/heartbeat.py`:

```python
 8  class Heartbeat(threading.Thread):
 9      """Pings so the server keeps the connection; it drops one idle for 60 s."""
10
11-     def __init__(self, conn: Conn, cfg: dict) -> None:
11+     def __init__(self, conn: Conn, settings: Settings) -> None:
12          super().__init__(daemon=True)
13          self.conn = conn
14-         self.cfg = cfg
14+         self.settings = settings
15          self._stop = threading.Event()
16
17      def stop(self) -> None:
18          self._stop.set()
19
20      def run(self) -> None:
21          """Ping every `heartbeat_every` until stopped."""
22-         while not self._stop.wait(self.cfg["heartbeat_every"]):
22+         while not self._stop.wait(self.settings.heartbeat_every):
23              self.conn.ping()
```

`tests/test_retry.py` (new): one test. It patches `time.sleep` to record its argument, calls
`call_with_retry` with an `fn` that raises `TransientError` twice and then returns, and asserts
the recorded sleeps are `[500, 500]`. No test covers the budget, `wait_ready` or `Heartbeat`.

No other file in the checkout reads a `Settings` field, calls `time.sleep`, or waits on a
`threading.Event`.
