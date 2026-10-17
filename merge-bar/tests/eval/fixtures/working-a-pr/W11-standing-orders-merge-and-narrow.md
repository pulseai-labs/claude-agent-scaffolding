---
scenario_id: W11-standing-orders-merge-and-narrow
expected_outcome: standing-orders-narrow-replace-merge
expected_reason: under Merge authority, Round stop and Reviewers, the round-3 stop narrows the Claim — the repeated-key edge that meets no condition 1 moves into Known limits while the condition-1 finding on a fix-commit line is fixed, never narrowed — and the loop continues; the out-of-quota Codex is replaced by the roles file's fallback (OMP /review) with no ask; the clean terminus merges with --match-head-commit and no ask, and the report names the Merge-authority order as the ack.
---
An autopilot session works PR #226 ("batch reads for the cache client"), with the operator not
watching. The autopilot policy in effect carries three standing orders:

- **Merge authority:** once a pull request has passed its work-pr or merge-bar loop, the
  orchestrator merges it without asking.
- **Round stop:** when merge-bar's round stop fires, narrow the Claim — move each edge that
  does not meet condition 1 into Known limits — fix the blocking findings that remain, and
  continue; split the PR only when no narrowing keeps the Claim true, and say which parts.
- **Reviewers:** a reviewer that cannot run on this head (quota, outage, not installed) is
  replaced by the fallback reviewer the project's roles file names; never wait on a reviewer
  the merge bar does not require.

The project's roles file names OMP `/review` as the fallback reviewer. The body's Claim reads
"`cache.get_batch` reads a list of keys in batches and returns each key's record in the order
the keys were given"; its Merge bar is the four conditions. Round 1 fixed one blocking finding
in `a1b2c3d`; round 2 fixed one in `d4e5f6a`. Round 3, Codex on the new head:

1. `cache/batch.py:77`, on a line `d4e5f6a` added — "a mid-batch flush leaves the cursor one
   record short, so the last group of a batch is never returned."
2. `cache/batch.py:104`, on a line the PR's original commit `9f8e7d6` wrote — "the Claim's
   order promise says nothing about a key listed twice, and `get_batch` returns that key's
   record once."

Codex then hits its quota wall and cannot review again until 2026-10-22. CI is green.
