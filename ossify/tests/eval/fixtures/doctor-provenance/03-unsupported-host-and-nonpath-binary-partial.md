---
scenario_id: 03-unsupported-host-and-nonpath-binary-partial
expected_outcome: partial
expected_reason: "Loaded doctor resolves to 1.7.0, while a non-path command result cannot identify the binary and OpenCode supplies neither an ossify checkout nor the supported Claude installed authority; available facts remain visible without substitution."
---

OpenCode is running in `/home/dev/consumer`, an ordinary git worktree whose
root does not contain `ossify/.claude-plugin/plugin.json`. The user invokes the
targeted doctor provenance surface; no other doctor surface runs. No prior
ossify command or prose file was used in this conversation, and history is
complete.

`command -v oss` prints only `oss` because the shell resolves a function. It is
not an absolute filesystem path, so no executable, symlink target, plugin root,
or binary manifest has been established.

The host supplied
`/home/dev/.opencode/plugins/claude-agent-scaffolding/ossify/1.7.0/skills/doctor`
as the loaded skill base directory. Its readable owning manifest says `1.7.0`.

There is no ossify checkout in the current worktree and no Claude
`installed_plugins.json`. This release defines no OpenCode or Codex installed
reference arm.
