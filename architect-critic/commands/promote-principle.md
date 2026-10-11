---
description: Promote a principle to user-global or project-scoped principles.md
argument-hint: "\"<text>\" [--scope user|project]"
allowed-tools: Read
---

# /promote-principle

## Arguments

- `"<text>"` (required) — principle text, in quotes.
- `--scope user|project` — target file scope (default `user`).

## Bridge

```bash
export ARCHITECT_CRITIC_ARGS="$ARGUMENTS"
```

Read `${CLAUDE_PLUGIN_ROOT}/skills/promoting-principle/SKILL.md` (in OMP: `skill://promoting-principle`) end to end and follow it. Its arguments are in `$ARCHITECT_CRITIC_ARGS`.
