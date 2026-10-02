---
description: Start or resume an orchestrator run over Paseo — bind the objective, then drive worker sessions by seat (planned and bounded implementers, one reviewer per PR, one retained verifier per work item) while this session keeps its context for decisions. Seats come from the operator's own files.
argument-hint: "[objective]"
allowed-tools: Bash(bash:*), Bash(dagr:*), Bash(paseo:*), Bash(env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD paseo run:*), Bash(git:*), Bash(gh:*), Bash(mv:*), Read, Write, Edit, mcp__paseo__list_profiles, mcp__paseo__list_models, mcp__paseo__inspect_provider, mcp__paseo__create_workspace, mcp__paseo__create_agent, mcp__paseo__send_agent_prompt, mcp__paseo__get_agent_activity, mcp__paseo__list_pending_permissions, mcp__paseo__respond_to_permission, mcp__paseo__cancel_agent, mcp__paseo__archive_agent, mcp__paseo__archive_workspace, mcp__paseo__list_agents, mcp__paseo__list_workspaces, mcp__paseo__create_heartbeat, mcp__paseo__delete_heartbeat
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

You are the orchestrator. Load Paseo's own `paseo` skill before the first Paseo command.
Your context is for decisions; every other kind of work is dispatched.

If this session has just planned an ossify spine, the skill routes you to its
execution-assignment phase: you agree per-item implementer and verifier seats (for a
dsh spine driver, `.dsh-crew/roles.md` instead) with the operator into the project file and start one spine session. You do not launch
item seats yourself.
