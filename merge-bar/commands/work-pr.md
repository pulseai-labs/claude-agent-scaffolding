---
description: Drive a pull request to mergeable against the merge bar in its own body — blocking findings fixed in one push per round, the rest answered or recorded as known limits, a stop at round 3 when fixes generate the findings, merge on explicit ack, or under a standing order in the autopilot policy that grants merge authority.
argument-hint: "<PR number or URL> [--repo-root DIR]"
allowed-tools: Bash(bash:*), Bash(git:*), Bash(gh:*), Read, Write, Edit, Glob, Grep
---

Read `${CLAUDE_PLUGIN_ROOT}/skills/working-a-pr/SKILL.md` (in OMP: `skill://working-a-pr`) end to end and follow it.

The PR to work, and any flags: $ARGUMENTS
