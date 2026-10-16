---
scenario_id: 05-workspace-init-stub-replaced
expected_outcome: write-all
expected_reason: The workspace-init stub is not an occupied destination (occupied-destinations §1a): its first line is the marker, so it counts as unoccupied and no question is asked. Past both §3 gates, ossify's AGENTS.md is written over it at §13 with no keep-or-move question, and the §13 hand-off says the workspace-init stub was replaced — and that its `## Git policy` and `## AI-trace filter` sections were carried across verbatim, since the stub is where workspace-init recorded this workspace's network-ops default-deny and its trace-filter notice, and ossify regenerates neither. Every other destination holds nothing.
---
The operator typed `/start` in the AI workspace `/home/dev/projects/ferrite-ai`,
which workspace-init 0.10.0 just created. It holds `.workspace/pairing.json` and
an `AGENTS.md` (1,412 B) whose first line is exactly
`<!-- workspace-init stub: ossify:start replaces this file -->`, and nothing
else: no `.ossify/` state, no `MASTER-SPEC.md`, no `EXECUTIVE-SUMMARY.md`, no
`.claude/` directory, no memory bank.

The stub is workspace-init's temporary file: `/ossify:start` replaces the whole
file with project-specific guidance, and the stub's own text says so. Its first
line is the marker.

The topology declares one repo, `canonical`, at
`/home/dev/projects/ferrite`; it holds only a `.git` with no commits and no
`PUBLIC_BOUNDARY.md`, so the canonical-content gate passes. The ceremony is at
§13, about to write its outputs.
