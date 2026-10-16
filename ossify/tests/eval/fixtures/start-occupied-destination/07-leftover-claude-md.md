---
scenario_id: 07-leftover-claude-md
expected_outcome: write-all
expected_reason: A leftover CLAUDE.md is not a destination (occupied-destinations §1a): /start never writes it, no keep-or-move question is asked about it, and it stays byte-for-byte as it is. Past both §3 gates the ceremony runs, ossify writes AGENTS.md, and the §13 hand-off names the leftover CLAUDE.md, says Claude Code loads it in preference to AGENTS.md until it is migrated, and routes the operator to ossify:doctor's interop repair.
---
The operator typed `/start` in the AI workspace `/home/dev/projects/wickham-ai`.
It holds a `CLAUDE.md` (2,104 B) written by an older workspace-init, and no
`AGENTS.md`. There is no `.ossify/` state, no `MASTER-SPEC.md`, no
`EXECUTIVE-SUMMARY.md`, no `.claude/` directory and no memory bank.

`CLAUDE.md` is not one of `/start`'s destinations: ossify authors `AGENTS.md`,
never `CLAUDE.md`. So there is no question about the file; it stays untouched.
The workspace ends the ceremony with both `CLAUDE.md` (unchanged) and ossify's
`AGENTS.md`, and the hand-off routes the operator to `ossify:doctor`, whose
interop check names the leftover file and offers the repair.

The topology declares one repo, `canonical`, at
`/home/dev/projects/wickham`; it holds only a `.git` with no commits and no
`PUBLIC_BOUNDARY.md`, so the canonical-content gate passes. The ceremony is at
§13, about to write its outputs.
