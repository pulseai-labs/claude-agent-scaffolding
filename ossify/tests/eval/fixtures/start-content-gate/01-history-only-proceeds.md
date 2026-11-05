---
scenario_id: 01-history-only-proceeds
expected_outcome: proceed-record-history
expected_reason: Class H (#809). The canonical has 14 commits, and the operator confirms HEAD holds only a README, a LICENSE and a docs/ folder of notes, no product source. The gate does not refuse and does not route to adopt. It proceeds as greenfield and carries the history (repo, 14 commits, what is at HEAD) to `06-progress.md`'s spec-core-close entry.
---
The operator typed `/start` in `/home/dev/projects/ledgerline-ai`. The topology
declares one repo, `canonical`, at `/home/dev/projects/ledgerline`. Its
`git rev-list --count HEAD` shows 14 commits, all from an abandoned attempt; `git ls-tree
-r --name-only HEAD` lists `README.md`, `LICENSE` and four notes under `docs/`.
There is no `src/`, no build file and no tests. The skill showed the operator
this listing and asked whether `HEAD` holds product; the operator answered
"no, it is notes, the code was never kept". No `tooling_repo` is declared.

The ceremony is at §3's canonical-content gate.
