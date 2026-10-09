# autonomic

Autopilot as a Claude Code mod. Requires Claude Code 2.1.289 or later.

The operator plans and grills a piece of work, and then the session still stops to ask: "Shall I
proceed?", a choice the plan already made, a permission prompt for an operation the plan already
authorised. In **autopilot**, autonomic answers those stops from standing orders the operator
owns and from the session's own scope (its spec, plan, grill record or brief). It lets the
session stop only for a reason on a closed **pain list**, and tells the operator when it does.
Every decision it takes in the operator's place is one line in a committed **ledger**. It fails
toward manual: anything broken gives more asks, never fewer.

autonomic reads no crew or multiplexer state. It reads five environment variables a launcher may
set, and two files `molt` writes.

## Turning it on

| Source | Effect |
|---|---|
| `AUTONOMIC_MODE=autopilot` on a spawn | autopilot from session start |
| `/autopilot on [doc …]` | autopilot from now; the docs become the scope, and their paths go into the prompt box for one Enter |
| `/autopilot off` | manual from now |
| `/autopilot status` | mode, source, scope, policy (`default`, `edited`, or missing), `yieldAtPercent`, `loopMax`, `tailChars`, the enabled never-approve rules, molt's stage for this session (or `none`), ledger, bell, pain file, loop count |
| unset, empty, `manual` | manual |
| any other value | manual; the status line names the value |

The command beats the env var for the rest of the session. The status line always shows the
mode: `autopilot`, `manual`, `manual (AUTONOMIC_MODE="x" is not a mode)`, or
`autopilot: no policy` / `autopilot: ledger not writable` when autopilot was refused.

## The policy

`~/.claude/autonomic/policy.md` (`policyPath`). autonomic writes this default on first start and
never overwrites the file. In autopilot it joins the system prompt as a `session` section, and
every fork prompt quotes it too.

Because autonomic never rewrites the file, a new standing order in a release reaches only a fresh
default. To take one into an existing file — edited or not — paste its line under **Standing
orders**; or, if you never edited the file, delete it and the next session start writes the new
default. Since 0.3.0 that line is the pain-options order (*When you stop for a pain item, ask with
`AskUserQuestion`: …*, in the block below). `/autopilot status` reads `edited` for any file that
differs from this release's default, an unchanged older default included.

```markdown
# Autopilot policy (autonomic)

You are in autopilot. The operator planned this work and is not watching. Keep the run going, and do not ask for a confirmation that the planning already gave.

## Standing orders

- When the spec, the plan, the grill record or your brief already decides a choice, take that option and state it in one line. Do not end a turn on "Shall I proceed?" or "Which first?" in that case.
- Merge authority: once a pull request has passed its work-pr or merge-bar loop, the orchestrator merges it without asking.
- When a step is done, start the next step of the plan.
- When you stop for a pain item, ask with `AskUserQuestion`: two or three options, the recommended one first and marked "(Recommended)", each worded as the instruction you will follow. For a one-way door, offer doing it and not doing it as separate options, and never mark the irreversible one recommended. For credentials, ask in plain text with no options.

## Permission scope

Approve without asking what serves this session's own task:
- reads, builds, tests and linters anywhere in the worktree;
- edits and commits on the session's own branch;
- pushing the session's own branch when it is not the default branch, and opening or updating its pull request;
- writes in the session's scratch and report directories.

Leave everything else to the operator.

## Pain list: the only reasons to stop and ask the operator

- product ambiguity: the scope does not say what the product should do;
- a tradeoff the scope does not settle;
- an approval gate: a step your process gives to the operator, such as reviewing or approving a spec, a design, a plan or a release scope, or choosing how a plan is executed, even when you recommend an option;
- credentials or secrets;
- a one-way door: data loss, an external publish, a delete;
- a hard deny;
- the autopilot loop guard;
- a molt pause.
```

## The reflexes (autopilot only)

**Turn end.** At each turn end one cached fork of the session classifies how the reply ended:

