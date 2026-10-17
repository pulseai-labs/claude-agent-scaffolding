---
description: Start or resume an orchestrator run over the project file's declared layer, herdr — 0.3.0 ships that layer only, and the Orca layer ships in crew 0.4.0. Bind the objective, then drive worker sessions by seat (planned and bounded implementers, one reviewer per PR, one retained verifier per work item) while this session keeps its context for decisions. Seats come from the operator's own files.
argument-hint: "[objective]"
allowed-tools: Bash(bash:*), Bash(dagr:*), Bash(herdr:*), Bash(git:*), Bash(gh:*), Bash(mv:*), Read, Write, Edit
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

You are the orchestrator. Load the layer's own guide before its first command. Your
context is for decisions; every other kind of work is dispatched.

If this session has just planned an ossify spine, the skill routes you to its
execution-assignment phase: you agree per-item implementer and verifier seats with the operator into the project file and start one spine session — marked `coordinator` before its command (the layer's `Seat marking`). You do not launch
item tabs and panes yourself.
