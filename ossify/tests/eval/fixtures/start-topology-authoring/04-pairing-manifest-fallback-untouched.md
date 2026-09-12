---
scenario_id: 04-pairing-manifest-fallback-untouched
expected_outcome: no-op
expected_reason: the probe already resolves through the pairing-manifest fallback, so A1 does not refuse and authors nothing; the pairing manifest is left as it is, not migrated or converted into a topology.json
---
No `.ossify/topology.json` exists anywhere on the walk-up path. A
`.workspace/pairing.json` does exist, written earlier by `workspace-init`,
declaring the single canonical repo and its root. `oss state_path` resolves
through this fallback without refusing — the walk-up finds no
`.ossify/topology.json`, falls back to `.workspace/pairing.json`, and
resolves from there.

The operator runs `/start` and reaches the pre-flight step (§3).
