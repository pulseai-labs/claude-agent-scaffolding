# Changelog

All notable changes to the `seat-mods` plugin.

## 0.3.1 — 2026-10-09

- Every Bash rail now walks the reserved head words already recognised by `rm`, so
  `if git push --force`, `! gh pr merge` and commits behind those heads meet the
  same role and AI-trailer checks as a bare command (#701). Shared parser declarations
  remain unchanged; no new shell forms are parsed.
- Heredoc input to `rm` is excluded from operands. An inside operand remains allowed,
  an outside operand remains denied, and an attached opener keeps its operand
  (`x<<EOF`) (#702 item 1).
- Add molt regression pins for herestrings and path-qualified wrappers, without
  changing molt source or version (#702 item 4). Add allowed controls in the same
  `//`, `/.` and `/..` spellings beside writable-root denial tests (#702 item 5).
- #702 items 2 and 3 and its comment-thread parser limits remain open under the
  PR #644 rule: the matcher grows only for a form that ran in practice.

## 0.3.0 — 2026-10-08

- Guarded sessions are denied an `rm` the rail recognises when operands are outside their
  writable places. Implementers,
  verifiers and the unmarked default may remove things inside their worktree and `SEAT_MODS_ALLOW`;
  reviewers may remove things only inside `SEAT_MODS_ALLOW`. Every recognised operand is checked, including
  `-`-prefixed operands after `--`. Writable roots and their ancestors are protected.
- Unresolvable operands are denied, including `rm -rf "$OLDPWD"`, variables, parameter and command
  substitutions, and `~user`. Single-quoted operands are literal; `~` and `~/...` use HOME. Globs
  are placed by their literal prefix directory, so `rm -f /tmp/tmp.*` is denied. Parent symlinks
  resolve, while a terminal symlink is removed literally unless followed by `/`.
- Relative operands use the live `$.session.cwd()` (measured on Claude Code 2.1.294, 2026-10-08;
  see README). Known limit: an earlier recognised `cd`, `pushd` or `popd` in the same Bash call makes a relative
  operand unresolvable even if the change fails. Existing live-cwd worktree detection is unchanged.
- Known limits: `rmdir`, `unlink`, `find -delete`, `git rm`, `git clean`, `xargs rm`, `bash -c '...'`, `mv` over
  a file, and other Bash writes (`cat >`, `sed -i`) remain outside the rail. This is an `rm` matcher
  for mistakes, not precise shell parsing or an adversary boundary. Free roles remain unguarded;
  Bash tool calls from subagents meet the same rail.

- Review round 1: unquoted braces, glob suffix parent traversal and globs above writable roots
  fail closed. Redirections are excluded from operands; single `&`, reserved head words and
  `builtin` are recognised; `builtin cd` and `\cd` affect same-call relative operands. Parsing or
  resolution exceptions deny the Bash call, with self-reference/depth protection for markers.
- Backticks and quoted `$(rm …)` can escape recognition; bare `$(rm …)` is checked by the parentheses splitter.
- A glob component starting with `.` and containing `*`, `?` or `[` is unresolvable and denied.
- Shell options changed in the same call (`shopt`, e.g. `extglob`, `dotglob`, `nullglob`) are not modelled beyond the `**` and dot-component denials.
- `**` in an rm glob operand is unresolvable and denies; quoted literal `**` stays literal.
- An unexecuted shell function body (`cleanup() { rm …; }`) is checked as if it runs and may deny.
- A heredoc given as rm's input (`rm -i x <<EOF`) is read as an extra operand and denied.
- A named descriptor before the command (`{log}>file rm …`) hides the rm.
- One-word runners beyond the recognised wrappers (`timeout`, `nice`, `stdbuf`, `setsid`, `xargs`) can hide `rm`.
- A double-quoted `<<`, or commands after a heredoc opener or a `#` comment on the same line, can hide commands from the rail.
- Paths changed earlier in the same call (`ln -s`, `mv`, `mkdir` before `rm`) are checked against the filesystem as it stands before the call runs.
- Glob matches are not enumerated: a matched parent symlink can lead outside writable places, as in `rm -rf <worktree>/*/node_modules`.
- `$` outside literal quoting/escaping and leading `~+`/`~-` are unresolvable, even when Bash could resolve them.
- Quoted command names such as `"cd"` are not recognised as directory changes.
- `POSIXLY_CORRECT` operand ordering and a backslash-newline inside double quotes are not modelled.

- Review round 2: the existing redirect list includes `<>`, `&>>`, fd duplication/closure and
  `<<<`; herestrings no longer open heredocs. Path-qualified wrappers are recognised, a root
  worktree contains absolute descendants, and unchecked Bash commands get a Bash-specific deny.

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
