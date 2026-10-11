---
description: Show recent architect-critic runs
argument-hint: [--limit N]
allowed-tools: Read
---

# /critique-list

## Arguments

- `--limit N` — show most-recent N rows (default 10).

## Bridge

```bash
export ARCHITECT_CRITIC_ARGS="$ARGUMENTS"
```

Read `${CLAUDE_PLUGIN_ROOT}/skills/reviewing-critique-history/SKILL.md` (in OMP: `skill://reviewing-critique-history`) end to end and follow it. Its arguments are in `$ARCHITECT_CRITIC_ARGS`.
