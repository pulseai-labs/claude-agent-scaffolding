# Changelog

## 1.17.0 — 2026-10-13

- On OMP with omp-roles installed, `run-spine` dispatches each work item with `task` and `agent: "implementer"`, preserving the handoff and JSON return contract (#744).
- The OMP implementer autoloads `work-item`; under `omp-seat` its tool calls use seat-mods' verifier guard and its changes remain staged for the coordinator.
