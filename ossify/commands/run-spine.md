---
description: Drive a planned ossify spine's rounds end to end (spine-branch cut, one worktree per work item, implementer dispatch in decomposition order, the round barrier)
argument-hint: "<spine-id> [--external-executor]"
allowed-tools: Bash(bash:*), Read, Write, Edit, Glob, Grep, Task, Skill, Workflow
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

**Exactly two command shapes are accepted**, and the grammar is closed:

- `/run-spine <spine-id>` — the default. The lane dispatches its own nested
  implementer per work item, unchanged.
- `/run-spine <spine-id> --external-executor` — the caller supplies the
  execution procedure instead. `skills/work-item/references/external-executor.md`
  is that mode's contract.

Anything else is a refusal, and the refusal comes **before the spine-branch cut,
before any worktree, and before any state write** — a lane that mutates first and
validates second has already changed the repository by the time it reports the
typo. Refuse a flag you do not recognise, a flag spelled differently, the flag
given twice, the flag given before the spine id, and any extra argument. Name
what you saw and the two shapes above; do not guess which one was meant, and do
not silently drop the token and run the default.

Now load the lane contract and follow it:

**Read `${CLAUDE_PLUGIN_ROOT}/skills/work-item/references/round-orchestration.md`
end to end and follow it** — with the parsed spine id, and say plainly that
you are driving the spine's rounds, not one work item. It owns the whole lane: the spine-branch
cut-and-checkout, one worktree per work item, `oss work_item_exec`, dispatching
`ossify:implementer-agent` per item, the 3-iteration cap, and the round barrier.
Returns are processed in declared decomposition order regardless of arrival order.

This is the entry point `plan-spine` hands the baton to. `plan-spine` plans and
stops; `/close <spine-id>` takes over once the final round clears its barrier.

**Not this command:** one work item from a known handoff path is `/work-item
<handoff-path>`. The work-item gate, the cumulative demo, the harvest and the
retro are `/close`.

With no spine id, refuse rather than guess — `/run-spine <spine-id>` needs the
id (`r1.s2`); the lane derives the release, the slug, and every path from it.
