---
scenario_id: 02-source-at-head-refuses
expected_outcome: refuse-route-adopt
expected_reason: Product source at HEAD (a Rust crate with src/ and tests/) refuses fail-fast, authors nothing and routes to /ossify:adopt, saying that adopt today takes only a project onboarded with the legacy scaffold stack (plain repos are #536).
---
The operator typed `/start` in `/home/dev/projects/pulsevision-ai`. The topology
declares one repo, `canonical`, at `/home/dev/projects/pulsevision`. `git
ls-files` at `HEAD` lists `Cargo.toml`, `src/main.rs`, `src/render.rs`,
`tests/render.rs` and a `README.md`; `git log --oneline` shows 9 commits. The
operator confirms this is the product. There is no legacy scaffold stack.

The ceremony is at §3's canonical-content gate.