| Case | Meaning | What autonomic does |
|---|---|---|
| `covered` | It ends on an ask the policy or scope answers | blocks the stop with `Autopilot: <answer>. Proceed.`; ledger line |
| `stalled` | It stopped short with no ask and no reason | blocks with `Autopilot: continue — <next step>.`; ledger line |
| `waiting` | It waits on a background task, agent, monitor or report | lets it stop |
| `done` | The scope's objective is met | lets it stop; ledger line, toast |
| `pain` | A reason on the pain list | lets it stop; pain signal with up to three options, ledger line |

The host shows a block as `Stop hook error: <reason>`; the model reads it as an instruction.
After `loopMax` (3) blocks in a row with no change made — no tool call other than a read that
ran, was not denied and was not read-only (`ls`, `git status`) — the next turn end is pain ("autopilot loop"). A prompt from you resets
the count.

**`AskUserQuestion`.** The fork judges the questions. When every one has an answer that is
exactly one of its option labels, autonomic answers in your place, tells the model it did and why,
and writes one ledger line per question. The fork also sees the live turn (below). A question with no options (free text) always goes to you. Anything else — not covered, a label that is not an option, a fork that fails — goes to
you, and the bell rings.

**Permission asks.** A `deny` is never changed (a deny rings once per tool and reason, as "hard
deny"; a deny from a plugin beneath autonomic's `tool.call` hook, such as a seat guard, rings the
same way). On an `ask` verdict, first, in code, the **never-approve list** keeps the ask with you
and rings. On an `allow` verdict — bypass permissions, or a settings allow rule — a command that
matches the list becomes an `ask`, so you get the normal permission dialog, and it rings (the
**bypass floor**; see "Permission modes").

The list reads the whole command text as **one bag of words**. First it joins a backslash-newline
and drops every `\`, `'` and `"`. Then it splits the text at spaces, `; & | ( ) < >`, backticks and `$(`
(`${OPTS}` stays one word that starts with `$`). A `NAME=VALUE` word also shows its value.
Outside inert commands (below), the list never decides which command a word belongs to, so a
quote, a wrapper, an interpreter or a substitution cannot hide a word:
`python3 -c 'git push -f'`, `bash -c "…"` and `$(git push -f)` all show `push` and `-f`. A danger
word beside a harmless command is an extra ask; that is the cost of this reading. The rules:

- `force-push` — a push verb (`push`, `send-pack`, `http-push`, `git-push`, a word holding
  `.push=`) and anywhere in the text a short-flag cluster with `f` (`-f`, `-uf`), an abbreviation
  of `--force`, `--force-with-lease`, `--force-if-includes` or `--mirror`, or a word starting `+`;
- `branch-delete` — a push verb and a cluster with `d`, `--delete`, `--prune`, `--mirror`, or a
  word starting `:`; or `branch` and a cluster with `D`, or `-d`/`--delete` with a force flag (a
  plain `git branch -d` is not on the list);
- `default-branch-push` — a push verb and the default branch's name (`origin/HEAD`, or
  `main`/`master` when unknown) as a word or after `:`, `/` or `=`, `--all`, `--branches`,
  `--mirror`, the matching refspec `:`, or a word holding `$`, `*`, `?`, `[` or `{`; or any push
  while the session's branch is the default branch or unknown; or any push after a move (`cd`,
  `pushd`, `git -C` to a directory other than the session's own or the repo root, `popd`,
  `--git-dir`, `--work-tree`, `GIT_DIR=`, `GIT_WORK_TREE=`); or any `send-pack` or `http-push`;
- `rm-outside` — `rm` with a recursive flag, and a move, `xargs`, or a later word that starts
  with `/` outside the worktree or with `~`, holds a `..` segment, a `$` or a `{`, or a glob on a
  dot name (`.?`); a plain glob (`build/*`) stays where it is;
- `no-verify` — an abbreviation of `--no-verify`, or `commit` and a cluster with `n`.

A flag word that holds `$`, `*`, `?`, `[` or `{` (`--forc*`, `-$X`) counts as every flag. Beside a
push or an `rm`, so does a bare variable (`git push $OPTS`). Beside `branch` or `commit`, a bare
variable is not read as a flag: it is mostly a message or a path.

