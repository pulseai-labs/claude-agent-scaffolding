---
scenario_id: R8-no-merge-bar-in-body
expected_outcome: template-bar-door-unstated
expected_reason: the body (from `--body`) has no Merge bar and no Merge danger, so the header reads `Bar: template (body has none)` and `Door: unstated (treated one-way)`, the head is the `--head` SHA (which the checkout matches, so no stop although the PR's current head differs), and each class is sorted by the template's four conditions — prune deleting entries whose `mtime` is None (in-flight writes, per cachectl/store.py:40) at cachectl/prune.py:19 is `condition 1` (loses state on a path the PR touches), direction "admits what it cannot handle", listed first; the log line missing the size the standards require (cachectl/prune.py:22) is `non-blocking`; the report says the body has no Claim and names what the Claim/Spec axis checked instead (the Summary or the issue); the reviewer does not edit the PR body, add the missing fields, or refuse because the bar is absent — any of those fails bar_sorted or inputs_resolved
---
Replay review of PR `acme/cachectl#203` ("prune: --older-than"), merged in March before this
repo used the merge-bar body. Invoked as
`/merge-bar:review-pr 203 --head 6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c --body /home/dev/replay/bodies/cachectl-203.md`.
Round 1. Everything the review can read is below. A search of the checkout finds only what is
shown.

The launcher checked out the old head: `git rev-parse HEAD` prints
`6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c`. `gh pr view 203 --json headRefOid,baseRefName`
gives `headRefOid` `ff01a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3` (the merged head, two commits
later) and `baseRefName` `main`. Single repo; root `CODING_STANDARDS.md`:

```markdown
- Log lines that report a deletion name both the count and the bytes freed.
- Never delete what another process may still be writing.
```

`/home/dev/replay/bodies/cachectl-203.md`, the body as it stood at that head:

```markdown
## Summary
Adds `cachectl prune --older-than DAYS`, which deletes cache entries older than DAYS days.
Fixes #197.

## Test plan
- [x] unit tests
- [x] ran prune on staging
```

Issue #197: "Give operators a way to drop old cache entries without wiping the cache." No
verifier report exists.

The diff (`git diff <merge-base main>..HEAD`), files `cachectl/prune.py`, `cachectl/cli.py`,
`tests/test_prune.py`:

`cachectl/prune.py` (new):

```python
14  def prune(store, older_than_days, now=None):
15      now = time.time() if now is None else now
16      cutoff = now - older_than_days * 86400
17      removed = 0
18      for entry in store.entries():
19          if entry.mtime is None or entry.mtime < cutoff:
20              store.delete(entry.key)
21              removed += 1
22      log.info("pruned %d entries", removed)
23      return removed
```

`cachectl/cli.py` (new lines 30–33): a `prune` subcommand with
`--older-than` (`type=positive_int`, required) that calls `prune(store, args.older_than)`.

`tests/test_prune.py` (new): three tests on an in-memory store with fixed `now` — old entries
removed, recent entries kept, return value equals the count removed. Every test entry has an
`mtime`.

Outside the diff, `cachectl/store.py`:

```python
38  def entries(self):
39      """Yield every entry, committed or not.
40      An entry being written has mtime None until its writer commits it."""
```

`cachectl/writer.py:52` sets `mtime` only at commit, after the payload is fully written. No
other caller of `store.delete` exists in the checkout.
