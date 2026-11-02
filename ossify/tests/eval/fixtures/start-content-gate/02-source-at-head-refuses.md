---
scenario_id: 02-source-at-head-refuses
expected_outcome: refuse-route-adopt
expected_reason: Product source at HEAD (a Rust crate with src/ and tests/) refuses fail-fast, authors nothing and routes to /ossify:adopt, which takes a project with the legacy scaffold stack and a plain repo with product source alike (ossify 1.35.0 or later, #536).
---
The operator typed `/start` in `/home/dev/projects/pulsevision-ai`. The topology
declares one repo, `canonical`, at `/home/dev/projects/pulsevision`. `git ls-tree
-r --name-only HEAD` lists `Cargo.toml`, `src/main.rs`, `src/render.rs`,
`tests/render.rs` and a `README.md`; `git rev-list --count HEAD` shows 9 commits. The
operator confirms this is the product. There is no legacy scaffold stack, and the skill does not treat that as a reason to refuse adopt as a route.

The ceremony is at §3's canonical-content gate.