**Inert commands leave the bag (since 0.4.2).** When the text holds no program that may run text
(the list below), no `<(` or `>(`, no `$((`, no backtick, no heredoc left in place, no function or
`alias` definition and no open quote,
the list splits it into simple commands at `;`, `&`, `|`, `&&`, `||` and newlines outside quotes
and comments. A command whose first word is `[`, `[[`, `test`, `echo`, `printf` (without `-v`),
`exit`, `true`, `false`, `cat`, `head`, `tail`, `wc`, `ls`, `stat`, `grep`, `jq`, `cut`, `tr`,
`mkdir`, `touch`, `mv` or `cp` (or a path to one in a system `bin` directory) then adds no words,
unless it pipes onward, or writes with `>` into `.git/`, a `hooks/` directory, a git config file
(`~/.gitconfig`, `.gitattributes` …), a file that a later command outside this list names, or a
file named by a variable the text does not assign once — or by any relative name after a `cd`,
`pushd` or `popd` — while a command outside this list follows. A later command whose own name holds a
variable or a glob (`./$T.sh`, `./x*`) counts as naming every file. Every other command keeps its
words, and so a danger word beside a harmless *non-inert* command is still an extra ask. A dashed
word is a verb as git's own executable (`git-push`) or as a path (`./force-push`); bare prose such
as `no-rm` or `force-push` is not.

**Since 0.4.3** a command substitution is read as commands of its own: an inert command such as
`test -n "$(git diff --cached)"` or `echo "… $(date)"` drops its own words, and the commands inside
are judged the same way; a command that is not inert keeps everything. A redirect or a pipe on a
group's closer (`}`, `)`, `fi`, `done`, `esac`) applies to every command in the group. `cat <<'EOF'`
with no file prints to standard output, and its body drops unless it is piped to a command that
is not inert (or into a file), its group's target is used later, or it sits in a `$(`; an unquoted
`cat <<EOF` body counts when it holds no `$(`, backtick, `$((`, `$[` or `${…@…}`. A `sed` with no
`-e`, `-f` or `-i` whose script is one address plus `p`, `d` or `q` (`sed -n 8,9p`) is inert. After
a `cd` to a literal directory a relative name is read inside it (`cd .git` makes `config`
`.git/config`). A command in `readers` (below) that names a written file does not run it.

Two heredoc shapes with a quoted delimiter are literal text, and their bodies are skipped: a
commit message, `-m "$(cat <<'EOF'` … `EOF` `)"`, and `cat > file <<'EOF'` at a command's start
unless a later command outside the inert list names the file — a `mv`, a `cp` or a redirect passes the check on
to what it writes, a file in `.git/` or `hooks/` counts as run, and when one body is kept every
body is. Every other heredoc
keeps its words, and so do these two when the rest of the text names a program that may run text: a shell, `eval`,
`source`, `.` at a command's start, `xargs`, `ssh`, `su`, `watch`, `parallel`, `sed`, `awk` or an
interpreter (`python3`, `node`, `perl`, `ruby` …). A unique prefix of a long option is read as
that option (`--r` is `--recursive`, `git push --de` is `--delete`), as git and GNU tools accept
it; an ambiguous prefix the tools refuse is only an extra ask.

`unreadable` matches nothing since 0.2.0: no rule depends on following a command's shape. The
name stays valid, so an existing `neverApprove` value still parses.

Each rule can be turned off: `neverApprove` (below) names the enforced rules. A rule you remove
is the fork's to judge on an ask, and is left alone on an allow. A repo whose default branch takes
direct pushes by design removes `default-branch-push`.

When no rule matches, the fork judges the call against the policy's
permission scope and the live turn: `allow` is recorded and the tool runs; anything else leaves the ask and rings. The list applies to any tool whose input has a `command` (Bash, Monitor). A call whose input is longer than the fork is shown (4000 characters) stays an ask and rings. `AskUserQuestion` and `ExitPlanMode` are never approved here: their permission prompt is your own dialog.

**The live turn.** The permission and ask forks also get the turn digest: the session's last 12
prompts and main-thread tool results since the fork's transcript was sent, one line each (a
command's shape or a tool's input key names, and the last 300 characters of its result, redacted
first), at most 4,000 characters, newest kept; angle brackets in it are swapped for `‹ ›`, so a line
cannot close the block or open a tag of the prompt. The fork may miss a result from earlier in the
same turn without it. A later instruction from you or the orchestrator counts as part of the task.
The digest lives in memory only: it never reaches the ledger, the pain file, the bell or the log.
The turn-end fork does not get it.

