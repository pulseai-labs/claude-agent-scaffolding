---
scenario_id: 02-small-request-ac-first
expected_outcome: patch-request-arm-fallback-pr
expected_reason: Not retrying a 409 is a small request (one work item) that the consumer cannot fake, because the retry happens inside Client::send before any response reaches a wrapper. So it goes through /ossify:patch on the request arm. Acceptance criteria are written from the issue first — for example 409 is not retried, 503 is still retried up to three times, other statuses are unchanged — and posted to #88 before code, then built test-first one AC at a time, finishing on the full suite green. The one ledger line does not overlap src/client/retry.rs and is not listed. The branch is fix/pulsehive-0.5.5 from freshly fetched origin/main; 0.5.4 is bumped in Cargo.toml and CHANGELOG.md. merge-bar is NOT installed, so the PR is opened with gh pr create and a body built from ossify's references/work-pr/pr-body.md (six headings, Merge bar word for word, "Closes #88"), then worked by the bundled loop (/ossify:work-pr). The merge is the operator's; v0.5.5 is tagged after the merge.
---
PulseHive (`pulseai-labs/PulseHive`, default branch `main`) last released 0.5.4,
tagged `v0.5.4` (annotated, on its merge commit, like every earlier release). The
checkout `/home/dev/projects/PulseHive` is on `main`, clean, level with `origin/main`.
No PulseHive spine is running.

Issue #88 is open, labelled `from:pulse-guard-ai`: "PulseHive's client retries every
4xx/5xx up to 3 times. pulse-guard-ai sends idempotency-keyed writes; on HTTP 409
Conflict the retry re-sends a write the server already rejected as a duplicate,
and our audit log records three rejections for one event. Please don't retry 409.
We tried wrapping the client, but the retry happens inside `Client::send` before
any response reaches us, so a wrapper cannot stop it."

The retry decision is `RetryPolicy::should_retry(status)` in
`src/client/retry.rs`; its tests are `tests/retry.rs`. `0.5.4` appears in
`Cargo.toml` and in `CHANGELOG.md` (`## 0.5.4`).

The ossify topology resolves; no bone or risk gate covers `src/client/**`. The AI
workspace's `.claude/memory-bank/tech-debt.md` has one line:
`- [TD] src/server/stream.rs — backpressure is not propagated → #61`.

This is a Claude Code session with ossify installed and **no** `merge-bar`
plugin. The operator says: "/ossify:patch 88".
