---
scenario_id: 04-source-operator-says-not-product
expected_outcome: proceed-record-history
expected_reason: The probe lists a `src/` and a `Cargo.toml`, so the files look like product, but the operator, asked to confirm, says they are a dead prototype kept only for reference and not the product. Whether HEAD holds product is the operator's call once asked, so the gate does not refuse and does not route to adopt. It proceeds as greenfield and carries the history (repo, 31 commits, what is at HEAD) to the §13 hand-off.
---
The operator typed `/start` in `/home/dev/projects/sketchpad-ai`. The topology
declares one repo, `canonical`, at `/home/dev/projects/sketchpad`. `git ls-tree
-r --name-only HEAD` lists `Cargo.toml`, `src/main.rs`, `src/canvas.rs` and a
`README.md`; `git rev-list --count HEAD` shows 31 commits. The skill showed the
operator this listing and asked whether `HEAD` holds product; the operator
answered "no, that is a dead prototype from 2023, the real product has not been
started; keep it for reference". No `tooling_repo` is declared.

The ceremony is at §3's canonical-content gate.
