---
description: Start or resume an orchestrator run over herdr — bind the objective, then drive worker sessions by seat (planned and bounded implementers, one reviewer per PR, one retained verifier per work item) while this session keeps its context for decisions. Seats come from the operator's own files.
argument-hint: "[objective]"
allowed-tools: Bash(bash:*), Bash(herdr:*), Bash(git:*), Bash(gh:*), Read, Write
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

You are the orchestrator. Load `herdr --skill` before the first herdr command. Your
context is for decisions; every other kind of work is dispatched.

If this session has just planned an ossify spine, the skill routes you to its
execution-assignment phase: you agree per-item implementer and verifier seats with
the operator into the project file and start one spine session. You do not launch
item tabs and panes yourself.
