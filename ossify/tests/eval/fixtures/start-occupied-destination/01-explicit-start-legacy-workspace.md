---
scenario_id: 01-explicit-start-legacy-workspace
expected_outcome: stop-before-write
expected_reason: The user typed /start explicitly, so §2's guard does not apply and the ceremony runs. Past both §3 gates and before oss init, every destination is checked. docs/MASTER-SPEC.md, CLAUDE.md and the twelve memory-bank files exist, so the skill names each one with its path and size and asks the operator, per file, to keep it or move it aside; keeping MASTER-SPEC.md is flagged as leaving spec-core no place for its product. Nothing is written and oss init does not run until the operator answers. tech-debt.md, WORKFLOW.md, EXECUTIVE-SUMMARY.md, the private inventory and PUBLIC_BOUNDARY.md hold nothing and need no question. No automatic move, merge or migration.
---
The operator typed `/start` explicitly in the AI workspace of `pulse-trader`.
The project was set up earlier by scaffold-onboard, before any code: the AI
workspace `/home/dev/projects/pulse-trader-ai` holds a 10-phase (legacy)
`docs/MASTER-SPEC.md` (49,893 B) — the path `oss spec_path` resolves to — a
hand-authored `CLAUDE.md` (6,712 B), and
`.claude/memory-bank/` with these twelve files: `index.md`, `00-project-brief.md`
to `10-decisions-log.md`. Among them, `05-active-context.md` is 101,604 B,
`09-known-issues.md` 21,051 B and `10-decisions-log.md` 28,356 B. There is no
`tech-debt.md`, no `WORKFLOW.md` and no `EXECUTIVE-SUMMARY.md`. No `.ossify/`
state exists.

The topology resolves and declares one repo, `canonical`, at
`/home/dev/projects/pulse-trader`; it holds only a `.git` with no commits and no
`PUBLIC_BOUNDARY.md`, so the canonical-content gate passes. The ceremony is in
§3, past both gates, about to run `oss init "pulse-trader"`.
