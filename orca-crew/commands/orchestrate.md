---
description: Start or resume an orchestrator Run over Orca — bind the objective, then drive GLM worker sessions by role (claude-glm / claude-glm-flash implementers, one flash reviewer per PR, one retained verifier per work item) while this session keeps its context for decisions.
argument-hint: "[objective]"
allowed-tools: Bash(bash:*), Bash(orca:*), Bash(git:*), Bash(gh:*), Read, Write
---

Parse the objective from `$ARGUMENTS` via the env-var bridge (no positional `$1`/`$2`):

```bash
ARGS_FROM_CLAUDE="$ARGUMENTS" bash -c '
  set -u
  ARGS="${ARGS_FROM_CLAUDE:-}"
  echo "orchestrate: OBJECTIVE=${ARGS:-<none>}"
'
```

**Read `${CLAUDE_PLUGIN_ROOT}/skills/orchestrate/SKILL.md` end to end and follow it**,
with the objective above. Resolution lives in the skill, not here — Codex publishes
`./skills/` and never loads this file. With no objective, the skill asks for one; do not
guess.

You are the orchestrator. Load `orca skills get orchestration` before the first Orca
command. Your context is for decisions; every other kind of work is dispatched.

If this session has just planned an ossify spine, the skill routes you to its
execution-assignment phase: you ratify per-item implementer and verifier profiles with
the operator and start one spine session. You do not launch item terminals yourself.
