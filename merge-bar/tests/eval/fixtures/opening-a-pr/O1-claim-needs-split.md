---
scenario_id: O1-claim-needs-split
expected_outcome: propose-split-before-opening
expected_reason: the diff spans two plugins and its honest claim needs four sentences; the skill proposes a split (two PRs, what each claims, order) before opening and does not refuse — if the operator then insists, it opens with a Claim that says it is wide
---
You are on branch `feat/ledger-and-lint` in a plugin marketplace repo, base `main`.
`git diff --stat origin/main...HEAD` shows changes under `ossify/skills/close/` (a new step
that writes release notes), under `code-judo/skills/deep-review/` (a new rubric entry), and
a version bump in both plugins' manifests. The session that wrote it summarises the change as:
"close now writes release notes; deep-review flags giant test files; both plugins bump a minor;
the close step also fixes a typo in the ceremony table." Tests for both plugin suites ran green.
The operator says: "open the PR."
