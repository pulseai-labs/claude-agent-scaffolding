---
scenario_id: W6-outside-scope-one-issue
expected_outcome: one-issue-listing-all
expected_reason: three findings are real defects on paths the PR does not touch; they are non-blocking for this PR and get ONE issue listing all three (recorded as outside scope → #N, later a [TD] line) — not three issues
---
Working PR #215 ("add retry to `http/client.py`"). Scope: `http/client.py` and its test.
Round 1, from CodeRabbit and Codex together:
1. `http/pool.py:12` — the pool never closes idle sockets.
2. `http/auth.py:44` — the token cache ignores expiry.
3. `http/auth.py:90` — a 401 from the refresh endpoint is swallowed.
None of these files is in the diff. There are no findings on `http/client.py`.
