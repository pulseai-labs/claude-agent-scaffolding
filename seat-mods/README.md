# seat-mods

Role guards for worker seats, as a Claude Code mod. Requires Claude Code 2.1.287 or later.

An orchestrator spawns a worker seat (an implementer, a verifier or a reviewer) and sets one
environment variable on that spawn. The seat's tool calls then meet its role's rails. Without the
variable the mod does nothing, so the orchestrator itself, and any session you start, keeps every
access you have.

## The contract

Two environment variables, both set **per spawn**:

| Variable | Value | Effect |
|---|---|---|
| `SEAT_MODS_ROLE` | unset or empty | Inert. Every hook passes the call on unchanged. No status line entry. |
| | `implementer`, `verifier`, `reviewer` | That role's guards are on. The status line shows `seat: <role>`. |
| | anything else | Fail closed. Every tool call is denied with a message that names the bad value and the valid roles. Respawn the seat with a valid value. |
| `SEAT_MODS_ALLOW` | `:`-separated absolute directories | Extra directories the seat may write to: its report directory and its scratch directory. Relative entries and `/` are ignored. Unset, only the worktree is writable. |

`herdr-crew` 0.2.2 and later sets both on implementer, verifier and reviewer spawns
(`herdr tab create --env …`), and never on coordinator seats.

**Never set either variable in `~/.claude/settings.json`'s `env` block, in a shell profile, or in a
machine-file `command:` line.** Each of those reaches the orchestrator, which must never be guarded.

## The guards

Each is a `tool.call` deny on Bash, Edit or Write.

| Guard | implementer | verifier | reviewer |
|---|---|---|---|
| `git merge`, `gh pr merge` | deny | deny | deny |
| Force-push (`--force`, `-f`, `--force-with-lease`, a `+` refspec), `git branch -D`, `git push --delete` / `-d` / `:branch` | deny | deny | deny |
| `--no-verify` on any git command (and `git commit -n`) | deny | deny | deny |
| A commit message with `Co-Authored-By:` or `🤖 Generated with` — on the command line, in a heredoc, or in the `-F` / `--file` message file | deny | deny | deny |
| Edit or Write outside the worktree and outside every `SEAT_MODS_ALLOW` directory | deny | deny | deny |
| `git commit`, `git push`, `gh pr create` | allow | deny | deny |
| Edit or Write inside the worktree | allow | allow | deny |
| Edit or Write inside a `SEAT_MODS_ALLOW` directory | allow | allow | allow |

The worktree is the git top level of the session's working directory. Paths are compared after
the file system resolves them, so `..` and symbolic links land where they really point; a file that
does not exist yet is placed by its folder.

A deny reads `seat-mods (<role>): <rule> — this seat may not <action>; report it instead.`

## Limits

- **The rails stop mistakes, not an adversary.** Bash matching is whitespace tokens split on `;`,
  `&&`, `||`, `|` and newlines. An obfuscated command (`g""it push`) passes, and a quoted word such as
  `echo git merge` is read as a git merge.
- **File writes made through Bash** (`cat >`, `sed -i`, `mv`) are not path-checked. Only the Edit
  and Write tools are.
- **The guards fail open.** If the module does not load, or a hook throws, Claude Code skips it and
  the seat runs unguarded. The sign is a missing `seat: <role>` in the status line; the debug log
  (`claude --debug`) names the plugin and the reason. Claude Code also holds installed plugins'
  hooks modules behind a rollout flag (`tengu_plugin_hooks_modules`).
- Claude Code only. Codex, OpenCode and Devin have no mod runtime.

## Tests

```bash
bash seat-mods/run-tests.sh   # claude plugin validate + claude plugin test
```
