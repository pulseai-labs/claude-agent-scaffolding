# seat-mods

Role guards for worker seats, as a Claude Code mod. Requires Claude Code 2.1.287 or later.

An orchestrator spawns a worker seat (an implementer, a verifier or a reviewer) and sets one
environment variable on that spawn. The seat's tool calls then meet its role's rails: Edit and
Write are placed by the file system, and Bash calls are matched against the common spellings of
each rule — a best-effort catch for mistakes, not a shell parser. **The default is guarded:** a
session with `SEAT_MODS_ROLE` unset or empty runs under the implementer rails, so a forgotten
export fails closed, and its status line reads
`seat: implementer (default: SEAT_MODS_ROLE unset or empty)`.
A session that is not a worker marks itself explicitly: `SEAT_MODS_ROLE=orchestrator` for the top
orchestrator (or any session you start to drive work) and `SEAT_MODS_ROLE=coordinator` for spine,
close, work-PR and doctor sessions and lane drivers; both are unguarded.

**Rollout: do not install 0.2.0 until every launcher you use — and your own interactive sessions —
marks its free sessions.** `herdr-crew` 0.2.7 does; `paseo-crew`, `orca-crew` and
`dsh-crew` do not set `SEAT_MODS_ROLE` yet; set `SEAT_MODS_ROLE=orchestrator` yourself, e.g. in your
launch alias. Until then a coordinator or a bare `claude` session starts guarded as an implementer
and cannot merge.

## The contract

Two environment variables, both set **per spawn**:

| Variable | Value | Effect |
|---|---|---|
| `SEAT_MODS_ROLE` | unset or empty | Guarded as `implementer` by default. The status line reads `seat: implementer (default: SEAT_MODS_ROLE unset or empty)`. |
| | `implementer`, `verifier`, `reviewer` | That role's guards are on. The status line shows `seat: <role>`. |
| | `orchestrator`, `coordinator` | Unguarded: no denies, no write placement checks. The status line shows `seat: <role>`. |
| | anything else | Fail closed. Every tool call is denied with a message that names the bad value and the valid roles. Respawn the seat with a valid value. |
| `SEAT_MODS_ALLOW` | `:`-separated absolute directories | Extra directories the seat may write to: its report directory and its scratch directory. Relative entries and `/` are ignored. Unset, only the worktree is writable — and a reviewer, whose profile may write only in these directories, then writes nothing. |

`herdr-crew` 0.2.2 through 0.2.6 exports both in the pane of each implementer, verifier
and reviewer seat before its command and leaves every other pane unset; with this release an unset
pane is a guarded implementer. `herdr-crew` 0.2.7 sets `SEAT_MODS_ROLE=orchestrator` on the
top's rotation successor and `coordinator` on its coordinator seats (the spine, close and work-PR
sessions, the doctor session, the lane driver). Neither directory may contain `:`, the
list separator.

**Never set either variable in `~/.claude/settings.json`'s `env` block, in a shell profile, or in a
machine-file `command:` line.** Each of those reaches the orchestrator, which must never be guarded.

## Without an orchestrator plugin

seat-mods reads only its two variables. It does not call herdr, Paseo, Orca or any other
orchestrator, and it does not need one installed. An orchestrator plugin is one launcher that sets
the variables; with none installed, you are the launcher. Set the role on each command that starts
a session:

```bash
# Sessions you drive yourself: unguarded.
alias claude-orch='SEAT_MODS_ROLE=orchestrator claude'

# Worker sessions you start by hand: guarded by role.
claude-impl() {
  SEAT_MODS_ROLE=implementer SEAT_MODS_ALLOW="$HOME/seat-scratch/impl" claude "$@"
}
claude-verify() {
  SEAT_MODS_ROLE=verifier SEAT_MODS_ALLOW="$HOME/seat-scratch/verify" claude "$@"
}
claude-review() { SEAT_MODS_ROLE=reviewer SEAT_MODS_ALLOW="$HOME/seat-scratch/review" claude "$@"; }
```

A plain `claude` with no role is a guarded implementer — the default above. So start every
session you drive through the `orchestrator` launcher, or that session cannot merge, push a
deletion or write outside its worktree.

An alias or function that sets the variable on one command does not break the rule above. The
variable reaches only the session that command starts. An `export` in a shell profile reaches
every session, the orchestrator's included.

The role names are the contract between seat-mods and any launcher. A launcher that writes
`orchestrator` or `coordinator` needs seat-mods 0.2.0 or later: 0.1.0 reads both as invalid and
denies every tool call.

## The guards

Each is a `tool.call` deny on Bash, Edit or Write.

