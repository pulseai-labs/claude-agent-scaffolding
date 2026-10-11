---
description: Run an architect-critic audit on a spec or plan
argument-hint: "[path] [--close] [--neutral] [--walk] [--model NAME] [--principles PATH]"
---

# /critique

## Arguments

- `path` (optional) — artifact path; if omitted, the skill resolves via manifest fast-path,
  filename heuristics, or `AskUserQuestion` fallback. Never globs `*.md`.
- `--close` — request close-depth audit (claude-self-audit + codex fresh-frame). Default is
  shallow (claude-only).
- `--neutral` — suppress per-challenge recommended dispositions; present challenges neutrally.
- `--walk` — walk every challenge sequentially; disables disposition triage (no auto-applied dispositions) for this invocation.
- `--model NAME` — override codex model (respects user's `~/.codex/config.toml` by default).
- `--principles PATH` — override principles.md path.

## Bridge

```bash
# Bridge $ARGUMENTS into env var so the skill can read it.
# See [[feedback_slash_command_dollar_n_bug]] — never use $1/$2 in command bodies.
export ARCHITECT_CRITIC_ARGS="$ARGUMENTS"
```

Read `${CLAUDE_PLUGIN_ROOT}/skills/critiquing-spec/SKILL.md` (in OMP: `skill://critiquing-spec`) end to end and follow it. Its arguments are in `$ARCHITECT_CRITIC_ARGS`.
