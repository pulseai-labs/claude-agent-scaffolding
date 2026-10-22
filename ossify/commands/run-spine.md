---
description: Drive a planned ossify spine's rounds end to end (spine-branch cut, one worktree per work item, implementer dispatch in decomposition order, the round barrier)
argument-hint: "<spine-id> [--external-executor [--detach]]"
allowed-tools: Bash(bash:*), Read, Write, Edit, Glob, Grep, Task, Skill
---

Parse args from `$ARGUMENTS` via the env-var bridge (no positional `$1`/`$2`/`$N`),
then run the execution lane, whose contract you load below.

```bash
ARGS_FROM_CLAUDE="$ARGUMENTS" bash -c '
  set -u
  ARGS="${ARGS_FROM_CLAUDE:-}"
  echo "run-spine: ARGS=${ARGS:-<none>}"
'
```

Read `${CLAUDE_PLUGIN_ROOT}/skills/run-spine/SKILL.md` (in OMP: `skill://run-spine`) end to end and follow it.