## Permission modes

- **Bypass permissions** (`--dangerously-skip-permissions`). Claude Code never asks, so the
  permission fork never runs and no "nothing to judge yet" ring occurs. In autopilot, a command
  that matches an enabled `neverApprove` rule still reaches you as a permission dialog with the
  reason `autonomic: never-approve — <rules>`, and the pain signal names the line that matched.
  This is the floor that makes autopilot safe under bypass.
- **Auto or default.** Claude Code asks, and the ask path above applies. The first ask after a
  clear rings "nothing to judge yet": the fork has no request to copy until the session's first
  response.
- **Manual mode**, in any permission mode: autonomic never touches an `allow` — except in a
  session that left autopilot through a failure (an unwritable ledger or record, a removed
  policy). That session keeps the floor, because under bypass, manual means no asks at all.
  `/autopilot off` turns it off.
- **What the floor guards against:** a cooperative model writing a dangerous command, judged
  from the command text alone. These pass it: a script or program that runs git itself
  (`./deploy.sh`, `make release`); a git alias defined in config or an earlier command; `sed`'s
  `e` command or any program that builds the command at run time; a brace or glob that builds
  the verb (`git pu{s..s}h`); a bare variable beside `branch` or `commit`; and a danger only the
  filesystem shows (`rm -rf /repo/link/x` where `link` points outside the worktree).
- **What a never-approve match records.** The ledger line and every pain signal carry the
  command's *shape* — verbs, a git subcommand and flag names, with every value only counted
  (`git push -f https://u:TOKEN@… feat/x` is `git push -f (+2 args)`, an assignment is `NAME=`) — so no credential is
  written, however it is spelled; a command name outside a known list shows as `?`, and a flag
  outside a known list as `-?`. The
  permission dialog shows you the whole command.
- **What an allowed ask records.** Since 0.2.1, an ask the fork allows records no input value
  either: a command's shape, as above, or another tool's input key names only (`Write:
  {file_path, content}`).
- **Credentials** in the fork's own text — its reasons and the questions it writes (URL user
  info, `*_TOKEN=…`, `--token …`, Authorization, Bearer and other key, token, secret or cookie
  header values, bare or quoted, and known token shapes) — are redacted before any ledger line,
  notice, toast, bell or pain file. This redaction is best effort: prose cannot be reduced to a
  shape, so a value the fork quotes in an unusual form can pass.

## The ledger

One line per decision:

```
- <ISO time> · <session id> · <case> · Q: <question> · A: <answer> · why: <reason>[ · usage: in=<n> cached=<n> out=<n>]
```

Path: `AUTONOMIC_LEDGER` when set (relative to the repo root when relative), else
`<repo root>/.autonomic/ledger.md`, else `<cwd>/.autonomic/ledger.md` outside git. autonomic only
appends; the session's own commits carry the file. The cases are `covered`, `stalled`, `done`,
`pain` (the turn end), `ask` (an `AskUserQuestion` answered), `permission` (an ask allowed, or a
never-approve match kept with you), `operator` (you pressed an option on the pain band:
`why: chosen on the pain band`), and `molt` — the turn end is molt's handoff, and autonomic let
it stop (`why: molt owns this turn end`). In a dual-repo project, point
`AUTONOMIC_LEDGER` at the AI workspace. A ledger that cannot be written ends autopilot, and the
decision that could not be recorded is not taken.

## Pain

The list lives in the policy file (default above). A pain signal is:

- a band above the prompt, with a Dismiss button — and, for a turn-end pain, one button per option
  (see below);
- a toast;
- the bell: `bell` in `/config`, or `AUTONOMIC_BELL` on a spawn, run as a shell command with
  `AUTONOMIC_MESSAGE` set to one line — for example `curl -d "$AUTONOMIC_MESSAGE" ntfy.sh/<topic>`;
- a line `<ISO time> pain <text>` appended to `AUTONOMIC_PAIN_PATH`, when a launcher sets it, so a
  worker's pain reaches its parent.

