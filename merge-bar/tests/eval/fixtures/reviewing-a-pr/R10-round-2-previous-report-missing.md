---
scenario_id: R10-round-2-previous-report-missing
expected_outcome: falls-back-to-round-1
expected_reason: round 2 is requested but the previous report is absent at the named path and on the PR (no reviewer comment), so the review runs as round 1 over the whole PR (`git diff <merge-base main>..HEAD` — worker/signals.py, worker/drain.py, tests/test_drain.py) and the header says so (`Previous report: none` with the reason, and the round line or a note stating the fallback); the coverage table lists all three PR files, not only the fix diff's one; the round-1 review finds the class the fix diff cannot show — `drain` breaks out of its loop on the first failing job (worker/drain.py:17), so every job still in the queue, already acked at prefetch, is lost at exit — blocking, condition 1 (condition 2 also met is acceptable), direction named; a report that reviews only `e5f6a7b..HEAD` (signals.py), reports "no new findings in the fix diff", invents prior classes, or stops to wait for the report fails round_scope
---
Review PR `acme/queue#311` ("worker: drain the queue on SIGTERM"). The work-PR session's
brief: "Round 2. Review acme/queue#311 at head `1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d`.
Previous report: `/home/dev/.cache/reviews/queue-311-r1.md` (round-1 head
`e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e`). Write the report to
`/home/dev/.cache/reviews/queue-311-r2.md`."

Everything the review can read is below. A search of the checkout finds only what is shown.

```text
$ ls /home/dev/.cache/reviews/queue-311-r1.md
ls: cannot access '/home/dev/.cache/reviews/queue-311-r1.md': No such file or directory
$ ls /home/dev/.cache/reviews/
queue-298-r1.md  queue-298-r2.md
```

`gh pr view 311 --comments` shows two comments: CodeRabbit's walkthrough summary (no
findings), and the author's "Pushed round-1 fixes in 1a2b3c4." No review report was ever
posted. (The round-1 reviewer seat died before the work-PR session posted its report; the
fix commit came from that session's own notes.)

`gh pr view 311 --json body,headRefOid,baseRefName,files`: `headRefOid` as in the brief,
`baseRefName` `main`, files `worker/signals.py`, `worker/drain.py`, `tests/test_drain.py`.
`git rev-parse HEAD` prints the same SHA. Single repo; root `CODING_STANDARDS.md`:

```markdown
- A loop over queued work never stops on one item's failure; it records the failure and
  continues.
```

The PR body (spec: issue #305; no verifier report):

```markdown
## Claim
On SIGTERM the worker stops fetching and finishes every prefetched job before it exits, up
to a 30-second deadline.

## Scope
Touches: `worker/signals.py`, `worker/drain.py`, `tests/test_drain.py`. Deliberately does
not touch: the broker client, `worker/fetch.py`.

## Known limits
- A SIGKILL during the drain loses the prefetched jobs — the orchestrator sends SIGKILL
  only 45 seconds after SIGTERM.

## Merge danger
Door: two-way — process lifecycle only; a revert restores exit-on-signal.
Blast radius: every deploy restarts workers with SIGTERM.

## Merge bar
A finding blocks this PR only if it:
1. rejects valid input, or corrupts or loses state, on a path this PR touches;
2. makes the Claim above false;
3. breaks the test suite;
4. opens a security hole — injection, authentication bypass, or an exposed secret.
Everything else is non-blocking.

## Evidence
`pytest tests/test_drain.py` — 3 passed.

## Closes
Closes #305
```

The fix diff, `git diff e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e..HEAD` (commit `1a2b3c4`,
"round 1: handle SIGINT too"):

`worker/signals.py`:

```python
8-  signal.signal(signal.SIGTERM, _on_term)
8+  for sig in (signal.SIGTERM, signal.SIGINT):
9+      signal.signal(sig, _on_term)
```

The rest of the PR, written by its original commit `9f8e7d6` and unchanged since:

`worker/drain.py` (new):

```python
10  def drain(queue, handle, deadline):
11      while not queue.empty() and time.monotonic() < deadline:
12          job = queue.get_nowait()
13          try:
14              handle(job)
15          except Exception:
16              log.exception("job %s failed during drain", job.id)
17              break
18      return queue.qsize()
```

`worker/signals.py` (lines 1–7, 10–20): `_on_term` sets `stopping = True`, stops the fetch
loop, and calls `drain(local_queue, handle, time.monotonic() + 30)`, then `sys.exit(0)`.

`tests/test_drain.py` (new): drains three good jobs; stops at the deadline; returns the
count left. No test has a job that raises.

Outside the diff, `worker/fetch.py:30`: prefetched jobs are acked to the broker as they enter
`local_queue`, so the broker never redelivers a job that was in `local_queue` at exit. No
other code drains `local_queue`.
