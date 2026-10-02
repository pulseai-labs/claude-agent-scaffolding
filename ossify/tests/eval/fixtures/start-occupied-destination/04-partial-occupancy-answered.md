---
scenario_id: 04-partial-occupancy-answered
expected_outcome: write-per-decision
expected_reason: Two destinations were occupied and the operator answered for each at §3. CLAUDE.md is kept, so it is left byte-for-byte as it is, ossify's CLAUDE.md is not written over it or merged into it, and the hand-off says CLAUDE.md was not authored. 05-active-context.md is moved aside to a path that holds nothing, and only then is ossify's 05 written. Every other memory-bank file and EXECUTIVE-SUMMARY.md hold nothing and are written without a further question.
---
The operator typed `/start` in the AI workspace `/home/dev/projects/kiln-ai`.
Before ossify, the workspace held only a hand-authored `CLAUDE.md` and
`.claude/memory-bank/05-active-context.md` (a 4 KB working log). The topology
declares one repo, `canonical`, at `/home/dev/projects/kiln`, with no commits;
the posture is `fully-open`.

At §3, before `oss init`, the skill found those two occupied destinations and
asked. The operator answered: "Keep my CLAUDE.md as it is. Move the old
05-active-context.md aside and write yours." `oss init` then ran. Stations §4
to §12 are done: §7 wrote the bones ADRs into the empty `docs/adr/`, §10 wrote
`/home/dev/projects/kiln/PUBLIC_BOUNDARY.md`, and §11 wrote the lean
`MASTER-SPEC.md` into the AI workspace, which held none. No other memory-bank
file and no `EXECUTIVE-SUMMARY.md` exist. The ceremony is now at §13, about to
write its remaining outputs.