| Guard | implementer | verifier | reviewer |
|---|---|---|---|
| `git merge`, `gh pr merge` (also after `gh pr -R/--repo`) | deny | deny | deny |
| Force-push (`--force`, `-f`, `--force-with-lease`, `--mirror`, a `+` refspec); branch deletion (`git branch -D`, or `-d`/`--delete` with `-f`/`--force`; `git push --delete` / `-d` / `--prune` / `:branch`) | deny | deny | deny |
| `--no-verify` on any git command (and `git commit -n`) | deny | deny | deny |
| A commit message with `Co-Authored-By:` or `🤖 Generated with` — on the command line, in a heredoc, or in the `-F` / `--file` message file | deny | deny | deny |
| Edit or Write outside the worktree and outside every `SEAT_MODS_ALLOW` directory | deny | deny | deny |
| `git commit`, `git push`, `gh pr create` | allow | deny | deny |
| Edit or Write inside the worktree | allow | allow | deny |
| Edit or Write inside a `SEAT_MODS_ALLOW` directory | allow | allow | allow |

The worktree is the git top level of the session's working directory (outside a git repository,
the working directory itself). Paths are compared after the file system resolves them, so `..` and
symbolic links land where they really point; a file in folders that do not exist yet is placed by
its nearest existing folder.

A deny reads `seat-mods (<role>): <rule> — this seat may not <action>; report it instead.`

## Limits

- **The rails stop mistakes, not an adversary.** Bash matching is whitespace tokens split on `;`,
  `&&`, `||`, `|`, parentheses and newlines, after quoted strings and heredoc bodies are blanked as
  text, so a commit message may mention `git merge` or `-n`. Only the command word counts, after any
  `VAR=value` and `sudo`, `env`, `command`, `exec`, `nohup` or `time`; so `echo git merge` is not a
  merge, and neither are `xargs git push --force`, `bash -c "git push -f"`, `g""it push`, or a
  wrapper with its own options (`env -i git merge`, `sudo -u u git push -f`).
- **Unparsed shell forms pass:** a single `&` list operator, bundled short flags (`-fqu`),
  abbreviated long options (`--mir`), several heredocs on one command, a heredoc example inside a
  quoted message, value-taking git globals (`--git-dir x`) and quoted subcommands or flags
  (`git "merge"`). A trailer that opens an `-m` message, comes from `--trailer`, or follows a
  backslash-newline inside single quotes, also passes.
- **The guarded launch needs a POSIX shell in the seat's pane.** herdr-crew sets the variables
  with `export`; a pane whose shell is Nushell leaves them unset, and the session runs under the
  default implementer rails — the status line reads `seat: implementer (default: SEAT_MODS_ROLE
  unset or empty)`.
- **A trailer counts only at a line start**, as the repository's commit-msg hook reads it.
- **`git pull` is not guarded.** A pull that merges is not on the merge rail; the briefs' prose
  rule covers it.
- **`implementer` is one profile for every implementer brief.** Briefs that stage and never
  commit (ossify's work-item implementer, the direct work item) keep that rule as prose; the mod
  allows `git commit`, `git push` and `gh pr create` for every implementer.
  An AI trailer is looked for only in the commit's own command and its message file.
- **A `-F` message file is read from the session's working directory.** A relative path after a
  `cd`, or a path in a shell variable, is not found and reads as empty, so a trailer in it passes.
  The repository's commit-msg hook remains the backstop.
- **File writes made through Bash** (`cat >`, `sed -i`, `mv`) are not path-checked. Only the Edit
  and Write tools are.
- **A default-guarded session writes only inside the worktree and the `SEAT_MODS_ALLOW`
  directories** — and outside a git repository the worktree is its working directory — so Claude
  Code's own writes outside them, such as memory files under `~/.claude/projects/*/memory` and
  plan files under `~/.claude/plans`, are denied. That is the intended shape: a default-guarded
  session is a worker, and an operator session marks itself `orchestrator`.
- **A failed `git rev-parse --show-toplevel` is read as "not a repository".** Any failure of that
  spawn — a non-zero exit, git missing, a rejected spawn — makes the session's working directory
  the worktree, so a default-guarded session whose git spawn fails gets everything under its cwd
  writable. Pre-existing behaviour, now reachable by more sessions.
- **The guards fail open.** If the module does not load, or a hook throws, Claude Code skips it and
  the seat runs unguarded. The sign is a missing `seat: <role>` in the status line; the debug log
  (`claude --debug`) names the plugin and the reason. Claude Code also holds installed plugins'
  hooks modules behind a rollout flag (`tengu_plugin_hooks_modules`).
- Claude Code only. Codex, OpenCode and Devin have no mod runtime.

## Tests

```bash
bash seat-mods/run-tests.sh   # claude plugin validate + claude plugin test
```
