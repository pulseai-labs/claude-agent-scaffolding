---
description: Show the merged principles set (shipped + user + project + memory-bank)
argument-hint: [--source all|shipped|user|project]
---

# /principles-list

## Arguments

- `--source all|shipped|user|project` — filter to a single source (default `all`).

## Bridge

```bash
export ARCHITECT_CRITIC_ARGS="$ARGUMENTS"
```

Read `${CLAUDE_PLUGIN_ROOT}/skills/listing-principles/SKILL.md` (in OMP: `skill://listing-principles`) end to end and follow it. Its arguments are in `$ARCHITECT_CRITIC_ARGS`.