A pain signal never resumes the run by itself. Your next prompt does.

**Options (since 0.3.0).** For a turn-end pain the fork also offers up to three answers, each a
label and the instruction the session will follow: at most one recommended, never the
irreversible side of a one-way door, and never a credential. The band shows the
question on its own line, then one row per option, the recommended one first as
`<label> (Recommended)` in the accent style. The buttons share one column (as wide as the longest,
at most 40% of the band), and each option's whole text wraps beside its button. A last row holds
Dismiss. No option has a hotkey, so a reply you type that starts with a digit stays yours (this
layout since 0.3.1). A
pain with no options keeps its one line. A press is your decision and nothing runs without it: the band clears, the ledger gets an `operator` line, and
only then does the option's text enter as your own prompt (`asUser`). A ledger that cannot be
written submits nothing. A prompt that does not enter (a plugin beneath refused it, or the host
failed) is a new pain signal, `option not sent`, so you can type the reply. One band takes one press. Typing a reply still works, and clears the
band as before. An option set the fork got wrong in shape (not a list, more than three, an empty
label or text, a text over 300 characters, two recommended) is dropped whole, and the pain stands with no buttons. The bell
and the pain file list the options as text — `… · options: 1) <label> (Recommended) 2) <label>` —
so a remote operator or a herdr parent sees the choices; answering there stays a typed reply.
Labels and texts are redacted like every pain text.

**A credential (since 0.4.1).** A credential or secret you must supply or issue is never an
option. The fork asks for it in one plain-text line (where to put it, never its value), and the
other decisions in the same pain keep their options. The band shows that line after the options,
as `In plain text: <request>`, whole, and it has no button: you type the answer. A press on an
option leaves that line as a band of its own until you reply, dismiss it, or a later pain replaces
it (notices do not stack; the pain file and the bell keep the request). The bell, the pain file
and the ledger end the pain with `· in plain text: <request>`. A pain whose only decision is a
credential has no options, only the question, that line and Dismiss.

Every other pain signal (never-approve, hard
deny, loop guard, ledger failure, fork failure, a question or permission left with you) carries no
options.

## With molt

- **Mode across a molt.** molt clears a root session and writes
  `~/.claude/state/molt/lineage/<new id>.json`. autonomic copies the previous session's record
  (`~/.claude/state/autonomic/sessions/<id>.json`, `{ mode, bell?, scope, source }`), and
  announces the scope once with the first prompt. `source` is `env` (read from `AUTONOMIC_MODE`;
  unset means manual), `command` (`/autopilot on|off`), or `lineage` (carried across a molt).
- **A child's scope is its brief.** A crew child (`MOLT_HANDOFF=parent`) never molts; its
  replacement is a fresh session that takes its mode from `AUTONOMIC_MODE` and its scope from its
  brief and handoff.
