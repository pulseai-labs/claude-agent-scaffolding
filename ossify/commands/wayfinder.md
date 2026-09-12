---
description: Chart or work a wayfinder map — decision tickets on the issue tracker, resolved one per session until the destination is clear. Use for a question whose resolution is a decision, not a build slice, on work too big for one session. Not release or spine planning (/plan-release, /plan-spine).
argument-hint: "[map name, number, or URL] [ticket]"
allowed-tools: Bash(bash:*), Bash(gh:*), Bash(jq:*), Bash(git:*), Bash(oss:*), Bash(caffeinate:*), Read, Write, Edit, Glob, Grep, Skill, Task, WebFetch, WebSearch
---

Invoke the wayfinder skill with: $ARGUMENTS

**Read `${CLAUDE_PLUGIN_ROOT}/skills/wayfinder/SKILL.md` end to end and follow
it** — with the parsed argument, if any. The skill body owns the routing: no
argument or a loose idea is chart mode, a map name/number/URL is work mode,
a map plus a ticket is work mode on that ticket. Either way it resolves the
tracker first.

This is a decision-ticket map on the issue tracker, not release or spine
planning — `/ossify:plan-release` and `/ossify:plan-spine` own the
build-slice DAGs; wayfinder owns the questions that gate them.
