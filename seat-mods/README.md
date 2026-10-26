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
marks its free sessions.** `crew` does — so did the pre-rename line from 0.2.7; for any other
launcher, set `SEAT_MODS_ROLE=orchestrator` yourself, e.g. in your launch alias. Until then a coordinator or a bare `claude` session starts guarded as an implementer
and cannot merge.

## The contract

Two environment variables, both set **per spawn**:

| Variable | Value | Effect |
|---|---|---|
| `SEAT_MODS_ROLE` | unset or empty | Guarded as `implementer` by default. The status line reads `seat: implementer (default: SEAT_MODS_ROLE unset or empty)`. |
| | `implementer`, `verifier`, `reviewer` | That role's guards are on. The status line shows `seat: <role>`. |
| | `orchestrator`, `coordinator` | Unguarded: no denies, no write placement checks. On OMP an orchestrator may not spawn subagents (0.4.4). The status line shows `seat: <role>`. |
| | anything else | Fail closed. Every tool call is denied with a message that names the bad value and the valid roles. Respawn the seat with a valid value. |
| `SEAT_MODS_ALLOW` | `:`-separated absolute directories | Extra directories the seat may write to: its report directory and its scratch directory. Relative entries and `/` are ignored. Unset, only the worktree and the scratch places (`/tmp`, `$TMPDIR`; see below) are writable — and a reviewer, whose profile may write only in these directories and the scratch places, then writes only there. |

The pre-rename line's 0.2.2 through 0.2.6 export both in the pane of each implementer, verifier
and reviewer seat before its command and leave every other pane unset; with this release an unset
pane is a guarded implementer. 0.2.7 and every `crew` release set `SEAT_MODS_ROLE=orchestrator` on the
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
| Edit or Write outside the worktree, `/tmp`, `$TMPDIR` and every `SEAT_MODS_ALLOW` directory (the deny names `/tmp`, `$TMPDIR` and those directories as the place for scratch files) | deny | deny | deny |
| `rm` outside writable places, with unresolvable operands, or removing a writable root or its ancestor (an operand it cannot read is told to spell its path out literally) | deny | deny | deny |
| `rm` inside the worktree (below its root) | allow | allow | deny |
| `rm` inside a `SEAT_MODS_ALLOW` directory, or below `/tmp` or `$TMPDIR` (below its root; see Scratch places) | allow | allow | allow |
| `git commit`, `git push`, `gh pr create` | allow | deny | deny |
| Edit or Write inside the worktree | allow | allow | deny |
| Edit or Write inside a `SEAT_MODS_ALLOW` directory, or below `/tmp` or `$TMPDIR` | allow | allow | allow |

The worktree is the git top level of the session's working directory (outside a git repository,
the working directory itself). Paths are compared after the file system resolves them, so `..` and
symbolic links land where they really point; a file in folders that do not exist yet is placed by
its nearest existing folder.

`rm` checks operands of commands it recognises, including operands beginning with `-` after `--`.
Relative operands
use the live shell directory from `$.session.cwd()` at the call. This was measured on Claude Code
2.1.294 on 2026-10-08: after a Bash `cd` into a project subdirectory, the next call's hook and
`pwd` both reported that subdirectory; after Claude reset an outside-project `cd`, both reported
the project directory. A `cd` earlier in the **same** call moves that start only as the `cd` and
variables section below reads it; any other recognised `cd`, `pushd` or `popd` makes relative
operands unresolvable and denies them. Absolute operands remain eligible. `worktreeOf()` keeps
its existing behavior: the worktree is derived from that live directory.

