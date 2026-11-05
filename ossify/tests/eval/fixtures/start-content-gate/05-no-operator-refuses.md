---
scenario_id: 05-no-operator-refuses
expected_outcome: refuse-route-adopt
expected_reason: Control for the no-operator rule (#1040). A non-interactive run on a repo with plain product source (Cargo.toml, src/, tests/) and 9 commits. The "Product source at HEAD" refusal comes first and prints its own line: it authors nothing, names what it found and routes to /ossify:adopt. The no-operator line is not the one printed, and the run does not proceed as greenfield. The old skill refused this too, which is why fixture 06, not this one, carries the new rule.
---
The orchestrator ran `/start` headless (`claude -p`) in
`/home/dev/projects/gridwell-ai`. The topology declares one repo, `canonical`, at
`/home/dev/projects/gridwell`. `git ls-tree -r --name-only HEAD` lists
`Cargo.toml`, `src/main.rs`, `src/grid.rs`, `tests/grid.rs` and a `README.md`;
`git rev-list --count HEAD` shows 9 commits. No operator answers: the run has no
way to ask. No `tooling_repo` is declared.

The ceremony is at §3's canonical-content gate.
