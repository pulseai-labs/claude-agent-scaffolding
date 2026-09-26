---
scenario_id: S1-private-repo-existing-agents-md
expected_outcome: append-agents-md-no-coderabbit
expected_reason: the repo is private, so no .coderabbit.yaml is written and the reason is stated; AGENTS.md exists with build instructions, so a ## Code Review Rules section is appended and nothing else in the file changes; the change goes on a branch and opens as a PR
---
Run setup on `acme/billing-internal`. `gh repo view --json visibility` returns `PRIVATE`.
The root `AGENTS.md` exists with two sections, `## Build` and `## Test`, and no review
section. There is no `.coderabbit.yaml`. The team's most-explained review point is
"money amounts are integer cents; never floats".
