---
scenario_id: 02-checkout-clean-no-impact
expected_outcome: ok
expected_reason: "Targeted provenance selects the current ossify checkout, all three roles resolve to 1.7.0, and prior use does not trigger an impact scan without a version mismatch."
---

Claude Code is running at `/src/claude-agent-scaffolding`, the root of an
ordinary git worktree. `/src/claude-agent-scaffolding/ossify/.claude-plugin/plugin.json`
exists and says version `1.7.0`. The user invokes `/ossify:doctor provenance`;
no other doctor surface runs in this targeted invocation.

`command -v oss` prints the executable, non-symlink absolute path
`/src/claude-agent-scaffolding/ossify/bin/oss`; the plugin manifest above its
`bin/` directory says `1.7.0`.

The host supplied `/src/claude-agent-scaffolding/ossify/skills/doctor` as the
current skill base directory, and the owning plugin manifest says `1.7.0`.

A readable Claude installed record also exists with `scope: user` and no
`projectPath`, but says version `1.6.0` and points at a readable 1.6.0 cache
root whose manifest also says `1.6.0`. Before this doctor invocation, actual tool calls invoked `oss state_path`
and Read the checkout root's `commands/work-pr.md`. Conversation history is
complete.
