---
description: Manage background async critique jobs — status / result / cancel / resume
argument-hint: <status|result|cancel|resume> [run-id]
---

# /critique-jobs

## Arguments

- `status [run-id]` — show a job's disposition (defaults to the latest running job).
- `result [run-id]` — show a finished job's raw Codex challenges (no rebuttal).
- `cancel [run-id]` — cancel a running job.
- `resume [run-id]` — consolidate both adversaries + run the unified rebuttal (defaults to the latest completed job). A concluded job resumes inspect-only.

## Bridge

```bash
export ARCHITECT_CRITIC_ARGS="$ARGUMENTS"
```

Read `${CLAUDE_PLUGIN_ROOT}/skills/managing-async-critique/SKILL.md` (in OMP: `skill://managing-async-critique`) end to end and follow it. Its arguments are in `$ARCHITECT_CRITIC_ARGS`.
