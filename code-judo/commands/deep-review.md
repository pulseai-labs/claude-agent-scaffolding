---
description: Strict maintainability review of a branch or diff — abstraction quality, giant files, spaghetti growth, boundary leaks — pushed toward restructurings that delete complexity rather than rearrange it. One report, one disposition pass, no loop.
argument-hint: "[base-ref]"
allowed-tools: Bash(bash:*), Bash(git:*), Read, Glob, Grep, Task
disable-model-invocation: true
---

**Read `${CLAUDE_PLUGIN_ROOT}/skills/deep-review/SKILL.md` end to end and follow it**, passing
the base below if one was given. **Base resolution lives in the skill, not here** — Codex
publishes `./skills/` and never loads this file, so a resolver written here would exist on one
surface and not the other, which is how the two came to disagree in the first place.
`references/rubric.md` carries the standards, questions, flags, and remedies;
`references/disposition.md` carries the approval bar and the stopping rule.

This is a **quality** review, not a correctness or security review. It produces one report
and one disposition pass, and never re-reviews its own fixes.

Base ref to review against (may be empty — resolve per SKILL.md §1): $ARGUMENTS
