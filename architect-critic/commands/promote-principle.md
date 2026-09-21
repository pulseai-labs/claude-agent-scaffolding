---
description: Promote a principle to user-global or project-scoped principles.md
argument-hint: "\"<text>\" [--scope user|project]"
---

# /promote-principle

Invoke the **promoting-principle** skill. The skill body validates uniqueness, appends to
the target principles.md with source tag + timestamp, and records the promotion in
state.json. This slash command is a thin wrapper.

## Arguments

- `"<text>"` (required) — principle text, in quotes.
- `--scope user|project` — target file scope (default `user`).

## Bridge

```bash
export ARCHITECT_CRITIC_ARGS="$ARGUMENTS"
```

## Invoke

Now invoke the skill via:

```
Skill(architect-critic:promoting-principle)
```

The qualified `<plugin>:<skill>` form is required — pass the arguments above via `$ARCHITECT_CRITIC_ARGS`.
