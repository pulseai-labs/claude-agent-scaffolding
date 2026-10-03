# Changelog

All notable changes to the `seat-mods` plugin.

## 0.1.0 — 2026-10-03

- First release. `tool.call` guards per role (implementer, verifier, reviewer), turned on by
  `SEAT_MODS_ROLE` and inert without it; any other value denies every tool call. Writes are checked
  against the worktree and the `SEAT_MODS_ALLOW` directories. A commit message file given by `-F` is
  read for AI trailers. Quoted strings and heredoc bodies are text, not commands, and only a
  segment's command word decides what it runs. The Bash rails are a best-effort match on common
  spellings, not a shell parser; a dangling symbolic link is never written through. A Write into new
  folders is placed by its nearest existing folder.

Claude Code only (2.1.287+). Not on Codex, Devin or in the OpenCode bundle.
