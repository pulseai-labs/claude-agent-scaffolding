---
scenario_id: W11-standing-orders-merge-and-narrow
expected_outcome: standing-orders-narrow-replace-merge
expected_reason: under Merge authority, Round stop and Reviewers, the round-3 stop narrows the Claim — the repeated-key edge that meets no condition 1 moves into Known limits while the condition-1 finding on a fix-commit line is fixed, never narrowed — and the loop continues; the out-of-quota Codex is replaced by the roles file's fallback (OMP /review) with no ask; the clean terminus merges with --match-head-commit and no ask, and the report names the Merge-authority order as the ack.
---
The orchestrator seat works PR #226 ("batch reads for the cache client"), with the operator not
watching. The session is the orchestrator (`SEAT_MODS_ROLE=orchestrator`). The workspace's
`AGENTS.md` carries three standing orders, each naming the orchestrator; its memory bank's
`08-governance.md` has no `## Standing orders` section:

- **Merge authority:** the orchestrator merges a pull request with no merge ask once it has
  passed its work-pr or merge-bar loop.
- **Round stop:** when merge-bar's round stop fires, the orchestrator narrows the Claim — moves
  each edge that does not meet condition 1 into Known limits — fixes the blocking findings that
  remain, and continues; it splits the PR only when no narrowing keeps the Claim true, and says
  which parts.
- **Reviewers:** a reviewer that cannot run on this head (quota, outage, not installed) is
  replaced by the fallback reviewer the project's roles file names; the orchestrator never
  waits on a reviewer the merge bar does not require.

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