Operands containing a command substitution, a parameter expansion other than a plain `$NAME` or
`${NAME}` that a literal assignment in the same call gave (`${NAME:-x}`, `${#NAME}`, `${HOME}`), and
`~user`, `~+` and `~-` operands, cannot be resolved and are denied, including `rm -rf "$OLDPWD"`.
Single-quoted text and escaped characters are literal. Any other `$` in an operand is treated as
unresolvable, including an inert dollar sign. Bare `~` and `~/...` use `HOME`. A glob is placed by
the directory of its literal
prefix: `/etc/tmp.*` is outside, while `build/*.o` is placed in the live directory's `build`.
The resolver follows links in parent directories, but keeps a terminal link literal because
`rm` removes the link itself; a trailing `/` follows the directory. A writable root itself or
its ancestor cannot be removed. A glob whose literal-prefix directory has a writable root
strictly below it is denied, since it could match that root; a glob at the root is eligible when
no writable root lies below it. Unquoted `{` and a glob suffix containing a `..` component are
unresolvable and denied.
A glob component starting with `.` and containing `*`, `?` or `[` is unresolvable and denied.
Redirections, heredoc input and their destinations are excluded from `rm` operands.
An fd prefix such as `2<<EOF` supplies shell input. On every Bash rail a heredoc's delimiter is
its word after Bash's quote removal (`<<\EOF`, `<<E'OF'` and `<<"E"OF` all close at a line
`EOF`; `<<E"O\F"` closes only at `EO\F`), a body line ending in a backslash joins the next only
in an unquoted body, several heredocs on one line close in order, a heredoc inside a `$(…)` also
closes at a line that starts with its delimiter and holds a `)` after it (`EOF)`), as in Bash 5.3,
and a `<<` inside `$((…))`, `((…))` or a `#` comment opens none. Words and redirections after the
delimiter word on the opener line remain part of the command and meet the usual operand checks;
only the opener, its body and its closing line are excluded, and a single `&` separates commands
for `rm`. The exceptions are in Limits: a `$'…'` or `$"…"` delimiter, an opener line with a `$(…)`, a
backtick or a `${…}` after the delimiter word, a quoted `<<` after one of those, a `<<` inside an
unquoted `$[…]` or a `${…}`, and an `EOF)` line the reader does not see closing. Every
Bash rail skips the unquoted reserved words
`if`, `then`, `elif`, `else`, `do`, `while`, `until`, `!`, `{`, `(` and `time` at a command's
head, before assignments or execution wrappers. A path such as `/tools/if`, or `if` after
`A=1` or `env`, names a program; its arguments are not another command. The `builtin` execution
prefix is handled separately, without treating its arguments as reserved words; `builtin cd`
and `\cd` count as directory changes. A parsing or resolution exception denies the Bash call as a command
that could not be checked; forged self-referencing or excessively nested markers are rejected.

A deny reads `seat-mods (<role>): <rule> — this seat may not <action>; report it instead.`

### What the Bash rails stop, and what they leave to the next judge

seat-mods reads free shell text, so it can miss a command, and it can only add a stop. A call it
passes is not approved: it goes on to the next judge (the brief, the permission mode, git hooks,
the server) exactly as if seat-mods were absent. For each way the reader looks at a command:

- **Substitutions and backticks.** Stops a ruled command inside `$(…)` or a backtick span, on every
  rail (the `rm` operands and the `-F` message file too): unquoted, in double quotes, on a heredoc
  opener line or in an unquoted heredoc body, nested up to 8 deep. Leaves single-quoted text and
  quoted heredoc bodies, which are text in Bash; a command inside a Bash 5.3 funsub (`${ …; }`,
  `${| …; }`), which no rail reads; and the shapes in Limits where the reader loses a span's end.
  A command nested more than 8 substitutions deep is refused, reported as `no force-push`. That is
  an accepted false stop: no honest command nests that deep.
- **Heredocs.** Stops a ruled command on a heredoc's opener line after the delimiter
  (`cat <<EOF; git push --force`), on the line after its closing line, and after a `<<` inside
  `$((…))`, `((…))` or a `#` comment, which open no heredoc. Leaves the body and the closing line,
  which are text, and the fallbacks in Limits: when an opener line holds a `$(…)`, a backtick or a
  `${…}` after the delimiter word, a ruled command after the substitution on that line stays hidden,
  as in 0.9.0; and a `<<` in an unquoted `$[…]` or a `${…}` still opens a heredoc.
- **The command word and glued redirections.** Stops a ruled command whose head is escaped
  (`\rm -rf …`, `\git push --force`), follows a named descriptor (`{log}>f rm -rf …`), or has a
  redirection glued to a flag (`git push --force>&2`, `--force&>f`, `-f>/dev/null`). Leaves a
  quoted command word (`"rm" -rf …`, `"git" push --force`) and a subscripted prefix
  (`A[0]=1 rm -rf …`), which are not read as the command.
- **Scratch places** and **`cd` and variables, for `rm`**: below.

