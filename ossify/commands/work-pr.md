---
description: Drive a pull request to merge — merge-bar's working-a-pr when that plugin is installed, else ossify's bundled review-fix-merge loop; every finding dispositioned, merge only on explicit ack
argument-hint: "<PR number or URL> [--repo-root DIR]"
allowed-tools: Bash(bash:*), Bash(git:*), Bash(gh:*), Read, Write, Edit, Glob, Grep, Skill
---

The PR to work, and any flags: $ARGUMENTS

Read `${CLAUDE_PLUGIN_ROOT}/skills/work-pr/SKILL.md` (in OMP: `skill://work-pr`) end to end and follow it.
