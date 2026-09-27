---
description: Open a pull request with the six-field body and a merge bar fixed at open time — proposes a split when the claim or scope is too wide.
argument-hint: "[base-branch]"
allowed-tools: Bash(git:*), Bash(gh:*), Read, Write, Glob, Grep
---

**Read `${CLAUDE_PLUGIN_ROOT}/skills/opening-a-pr/SKILL.md` end to end and follow it**, with
`${CLAUDE_PLUGIN_ROOT}/skills/opening-a-pr/references/pr-body.md` as the template. Base
resolution lives in the skill, not here — Codex publishes `./skills/` and never loads this file.

Base branch (may be empty — resolve per SKILL.md §2): $ARGUMENTS
