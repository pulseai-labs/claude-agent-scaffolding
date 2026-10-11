---
description: Interrogate the user's plan or design one question at a time. Stress-test assumptions and surface unmade decisions.
argument-hint: "[plan or design to grill] [--neutral] [--walk]"
allowed-tools: Read
---

The user invoked `/grill-me`. Read `${CLAUDE_PLUGIN_ROOT}/skills/grill-me/SKILL.md` (in OMP: `skill://grill-me`) end to end and follow it.

Topic to grill (may be empty — fall back to current conversation context): $ARGUMENTS
