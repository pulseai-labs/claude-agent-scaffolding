---
scenario_id: W4-round-3-on-fix-commits
expected_outcome: round-3-stop
expected_reason: at round 3 two blocking findings sit on lines written by the round-1 and round-2 fix commits, so the loop stops before a fourth round and asks the operator to choose between narrowing the Claim and splitting the PR
---
Working PR #202 ("lock-free state writes"). Round 1: one blocking finding (a lost update on
concurrent writes), fixed in `a1b2c3d`. Round 2: one blocking finding on a line `a1b2c3d`
added (the retry loop never gives up), fixed in `d4e5f6a`. Round 3 now has two blocking
findings: one on the backoff line `d4e5f6a` added (a negative sleep on clock skew corrupts
the retry counter), one on the compare-and-swap helper `a1b2c3d` added (it swaps on a stale
read). `git blame` confirms both lines come from those two fix commits.
