---
scenario_id: 01-plain-repo-authors-topology-proceeds
expected_outcome: proceed-class-p
expected_reason: Class P. A1 finds no topology on the walk-up path, asks which repos hold the product, and authors .ossify/topology.json in the operator-made AI workspace with the one repo named. HEAD carries a Rust crate and the AI workspace has no roadmap state or cursor, so the class step picks P. A3 exempts only the topology A1 just authored, A4 uses git worktree list --porcelain, A5 records "no legacy stack", and A6 passes because the operator names a working step.
---
The operator made `/home/dev/projects/pulsevision-ai` (`git init`, empty) and
typed `/ossify:adopt` there. No `.ossify/topology.json` or `.workspace/pairing.json`
is on the walk-up path. The skill asked which repos hold the product; the operator
named `/home/dev/projects/pulsevision` (Rust: `Cargo.toml`, `src/`, `tests/`, 9
commits, on `main`, its own `CLAUDE.md` and `SPEC.md`). There is no
`05-active-context.md`, no roadmap state and no `.worktrees` anywhere. A1 has just
authored `.ossify/topology.json` (untracked). `git status --porcelain
--untracked-files=all` in the AI workspace shows only `?? .ossify/topology.json`.
Asked at A6 for a step that works from a clean checkout today, the operator said:
"`cargo run -- render demo.scene` writes `demo.png`; I watched it last night."

The ceremony is at the class step and the gates A3 to A6.
