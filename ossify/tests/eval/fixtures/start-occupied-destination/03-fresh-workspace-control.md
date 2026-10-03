---
scenario_id: 03-fresh-workspace-control
expected_outcome: write-all
expected_reason: Negative control. Past both §3 gates, no destination holds a file, so the skill asks nothing about existing files, runs oss init and goes on to the stations; every output is written when its station comes, with no stop.
---
The operator typed `/start` in a new AI workspace,
`/home/dev/projects/ledgerline-ai`. The workspace holds only
`.ossify/topology.json`, authored a moment ago at §3's topology probe. It has
no ossify state, no `MASTER-SPEC.md`, no `EXECUTIVE-SUMMARY.md`, no
`CLAUDE.md` and no `.claude/` directory. The topology declares one repo,
`canonical`, at `/home/dev/projects/ledgerline`; it holds only a `.git` with no
commits and no `PUBLIC_BOUNDARY.md`, so the canonical-content gate passes.

The ceremony is in §3, past both gates, about to run `oss init "ledgerline"`.
