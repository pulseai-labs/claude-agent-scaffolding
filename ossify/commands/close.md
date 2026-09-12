---
description: Run the ossify close ceremony on an id — context-routed to work item, spine, or release by the id's shape
argument-hint: "<id>"
allowed-tools: Bash(bash:*), Read, Write, Edit, Glob, Grep, Skill, Workflow
---

Parse args from `$ARGUMENTS` via the env-var bridge (no positional `$1`/`$2`/`$N`),
then load the `ossify:close` skill body, which owns the close ceremony.

```bash
ARGS_FROM_CLAUDE="$ARGUMENTS" bash -c '
  set -u
  ARGS="${ARGS_FROM_CLAUDE:-}"
  echo "close: ARGS=${ARGS:-<none>}"
'
```

Now load the skill body and follow it:

**Read `${CLAUDE_PLUGIN_ROOT}/skills/close/SKILL.md` end to end and follow it** —
with the parsed id. The skill body owns the routing (the id's shape decides the
scope; it is never asked) → the common pre-flight (a resolvable topology
declaration, a green
`oss doctor`, absolute paths and no `cd`) → the work-item layer (the four-layer
gate, the staging proof, the commit in the worktree, the merge into the spine
branch) → the spine layer → the release layer, and shells out to `oss` for all
state.

With no id, the skill refuses and lists what is open rather than guessing a scope.
