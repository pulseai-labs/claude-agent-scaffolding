---
scenario_id: 02-third-repo-still-refuses-halts
expected_outcome: halt
expected_reason: the re-probe must check every declared repo, not stop once some resolve; a probe that still refuses on any one of them halts the ceremony rather than letting it proceed on partial success
---
A fresh AI workspace is running `/start`. Neither `.ossify/topology.json` nor
`.workspace/pairing.json` exists anywhere on the walk-up path, so
`oss state_path` refuses at rc 2.

The operator names three repos the product spans: `api-gateway`,
`worker-fleet`, and `ml-pipeline`. `.ossify/topology.json` is authored with
all three entries, but the third one's root was left as the unresolved
placeholder token `${to-fill-in}` rather than an absolute path.

The re-probe runs: `oss state_path` now resolves, `oss repo_root api-gateway`
resolves, and `oss repo_root worker-fleet` resolves. `oss repo_root
ml-pipeline` still refuses at rc 2, because its declared root is not an
absolute path.