### Scratch places

Beside the `SEAT_MODS_ALLOW` directories, every guarded role may Edit, Write and `rm` below `/tmp`
and below `$TMPDIR`, read from the seat's own environment on both hosts. Only descendants count:
`rm` of the directory itself or of an ancestor (`rm -rf /tmp`, `rm -rf /`) is still denied, and a
`..` out of it lands outside. A relative `$TMPDIR`, `/` and a directory that does not resolve name
no place. A link counts by both spellings (on macOS `/tmp` and `/private/tmp`). `rm -rf /tmp/*` is
allowed, which is the accepted cost: a seat can remove another session's scratch files. Limits
names two more limits of the scratch places.

### `cd` and variables, for `rm`

A relative operand is placed from the session's directory. Inside one call the reader follows a
literal `cd <path>` and literal `NAME=value` assignments in a plain `;`, `&&` or newline sequence
from the call's start, so `cd /w/wt && rm -rf pf/__pycache__` is placed, and so is
`WT=/w/wt; cd "$WT" && rm -rf pf/__pycache__`. With no `WT=` earlier in the call, `cd "$WT"` names an
unknown variable and the `rm` after it is unresolved.

- A `cd` before `;` or a newline may fail, and Bash then runs the next command where it stood. So
  an `rm` after one is checked in every directory it may run in, one target each, and every target
  must be writable; after `cd X &&` it runs in X only. More than four possible directories is
  unresolved.
- A `$NAME` or `${NAME}` reads the value of a literal assignment: no `$`, backtick, parenthesis or
  redirection in it, and no blank, glob, quote, brace or `~` once unquoted. A variable stays known
  only across literal assignments, a literal `cd` and a bare `rm`; any other command forgets them
  all (`WT=/w/wt; echo "$WT"; rm -rf "$WT/x"` is refused).
- Unresolved, so refused as before: a `cd` in a subshell or an `if`, after `||` or in a pipeline;
  `cd -`, `cd ..`, `cd ~` and a `cd` with an option, a glob or an unknown variable; `pushd`,
  `popd`, `command cd` and `builtin cd`; a Bash 5.3 funsub. `eval`, `source`, `export`, `read`,
  `printf` and the other builtins that run text or change shell state end the walk: no variable is
  read after them, and a directory a `cd` moved to is unknown. Limits lists what the walk does not
  model.

## Status block (orchestrator)

Claude Code only. In a `SEAT_MODS_ROLE=orchestrator` session, a **status turn** — a turn the
operator did not start by typing — must end with only the five-field status block:

```
**What I ruled:** …
**What the PR(s) will carry:** …
**Next steps:** …
**Waiting on (seats live):** …
**Waiting on operator:** …
```

One field per line, in that order; each label bold or plain, followed on the same line by its
content ("none" is content), nothing before the first label or after the fifth; a blank
(whitespace-only) line between fields is skipped. Waiting on operator takes `none`,
`decision: <question>` or `action: <what the operator must do>`. Three hooks carry it:

- `prompt.submit` classifies the turn and, on a status turn, adds one line of model-only context
  (tool calls only, then the block). A prompt the operator types into a running status turn makes
  that turn the operator's, and it is not checked; a queued prompt (`ctrl+x enter`, `wait: true`)
  waits for a later turn and leaves the status turn alone.
- `classic.Stop` checks `last_assistant_message`. A miss blocks the stop **once per turn** with the
  failing reason; a second miss lets the stop through. A block raised beneath seat-mods —
  autonomic's autopilot push — passes unchanged and is not counted as seat-mods' rewrite. A turn
  that ends on molt's `MOLT-HANDOFF:` line is exempt.
- `turn.complete` adds one line under the reply when the second miss stands:
  `⚠ seat-mods: status block missing — this status reply is not in the required form.` It changes
  neither the answer nor the transcript, and a subagent's turn end is ignored.

