---
scenario_id: 04-expected-unavailable-active-disagreement
expected_outcome: partial
expected_reason: "Binary 1.6.0 and loaded doctor 1.7.0 resolve and disagree while no checkout exists and the installed record holds zero ossify candidates, so expected is unavailable and the surface is partial with the active-role warning preserved; the prior verb is named as exposed to that disagreement with no role blamed, prose comparison coverage is incomplete because no expected root exists, and nothing is downgraded or guessed."
---

Claude Code is running in `/home/dev/consumer`, an ordinary git worktree whose
root does not contain `ossify/.claude-plugin/plugin.json`. The user invokes
`/ossify:doctor provenance`; no other doctor surface runs. Conversation history
is complete.

`command -v oss` prints the executable absolute path
`/home/dev/.claude/plugins/cache/claude-agent-scaffolding/ossify/1.6.0/bin/oss`.
It is not a symlink; its parent layout is `bin/oss` under a readable plugin
root, and that root's `.claude-plugin/plugin.json` says version `1.6.0`.

The host supplied the current skill base directory as
`/home/dev/.claude/plugins/cache/claude-agent-scaffolding/ossify/1.7.0/skills/doctor`.
Its `SKILL.md` was loaded from that directory, and the owning plugin manifest
says `1.7.0`.

`~/.claude/plugins/installed_plugins.json` is readable and valid JSON but
contains no `ossify@claude-agent-scaffolding` record — zero candidates.

Before this doctor invocation, actual tool-call history shows exactly this
ossify use: Bash invoked `oss state_path` once, and Read loaded the 1.6.0
root's `commands/work-pr.md`, whose body is `review policy: one pass`. No
other ossify verb or product prose file was used before doctor.
