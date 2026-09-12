---
scenario_id: 01-stale-active-versions-targeted-prior-use
expected_outcome: warn
expected_reason: "Bare doctor includes provenance; binary and loaded doctor are 1.6.0 while the unique readable installed reference is 1.7.0; prior state_path exposure is named and only the two previously loaded prose files are compared."
---

Claude Code is running in `/home/dev/project`, an ordinary git worktree whose
root does not contain `ossify/.claude-plugin/plugin.json`. The user invokes bare
`/ossify:doctor`. Every underlying input for state, spec, rule, interop, and
budget inspection is present and healthy; those five surfaces can complete
without a fail, warning, or skip.

`command -v oss` prints the executable absolute path
`/home/dev/.claude/plugins/cache/claude-agent-scaffolding/ossify/1.6.0/bin/oss`.
It is not a symlink. Its parent layout is `bin/oss` under a readable plugin root,
and that root's `.claude-plugin/plugin.json` says version `1.6.0`.

The host supplied the current skill base directory as
`/home/dev/.claude/plugins/cache/claude-agent-scaffolding/ossify/1.6.0/skills/doctor`.
Its `SKILL.md` was loaded from that directory, and the owning plugin manifest
says `1.6.0`.

`~/.claude/plugins/installed_plugins.json` contains exactly one
`ossify@claude-agent-scaffolding` record, with `scope: user` and no
`projectPath`. It says version `1.7.0`, points to
`/home/dev/.claude/plugins/cache/claude-agent-scaffolding/ossify/1.7.0`, and the
readable manifest at that root also says `1.7.0`.

Before this doctor invocation, actual tool-call history shows exactly this
ossify use:

- Bash invoked `oss state_path` once.
- Read loaded the 1.6.0 root's `commands/work-pr.md`; its body is `review policy: one pass`.
- Read loaded the 1.6.0 root's `skills/close/SKILL.md`; its body is `close contract: gates remain`.

Under the 1.7.0 expected root, `commands/work-pr.md` says
`review policy: two rounds` and `skills/close/SKILL.md` says
`close contract: gates remain`. No other ossify verb or product prose file was
used before doctor. The conversation has not been compacted.