On the same block, an **idle check** (#876) reads three fields. When both wait fields — Waiting
on (seats live) and Waiting on operator — read `none` while Next steps names work, the
block contradicts itself and does not end the turn: the first stop is blocked with
`seat-mods (orchestrator): the status block says nothing waits, but Next steps names work. Do the
next step now, or name the seat, wake, or operator decision or action you wait on.`, and the
second adds
`⚠ seat-mods: status block says nothing waits, but Next steps names work.` under the reply, the
way the shape warning sits. A field reads `none` when its content starts with the word `none`,
any case: `none. No seats are live.` counts, `nonetheless` does not. The one block per turn is
shared with the shape check, in either order: a turn already nudged for idling gets no later shape
rewrite, and a turn whose shape rewrite is spent takes the idle warning only, not a second block.

The check calls no model and never calls herdr, Orca or Paseo. Only `SEAT_MODS_ROLE=orchestrator`
sessions are affected; every other role and an unset role are untouched.

When a status turn that ends hands the operator a `decision:` or an `action:` — whether the block
passed or was let through after its one rewrite — and autonomic's session record
(`~/.claude/state/autonomic/sessions/<id>.json`) says `mode: autopilot`, seat-mods rings the
record's `bell` (when set) and shows `seat-mods: waiting on operator — <field 5 text>`: on Claude
Code as a line under the reply in `turn.complete`; on OMP in the notification its status entry
already uses. The text is redacted for credential shapes, cut to one line and 200 characters. The
signal only adds a notification: it never approves, answers or blocks, a failing or slow bell is
logged and never holds the turn, and `none`, a manual session, no record, a molt handoff and a
non-orchestrator role are quiet. The bell runs detached under molt's 30 s bound.

A typed prompt that starts with a crew tag — `[crew report|molt|message <role>]`, crew 0.3.x — is a
status turn. So are the two legacy ping forms, `REPORT READY: ` and `MOLT WARNING `, and the two
rotation resume forms, `/ossify:handoff-resume ` and `skill://handoff-resume ` (a slash command a
tag prefix would break). The legacy forms may go only when no run in flight was dispatched from a
crew brief older than 0.3.1.

**Known limit:** an operator prompt that itself starts with `REPORT READY: ` is held to the block.
That is the accepted cost of covering briefs already dispatched from crew 0.3.0.

## Limits

- **The rails stop mistakes, not an adversary.** Bash matching is whitespace tokens split on `;`,
  `&&`, `||`, `|`, a lone `&` (the `&` of a `|&` pipe included; the `&` a redirection carries and
  the lone `&` inside an unquoted `${…}` or `$[…]` expansion are not boundaries — inside an
  expansion only that character is masked, so its `(`, `)`, `;`, `|` and a nested `$(…)` keep
  their meaning), parentheses and newlines, after quoted strings and heredoc bodies are blanked as
  text and `#` comments are dropped, so a commit message may mention `git merge` or `-n`. A quote
  or a trailing backslash in a comment pairs or joins with nothing, and an escaped quote or a
  `$'…'` string opens no string past its end. Every rule set is the union of that
  reading with the `seat-mods-v0.3.1` separator read over the same command, so the rails see
  everything 0.3.1 saw — plus a command after a lone `&`. Only the command word counts, after any
  `VAR=value` and `sudo`, `env`, `command`, `exec`, `nohup` or `time`, and the head words
  `if`, `then`, `elif`, `else`, `do`, `while`, `until`, `!`, `{`, `(` and `time` on every rail only
  as exact unquoted words before assignments or execution wrappers (`builtin` is an execution prefix);
  so `echo git merge` is not a merge, and neither are `xargs git push --force`, `bash -c "git push -f"`, `g""it push`, or a
  wrapper with its own options (`env -i git merge`, `sudo -u u git push -f`).
- **Known limit:** `time -p <cmd>` is not parsed; for example, `time -p git push --force` passes.
- **Unparsed shell forms pass:** bundled short flags (`-fqu`),
  abbreviated long options (`--mir`), value-taking git globals (`--git-dir x`) and quoted
  subcommands or flags (`git "merge"`). A trailer that opens an `-m` message, comes from
  `--trailer`, or follows a backslash-newline inside single
  quotes, also passes.
- A command inside `$(…)` or backticks is read as a command of its own when the substitution stands unquoted, in double quotes, on a heredoc opener line or in an unquoted heredoc body, except as the next lines of this list say. The reader finds a span's end by counting parentheses and quotes, not by parsing, so a `)` Bash does not count ends it early and the rest of that span is not read: a `case` pattern's `)` in a double-quoted `$(…)`, a `)` inside a `${…}` there (`"$(echo ${x:-)} "it's")" && git push --force 'x'`), and a backslash-newline between `$` and `(`. A command nested more than 8 substitutions deep is refused as `no force-push`, whatever it runs.
- A backtick inside a quoted heredoc body inside a backtick span closes the span in Bash, and the text after it runs; the reader keeps the body whole, so a command there hides: `` x=`cat <<'EOF' ``, a newline, `` a ` ; git push --force ; ` ``, a newline, `EOF`, a newline and a closing backtick passes.
- **Funsubs:** a command inside a Bash 5.3 `${ …; }` or `${| …; }` runs in the current shell and is read by no rail: `X="${ git push --force; }"` and `X="${ rm -rf /etc/x; }"` pass. A funsub anywhere in a call makes its directory unknown, so a relative `rm` in that call is refused.
- Shell options changed in the same call (`shopt`, e.g. `extglob`, `dotglob`, `nullglob`) are not modelled beyond the `**` and dot-component denials.
- `**` in an rm glob operand is unresolvable and denies; quoted literal `**` stays literal.
- **C6, grammar:** the reader splits text and does not parse it. An unexecuted shell function body (`cleanup() { rm …; }`) is checked as if it runs and may deny, and so is a command in a script Bash would refuse to run (`if git push --force; then`).
- **C5, a `&` inside a word:** only a lone `&` inside an unquoted `${…}` or `$[…]` is masked. A `&` inside any other word still splits it, so `a[foo&git push --force ]=x` and `echo @(a&git push --force )` are denied though Bash runs no `git`.
- **C8, a quoted tilde:** `rm ~""/scratch/x` and `rm ~''/scratch/x` read the tilde as `HOME`. Bash expands no tilde that is partly quoted and removes `<cwd>/~/scratch/x`. The usual outcome is a false stop; for a reviewer whose `SEAT_MODS_ALLOW` holds `$HOME/scratch`, the rm is placed there and passes while Bash removes in the session directory. A tilde quoted whole (`"~"/x`) reads as a relative name.
- One-word runners beyond the recognised wrappers (`timeout`, `nice`, `stdbuf`, `setsid`, `xargs`) can hide `rm`.
- A heredoc opener line holding a `$(…)`, a backtick or a `${…}` after the delimiter word is read as in 0.9.0: the rest of that line goes with the heredoc, so a ruled command after the substitution on that line stays hidden (`cat <<EOF $(date); git push --force`, then a body line and `EOF`). So does a quoted `<<` after one of those on its line, as in the `"$(cat <<'EOF' … )"` commit form. Any other quoted `<<` is text, as in Bash.
- On such a line only the first opener is read, even when a second one stands before the substitution, so the second heredoc's body reads as commands, toward a stop: `cat <<A <<'B' "$(date)"`, then `a`, `A`, `rm -rf /etc/x` and `B` is refused, though Bash removes nothing.
- An arithmetic `$((…))` that spans lines on such a line leaves the reader counting its parentheses past the heredoc, so a later quote or comment can hide a ruled command: `cat <<EOF $(date) $((1 +`, a newline, `2))`, a body line and `EOF`, then `echo hi # it's` and `git push --force 'x'` passes.
- A `$'…'` or `$"…"` heredoc delimiter is read with its `$`, so its heredoc never closes at `EOF` and the lines after it can hide commands.
- A `<<` inside an unquoted `$[…]` or inside a `${…}` still opens a heredoc for the reader (`X=$[1<<2]`, `echo ${x/<<a/b}`), though Bash runs it as arithmetic or a pattern. The lines after it, up to one that equals its delimiter word (`2]` and `a/b}` in those two examples), read as body, so a ruled command there is hidden: `X=$[1<<2]` then a newline and `git push --force` passes, and so does `rm -rf /etc/x` there.
- Inside a double-quoted `$(…)`, a `#` after a blank in an inner quoted string still reads as a comment, as in 0.9.0, so the rest of that line is hidden (`git commit -m "$(echo "a # b")" && …`).
- A heredoc inside a `$(…)` closes, as in Bash 5.3, at a body line that starts with its delimiter and holds a `)` after it, and the rest of that line is read as commands (`EOF)` in `git commit -m "$(cat <<'EOF' … EOF)" && git push --force`). The reader sees that close only when the `$(` opens on the heredoc's opener line, the heredoc is the last one the reader opens on that line, and no backslash joins the closing line to the one before it. Otherwise the heredoc is not seen closing, and the commands after it can hide: `x=$(`, a newline, `cat <<EOF`, a body line and `EOF) && git push --force` passes. A backslash-newline inside a word reads as a blank where Bash deletes it: `r\<newline>m -rf /etc/x` is not read as an `rm`, and `git push --for\<newline>ce` is a push but not a force-push.
- Paths changed earlier in the same call (`ln -s`, `mv`, `mkdir` before `rm`) are checked against the filesystem as it stands before the call runs.
- **A scratch directory that holds the seat's own worktree is not a scratch place for that seat.** A seat whose worktree lies under `/tmp` gets no `/tmp` place, and one under `$TMPDIR` gets no `$TMPDIR` place; a scratch directory that does not hold its tree still applies. An allowed directory outranks the worktree, so adding the one that holds it would let a reviewer edit its own tree. Writes there keep the refusals the seat had.
- **A broad scratch directory opens other trees.** Other seats' worktrees under `/tmp`, or under a broad `$TMPDIR` such as `/home/dev`, are writable by any guarded seat whose own tree is elsewhere, the same as putting that value in `SEAT_MODS_ALLOW`. A `$TMPDIR` inside the worktree opens that subtree to a reviewer. `rm -rf /tmp/*` is allowed, so a seat can remove another session's scratch files.
- **The `cd` walk does not model the environment.** A `CDPATH` in the seat's environment (one assigned in the call ends the walk), a `cd` alias, any function or alias from the shell snapshot that changes directory (zoxide's `z`, for one) and zsh's `cd` behaviour are not read, and any of them can leave a later relative `rm` where the walk does not look.
- Glob matches are not enumerated: a matched parent symlink can lead outside writable places, as in `rm -rf <worktree>/*/node_modules`.
- `$` outside literal quoting/escaping, other than a `$NAME` a literal assignment gave, and leading `~+`/`~-` are unresolvable, even when Bash could resolve them.
- **Quoted command words:** a quoted command word (`"rm" -rf /etc/x`, `r'm' -rf /etc/x`, `"git" push --force`) and a subscripted assignment prefix (`A[0]=1 rm -rf /etc/x`) are not read as the command, so the rails pass them. A quoted `"cd"` does count as a directory change.
- `POSIXLY_CORRECT` operand ordering and a backslash-newline inside double quotes are not modelled.
- **The guarded launch needs a POSIX shell in the seat's pane.** crew sets the variables
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
- **The Bash placement rail covers only `rm`.** `rmdir`, `unlink`, `find -delete`, `git rm`, `git clean`,
  `xargs rm`, `bash -c '...'`, `mv` over a file, and other Bash writes such as `cat >` and `sed -i`
  remain outside it. These rails stop mistakes, not an adversary; precise shell parsing remains
  out of scope. A same-call `cd` the walk follows is checked in every directory the `rm` may run in; any
  other earlier recognised `cd`, `pushd` or `popd` conservatively denies relative `rm` operands even if
  that directory change fails. Cross-call directory changes use the live cwd measured above.