- **molt keeps the turn end.** autonomic neither blocks nor forks when molt's stage file for this
  session (`~/.claude/state/molt/stage/<id>`, molt 0.2.1+) says `command`, `block` or `fallback`
  or the live fill has reached the file's `command` (molt may rewrite the file after this hook),
  when the reply carries a `MOLT-HANDOFF:` line, when `MOLT_STATUS_PATH`'s last line is
  `handoff required` or `handed-off …`, or when a plugin beneath it has already blocked the stop
  (molt's command). autonomic follows molt's stage file, so a seeded session whose ladder moved
  yields at its own handoff command. `yieldAtPercent` applies only without a stage file (molt
  absent or older, or a file that does not parse): at or above that fill every turn end is molt's.
  A stage file that says `off` (`/molt off`) turns that fallback off too.
- **molt rings its own pause.** molt reads `mode` and `bell` from autonomic's record and rings the
  bell when it pauses an autopilot root; autonomic does not ring again.

## For launchers

autonomic sets `AUTONOMIC_EFFECTIVE_MODE` (`autopilot` or `manual`) in its own process each time a
session's mode changes, so every later Bash call the session runs sees the live mode. Read it there
to decide whether a child starts in autopilot: `autopilot` marks the child; anything else, unset
included, does not. It is in memory and cannot go stale the way the session record can after a
failed write. When the host refuses the value, autonomic tries to unset the variable and shows a
toast; a launcher reads no stale mode only when the unset works (see "Limits"). autonomic never reads it: `AUTONOMIC_MODE` stays the spawn's input.

## Environment

| Variable | Read for |
|---|---|
| `AUTONOMIC_MODE` | the mode at spawn |
| `AUTONOMIC_LEDGER` | the ledger path |
| `AUTONOMIC_BELL` | the bell command (beats `bell` in `/config`) |
| `AUTONOMIC_PAIN_PATH` | the pain file |
| `MOLT_STATUS_PATH` | molt's child status file (the floor) |
| `AUTONOMIC_EFFECTIVE_MODE` | never read: autonomic sets it for launchers (above) |

## Settings

| Key | Default | Meaning |
|---|---|---|
| `policyPath` | `~/.claude/autonomic/policy.md` | the policy file |
| `bell` | unset | the bell command |
| `loopMax` | 3 | blocks in a row with no change before the loop guard |
| `tailChars` | 4000 | how much of the last reply the turn-end fork quotes |
| `yieldAtPercent` | 65 | used only without a molt stage file: context fill at or above which every turn end is molt's |
| `neverApprove` | all six rules | the never-approve rules enforced, separated by spaces or commas: `force-push default-branch-push branch-delete rm-outside no-verify unreadable` (`unreadable` matches nothing since 0.2.0). Empty means none (`/autopilot status` says so). Only these names exist. |
| `readers` | `gh pr create; gh pr edit; gh issue create; gh issue comment` | command prefixes, separated by `;`, that name a file but never run it: a reader that names a file the command just wrote does not keep that file's words for the never-approve list. Add your own, for example `herdr agent prompt`. Empty means none. `/autopilot status` lists them. |

No `/plugin configure` step is needed: every setting has a default except the optional `bell`.
A bad number falls back to its default, and an unknown `neverApprove` name is ignored;
`/autopilot status` and a toast name either.

## Failure behaviour

| Failure | Result |
|---|---|
| autonomic does not load, or a hook throws | the event passes through unchanged: the session behaves as manual |
| policy missing or empty | autopilot refuses: `autopilot: no policy` |
| ledger not writable | autopilot refuses, or drops to manual mid-run with a pain signal |
| fork fails or its reply does not parse | one retry, then pain |
| nothing to fork yet (a session's first response, just after a clear) | the event passes through; an `AskUserQuestion` goes to you |

Log: `~/.claude/state/autonomic/autonomic.log`. It holds one line per fork
(`fork <turn-end|ask|permission> session=<id>`), each failure, each pain signal and each block
beneath that stood.

## Cost

One cached fork at each autopilot turn end, and one at each `AskUserQuestion` and each `ask`
verdict not on the never-approve list. A fork re-sends the session's own last request, so its
prefix is served from the prompt cache; the ledger's `usage` field records what each one cost.

## Limits

- Two notices above the prompt do not stack: when molt and autonomic both have one, one shows; the
  other is still in the toast and the log.
- A herdr worker ping arrives as a typed prompt, so it resets the loop count, as it resets molt's
  manual pause count.
- With `AUTONOMIC_LEDGER` unset, the ledger is created at `<repo root>/.autonomic/ledger.md`. In a dual-repo
  project's public canonical, set `AUTONOMIC_LEDGER` to the AI workspace, or ignore `.autonomic/` there; a
  launcher patch (herdr-crew) is to set it per seat.
- The permission fork judges a subagent's call against the main session's transcript.
- The turn digest adds up to 4,000 characters to each permission and ask judgment. It shows a tool
  result's tail only, never its middle, and it reads a tool result as a fact, though a result can
  hold fetched text. A `/resume` to an earlier session id brings back that id's digest.
- A host that refuses every `env.set` leaves `AUTONOMIC_EFFECTIVE_MODE` at its previous value; a toast
  says it may be stale.
- A deny from a plugin that runs above autonomic is not seen; the turn-end check reports it.
- Claude Code only: Codex, OpenCode and Devin have no mod runtime.

## Tests

`bash autonomic/run-tests.sh` validates the plugin and runs the kit suites (`claude plugin test`).
