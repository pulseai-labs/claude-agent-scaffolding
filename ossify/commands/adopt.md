---
description: Adopt an existing project into ossify — for a codebase that already has code, tests, history, and ADRs — five fail-closed gates, six conversions, Release 0 closed retroactively. Use when onboarding a project that already shipped; /ossify:start refuses it.
argument-hint: "[project-name]"
allowed-tools: Bash(bash:*), Read, Write, Edit, Glob, Grep, Skill
---

Parse args from `$ARGUMENTS` via the env-var bridge (no positional `$1`/`$2`/`$N`),
then load the adoption ceremony, whose contract you load below.

```bash
ARGS_FROM_CLAUDE="$ARGUMENTS" bash -c '
  set -u
  ARGS="${ARGS_FROM_CLAUDE:-}"
  echo "adopt: ARGS=${ARGS:-<none>}"
'
```

Now load the skill body and follow it:

**Read `${CLAUDE_PLUGIN_ROOT}/skills/adopt/SKILL.md` end to end and follow it** —
with the parsed project name. The skill body owns the whole ceremony: the five
pre-flight gates, the six conversions (C1-C6), reconcile-only outputs, and the
adoption record. Every gate refuses fail-closed, and nothing in the legacy
stack's files is ever written.

This is the entry point for the project that already has code — where
`/ossify:start` refuses on its canonical-content gate; its refusal names this
command. The command registers on Claude Code only — no ossify command
registers on OpenCode at all, and #131 tracks that gap for every one of them —
while the skill body itself reaches OpenCode by path as the native `adopt`
skill.