- **A default-guarded session writes only inside the worktree, `/tmp`, `$TMPDIR` and the
  `SEAT_MODS_ALLOW` directories** — and outside a git repository the worktree is its working
  directory — so Claude Code's own writes outside them, such as memory files under `~/.claude/projects/*/memory` and
  plan files under `~/.claude/plans`, are denied. That is the intended shape: a default-guarded
  session is a worker, and an operator session marks itself `orchestrator`.
- **A failed `git rev-parse --show-toplevel` is read as "not a repository".** Any failure of that
  spawn — a non-zero exit, git missing, a rejected spawn — makes the session's working directory
  the worktree, so a default-guarded session whose git spawn fails gets everything under its cwd
  writable. Pre-existing behaviour, now reachable by more sessions.
- **The runtime can fail open.** If the module does not load, or a hook throws outside the guarded
  Bash check, Claude Code skips it and
  the seat runs unguarded. The sign is a missing `seat: <role>` in the status line; the debug log
  (`claude --debug`) names the plugin and the reason. Claude Code also holds installed plugins'
  hooks modules behind a rollout flag (`tengu_plugin_hooks_modules`).
- Claude Code only. Codex has no mod runtime.

## OMP

Under `SEAT_MODS_ROLE=orchestrator`, the OMP guard blocks the `task` tool and every `before_subagent_spawn` (eval `agent()`, workpool) with a #798 denial directing the top to dispatch a herdr seat; other tools stay free, coordinator and every guarded role are unchanged, and the Claude Code hook is unchanged.

