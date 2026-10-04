# Changelog

All notable changes to the `seat-mods` plugin.

## 0.2.1 — 2026-10-05

Docs only — no code change.

- The rollout guidance now names `herdr-crew` 0.2.7, which marks the two free roles
  (`orchestrator` and `coordinator`) at launch; `paseo-crew`, `orca-crew` and `dsh-crew`
  do not set `SEAT_MODS_ROLE` yet.
- New README section "Without an orchestrator plugin": with none installed you are the
  launcher — worked aliases and functions for the unguarded and guarded roles, and the
  note that a launcher writing `orchestrator` or `coordinator` needs seat-mods 0.2.0 or
  later.
- The README's `claude-review()` example now sets `SEAT_MODS_ALLOW`, because a reviewer
  may write only in those directories, and the `SEAT_MODS_ALLOW` table row says so for
  the reviewer profile.

## 0.2.0 — 2026-10-04

- **BREAKING** for unmarked sessions: `SEAT_MODS_ROLE` unset or empty no longer disables the mod —
  the session is guarded as an `implementer` by default, so a forgotten launcher export fails
  closed, and the status line reads `seat: implementer (default: SEAT_MODS_ROLE unset or empty)`.
  Two explicit unguarded roles are added: `orchestrator` (the top orchestrator, or any session
  started to drive work) and `coordinator` (spine, close, work-PR and doctor sessions, lane
  drivers); `implementer`, `verifier` and `reviewer` are unchanged, and any other value still
  denies every tool call. Do not install until every launcher you use — and your own interactive
  sessions — marks its free sessions: a later `herdr-crew` release will; `paseo-crew`,
  `orca-crew` and `dsh-crew` do not set `SEAT_MODS_ROLE` yet; set `SEAT_MODS_ROLE=orchestrator`
  yourself, e.g. in your launch alias. Until then a coordinator or a bare `claude` session starts
  guarded as an implementer and cannot merge. A default-guarded session writes only inside the
  worktree — outside a git repository, its working directory — and the `SEAT_MODS_ALLOW`
  directories, so Claude Code's own writes outside them (memory files, plan files) are denied;
  a default-guarded session is a worker, and an operator session marks itself `orchestrator`.

## 0.1.0 — 2026-10-03

- First release. `tool.call` guards per role (implementer, verifier, reviewer), turned on by
  `SEAT_MODS_ROLE` and inert without it; any other value denies every tool call. Writes are checked
  against the worktree and the `SEAT_MODS_ALLOW` directories. A commit message file given by `-F` is
  read for AI trailers. Quoted strings and heredoc bodies are text, not commands, and only a
  segment's command word decides what it runs. The Bash rails are a best-effort match on common
  spellings, not a shell parser; a dangling symbolic link is never written through. A Write into new
  folders is placed by its nearest existing folder.

Claude Code only (2.1.287+). Not on Codex, Devin or in the OpenCode bundle.
