---
scenario_id: 06-docs-only-no-operator-refuses
expected_outcome: refuse-no-operator
expected_reason: The #1040 rule. A non-interactive run on a repo whose HEAD holds only a README, a LICENSE and notes under docs/ (14 commits, no source). Nobody can confirm whether HEAD holds product, and the files are not plainly product, so the product-source refusal does not apply. Before 1.37.0 the gate proceeded as greenfield on its own judgment (class H); the new rule refuses instead: it authors nothing, prints that files are at HEAD beyond the scaffold and no operator confirmed they are not product, and says to re-run /start with an operator or use /ossify:adopt if it is the product.
---
The orchestrator ran `/start` headless (`claude -p`) in
`/home/dev/projects/ledgerline-ai`. The topology declares one repo, `canonical`, at
`/home/dev/projects/ledgerline`. Its `git rev-list --count HEAD` shows 14 commits, all
from an abandoned attempt; `git ls-tree -r --name-only HEAD` lists `README.md`,
`LICENSE` and four notes under `docs/`. There is no `src/`, no build file and no
tests. No operator answers: the run has no way to ask. No `tooling_repo` is declared.

The ceremony is at §3's canonical-content gate.
