---
scenario_id: 06-marker-not-first-line-control
expected_outcome: stop-before-write
expected_reason: The marker is not the first line, so occupied-destinations §1a does not apply: the operator added `# Team notes` and two more lines above it, and the marker now sits on line 4. AGENTS.md is therefore an occupied destination and the skill names it with its path and size and asks the operator to keep it or move it aside before `oss init`. Nothing is written until the operator answers.
---
The operator typed `/start` in the AI workspace `/home/dev/projects/ferrite-ai`,
which workspace-init 0.10.0 created. Since then the operator opened
`AGENTS.md` (1,690 B) and put three lines at the top, above workspace-init's own
text. From line 1:

```markdown
# Team notes

Spike the connector next week.
<!-- workspace-init stub: ossify:start replaces this file -->
```

The marker is now the fourth line, not the first. The workspace also holds
`.workspace/pairing.json`. There is no `.ossify/` state, no `MASTER-SPEC.md`, no
`EXECUTIVE-SUMMARY.md`, no `.claude/` directory and no memory bank.

The topology declares one repo, `canonical`, at
`/home/dev/projects/ferrite`; it holds only a `.git` with no commits and no
`PUBLIC_BOUNDARY.md`, so the canonical-content gate passes. The ceremony is at
§3, past both gates, about to run `oss init "ferrite"`.
