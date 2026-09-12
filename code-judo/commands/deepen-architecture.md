---
description: Scan the codebase for deepening opportunities — shallow modules that should become deep ones — present them as a visual HTML report opened in the browser, then grill through whichever candidate you pick.
argument-hint: "[module, subsystem, or pain point to focus on]"
allowed-tools: Bash(bash:*), Bash(git:*), Read, Write, Edit, Glob, Grep, Task, Skill
disable-model-invocation: true
---

**Read `${CLAUDE_PLUGIN_ROOT}/skills/deepen-architecture/SKILL.md` end to end and follow
it** — scoped to the direction below if one was given, otherwise inferring hot spots from
commit history. `references/html-report.md` carries the report format;
`references/grilling.md` carries the grilling agenda and its resolution order.

Do **not** propose interfaces in the report. Write it, open it, then ask which candidate to
explore.

Direction to focus on (may be empty — infer hot spots from history): $ARGUMENTS
