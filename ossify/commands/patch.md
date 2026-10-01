---
description: Ship a defect in shipped behaviour, or a small can't-fake request from another project, as a versioned patch off the default branch — reproduce-first or AC-first by kind, then PR and tag. Refuses new scope (intake queue) and large requests (/plan-spine).
argument-hint: "<issue number(s), or a described defect>"
allowed-tools: Bash(bash:*), Bash(git:*), Bash(gh:*), Bash(oss:*), Read, Write, Edit, Glob, Grep, Skill
---

Invoke the patch skill with: $ARGUMENTS

**Read `${CLAUDE_PLUGIN_ROOT}/skills/patch/SKILL.md` end to end and follow it** —
with the parsed argument, if any. The skill owns the whole lane: whether the work
is a patch at all, the ledger and touch-surface read, the fix by kind, the branch
and version, the PR, and the tag.

A running spine is never reopened for this work, and a large request is a spine,
not a patch — `/ossify:plan-spine` owns that.