`omp/status-extension.ts` (0.8.0) is the status-block check and idle stop for an OMP orchestrator, over the same `hooks/status.ts`: one block per turn, then the warning as an OMP notification. `omp-seat` loads it last, after molt and autonomic, for the orchestrator only, so their `session_stop` blocks win as they do beneath seat-mods on Claude Code; the guard stays first. OMP's `input` cannot tell typing from a herdr send, so a turn is status by its crew tag, or when no input started it (a job completion, an idle wake). **Known limit:** a turn that no prompt starts gets the check but not the status-turn context line.

`omp/extension.ts` is the same guard for OMP, over the same `hooks/rules.ts`, so the Bash reading, the scratch places (`$TMPDIR` from the seat's environment) and the `cd` walk above apply to a `bash` call there as they do on Claude Code. It loads only through `omp-roles`' `omp-seat` (`-e`, never ambient), so a plain `omp` session stays unguarded. The main session follows `SEAT_MODS_ROLE`; a `task` child inherits its parent's env, so the guard reads the child's agent name:

| Child agent | Rails |
|---|---|
| `implementer`, `task`, any other name | verifier: no commit, push or PR; writes in the worktree, the scratch places and `SEAT_MODS_ALLOW` (an `implementer` child stages and never commits) |
| `seat-reviewer`, `reviewer`, `scout` | reviewer: writes only in `SEAT_MODS_ALLOW` and the scratch places; `eval` and `debug` blocked |

Under any guarded role, a tool call passes only if its name is on the allow list in `GUARDED_TOOLS` (omp 18.8.9's tools); any other name, an MCP or extension tool included, is denied:

| Tools | Guarded rails |
|---|---|
| `read`, `grep`, `glob`, `find`, `ast_grep`, `web_search`, `recall`, `todo`, `wait`, `yield`, `think`, `advise` | allowed |
| `ask`, `goal`, `task` | the top-level session only; a child is denied |
| `bash`, `eval` | the command rules; `eval` source read best effort, and blocked for a reviewer |
| `write`, `edit` (and its `apply_patch` wire name), `ast_edit` | every target placed as omp reads it: a `[path#HHHH]` header unwrapped, `~`, `@/`, `:/` and `file://` expanded, any other `scheme:/` outside; since 0.4.5 (#844) `write` to an exact `local://<name>` is allowed for every guarded role: omp's per-session scratch, which omp confines itself |
| `lsp` | omp's read-only actions only (`diagnostics`, `definition`, `type_definition`, `implementation`, `references`, `hover`, `symbols`, `status`, `capabilities`) |
| `github` | omp's read-only ops; `pr_create`/`pr_push` follow the PR and push rails; `pr_checkout` and every other op denied; `forceWithLease` is a force-push |
| `debug` | an implementer only, its launch read like `eval`; denied for a verifier or reviewer |

A child may not spawn (`task`, eval `agent()` and workpool workers are blocked). omp's advisor and `/tan` clones count as children, so they get the verifier rails even under a coordinator. **Known limit:** helper calls inside `eval` fire no `tool_call`, so the guard reads `eval` source as best-effort command text; git hooks stay the rail for the rest. **Known limit:** the guard reads omp's path dialect only as far as the table says; omp's other path selectors (a SQLite `file.sqlite:table:row`, and any later one) are read as plain paths, so one routed through a symlink that points outside the worktree is not caught. Bash redirections, `cp`, `mv` and `ln` are not placed either. The guard catches a seat's mistakes; it is not a sandbox.

## Tests

```bash
bash seat-mods/run-tests.sh   # claude plugin validate + claude plugin test
bun test omp/                 # repo root: the OMP guard (omp/tests/seat-mods.test.ts) and status check (omp/tests/seat-mods-status.test.ts)
```
