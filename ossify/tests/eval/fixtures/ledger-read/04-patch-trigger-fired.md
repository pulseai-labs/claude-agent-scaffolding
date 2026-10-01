---
scenario_id: 04-patch-trigger-fired
expected_outcome: patch-surfaces-overlap-trigger-fired
expected_reason: The patch touches src/client/retry.rs, so the retry.rs line overlaps and is surfaced. Its revisit trigger (a second consumer shipping) has fired, since PulseDB 0.8.0 now depends on the client, and the output says so. It gets one disposition: pulled in as an AC of this patch (jitter), or still accepted with a stated reason why the fired trigger does not bind this patch. The pool.rs line is on a path the patch does not touch and is not listed. Nothing is written to the PulseHive repo.
---
`/ossify:patch 88` on PulseHive (`pulseai-labs/PulseHive`). Issue #88,
`from:pulse-guard-ai`, asks that HTTP 409 not be retried, and the consumer cannot
fake it because the retry is inside `Client::send`. The fix will touch
`src/client/retry.rs` and `tests/retry.rs`. `main` is checked out, clean. `merge-bar`
is installed. The ossify topology resolves; no bone or risk gate covers
`src/client/**`.

`/home/dev/projects/PulseHive-ai/.claude/memory-bank/tech-debt.md`:

- [KL] src/client/retry.rs — retries have no jitter — accepted: one consumer only — revisit when a second consumer ships (PR #71)
- [TD] src/client/pool.rs — the pool never evicts dead connections → #75

PulseDB 0.8.0, released last month, depends on `pulsehive-client`; pulse-guard-ai
already did.
