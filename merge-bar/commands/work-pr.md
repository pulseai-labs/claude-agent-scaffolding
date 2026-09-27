---
description: Drive a pull request to mergeable against the merge bar in its own body — blocking findings fixed in one push per round, the rest answered or recorded as known limits, a stop at round 3 when fixes generate the findings, merge only on explicit ack.
argument-hint: "<PR number or URL> [--repo-root DIR]"
allowed-tools: Bash(bash:*), Bash(git:*), Bash(gh:*), Read, Write, Edit, Glob, Grep
---

**Read `${CLAUDE_PLUGIN_ROOT}/skills/working-a-pr/SKILL.md` end to end and follow it.** It owns
the whole lane: preflight, both finding signals, the set-level pass, the dispositions against
the PR's merge bar, rounds and the round-3 stop, the terminus ask, and the ledger after merge.

The PR to work, and any flags: $ARGUMENTS
