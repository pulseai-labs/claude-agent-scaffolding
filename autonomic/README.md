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

```markdown
# Autopilot policy (autonomic)

You are in autopilot. The operator planned this work and is not watching. Keep the run going, and do not ask for a confirmation that the planning already gave.

## Standing orders

- When the spec, the plan, the grill record or your brief already decides a choice, take that option and state it in one line. Do not end a turn on "Shall I proceed?" or "Which first?" in that case.
- Merge authority: once a pull request has passed its work-pr or merge-bar loop, the orchestrator merges it without asking.
- When a step is done, start the next step of the plan.

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
| `pain` | A reason on the pain list | lets it stop; pain signal, ledger line |

The host shows a block as `Stop hook error: <reason>`; the model reads it as an instruction.
After `loopMax` (3) blocks in a row with no change made — no tool call other than a read that
ran, was not denied and was not read-only (`ls`, `git status`) — the next turn end is pain ("autopilot loop"). A prompt from you resets
the count.

**`AskUserQuestion`.** The fork judges the questions. When every one has an answer that is
exactly one of its option labels, autonomic answers in your place, tells the model it did and why,
and writes one ledger line per question. A question with no options (free text) always goes to you. Anything else — not covered, a label that is not an option, a fork that fails — goes to
you, and the bell rings.

**Permission asks.** A `deny` is never changed (a deny rings once per tool and reason, as "hard
deny"; a deny from a plugin beneath autonomic's `tool.call` hook, such as a seat guard, rings the
same way). On an `ask` verdict, first, in code, the **never-approve list** keeps the ask with you
and rings. On an `allow` verdict — bypass permissions, or a settings allow rule — a command that
matches the list becomes an `ask`, so you get the normal permission dialog, and it rings (the
**bypass floor**; see "Permission modes"). The list:

- a force push (`-f`, `--force`, `--force-with-lease`, `--mirror`, a `+` refspec);
- a push to the default branch (`origin/HEAD`, or `main`/`master` when unknown) — an explicit
  refspec, `HEAD`, `--all`, or a bare `git push` from the default branch or an unknown branch;
- branch deletion as seat-mods reads it (`branch -D`, `-d` with force, `push --delete`, `:ref`) —
  a plain `git branch -d` is not on the list;
- `rm -r` of a path outside the worktree, or of a path autonomic cannot read (a variable, a
  quoted path, anything after a `cd`);
- `--no-verify`, or `git commit -n` (a cluster such as `-nm` or `-uf` is read flag by flag);
- a push whose remote, refspec or flag is quoted or a variable — `git push origin "$BRANCH"` and
  `git push -u origin "$(git branch --show-current)"` included, even to a feature branch: autonomic
  cannot see what the shell will expand, so it does not guess;
- a command the reader cannot follow — led by `bash`/`sh -c`, `eval`, `xargs`, `timeout`, `nice`, `find`, `ssh` and the like, an interpreter (`python3`, `node`, `perl`, `ruby`, `php`, `awk` …), a git global it cannot skip (`--git-dir .git` spelled without `=`, `-c alias.…`), a wrapper with options (`sudo -u`, `env -i`), or a backtick or `$(` outside quotes — when it names `push`, `rm`, `branch`, `commit` or `--no-verify` at all. A `$(…)` or backtick inside double quotes is read as a command of its own.

Each item on the list is a rule you can turn off: `neverApprove` (below) names the enforced
rules — `force-push`, `default-branch-push`, `branch-delete`, `rm-outside`, `no-verify`,
`unreadable` (the last three items above). A rule you remove is the fork's to judge on an ask, and
is left alone on an allow. A repo whose default branch takes direct pushes by design removes
`default-branch-push`.

A unique prefix of a long option is read as that option (`--forc` is `--force`, `rm --recurs` is `--recursive`), as git and GNU tools accept it. A word with a backslash, a quote inside it or a brace (`pu\sh`, `pu""sh`, `{main,x}`) is unreadable when the command may name a danger, and an `rm -r` path with a brace or a glob on a dot name (`.?`, `.*`) counts as outside the worktree. `--repo` names the remote, and `@` is `HEAD`. A wildcard destination (`refs/heads/*`) may be the default branch, refspecs after `--` are checked for `+` and `:`, and a bare push through `git -C` or `cd` into a directory other than the session's own or the repo root reads the branch as unknown (a nested repo or submodule). A wrapper that runs a program (`setsid`, `stdbuf`, `flock`, `taskset`, `chroot` …) is a runner, a short-flag cluster is split up to the option that takes a value (`-nF/tmp/m` is `-n -F`), and `git send-pack` and `git http-push` are unreadable pushes. A path-qualified wrapper (`/usr/bin/env`) and the builtins `coproc`, `builtin` and `trap` are runners, an unquoted heredoc holding `$(` or a backtick is unreadable, `rm` operands after `--` are paths whatever they start with, and the matching refspec `:` may update the default branch. A danger the command text does not show — a git alias defined in config, a script file — is not seen.

The list reads each command segment with seat-mods' shell reader (copied, and held identical by
`tests/test-mod-shell-parity.sh`). Otherwise the fork judges the call against the policy's
permission scope: `allow` is recorded and the tool runs; anything else leaves the ask and rings. The list applies to any tool whose input has a `command` (Bash, Monitor). A call whose input is longer than the fork is shown (4000 characters) stays an ask and rings. `AskUserQuestion` and `ExitPlanMode` are never approved here: their permission prompt is your own dialog.

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
- **What the floor guards against:** a cooperative model writing a dangerous command in a plain
  form, judged from the command text alone. A deliberately disguised spelling (`git pu{s..s}h`, a
  `-c remote.<name>.push=` setting, a git alias in config) can pass it, and so can a danger only
  the filesystem shows (`rm -rf /repo/link/x` where `link` points outside the worktree).
- **What a never-approve match records.** The ledger line and every pain signal carry the
  command's *shape* — verbs, a git subcommand and flag names, with every value only counted
  (`git push -f https://u:TOKEN@… feat/x` is `git push -f (+2 args)`, an assignment is `NAME=`) — so no credential is
  written, however it is spelled; a command name outside a known list shows as `?`, and a flag
  outside a known list as `-?`. The
  permission dialog shows you the whole command.
- **Credentials** in other ledger lines (URL user info, `*_TOKEN=…`, `--token …`, Authorization,
  Bearer and other key, token, secret or cookie header values, bare or quoted, and known token
  shapes) are redacted before any ledger line, notice, toast, bell or pain file.

## The ledger

One line per decision:

```
- <ISO time> · <session id> · <case> · Q: <question> · A: <answer> · why: <reason>[ · usage: in=<n> cached=<n> out=<n>]
```

Path: `AUTONOMIC_LEDGER` when set (relative to the repo root when relative), else
`<repo root>/.autonomic/ledger.md`, else `<cwd>/.autonomic/ledger.md` outside git. autonomic only
appends; the session's own commits carry the file. The cases are `covered`, `stalled`, `done`,
`pain` (the turn end), `ask` (an `AskUserQuestion` answered), `permission` (an ask allowed, or a
never-approve match kept with you), and `molt` — the turn end is molt's handoff, and autonomic let
it stop (`why: molt owns this turn end`). In a dual-repo project, point
`AUTONOMIC_LEDGER` at the AI workspace. A ledger that cannot be written ends autopilot, and the
decision that could not be recorded is not taken.

## Pain

The list lives in the policy file (default above). A pain signal is:

- a band above the prompt, with a Dismiss button;
- a toast;
- the bell: `bell` in `/config`, or `AUTONOMIC_BELL` on a spawn, run as a shell command with
  `AUTONOMIC_MESSAGE` set to one line — for example `curl -d "$AUTONOMIC_MESSAGE" ntfy.sh/<topic>`;
- a line `<ISO time> pain <text>` appended to `AUTONOMIC_PAIN_PATH`, when a launcher sets it, so a
  worker's pain reaches its parent.

A pain signal never resumes the run by itself. Your next prompt does.

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

## Environment

| Variable | Read for |
|---|---|
| `AUTONOMIC_MODE` | the mode at spawn |
| `AUTONOMIC_LEDGER` | the ledger path |
| `AUTONOMIC_BELL` | the bell command (beats `bell` in `/config`) |
| `AUTONOMIC_PAIN_PATH` | the pain file |
| `MOLT_STATUS_PATH` | molt's child status file (the floor) |

## Settings

| Key | Default | Meaning |
|---|---|---|
| `policyPath` | `~/.claude/autonomic/policy.md` | the policy file |
| `bell` | unset | the bell command |
| `loopMax` | 3 | blocks in a row with no change before the loop guard |
| `tailChars` | 4000 | how much of the last reply the turn-end fork quotes |
| `yieldAtPercent` | 65 | used only without a molt stage file: context fill at or above which every turn end is molt's |
| `neverApprove` | all six rules | the never-approve rules enforced, separated by spaces or commas: `force-push default-branch-push branch-delete rm-outside no-verify unreadable`. Empty means none (`/autopilot status` says so). Only these names exist. |

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
- A deny from a plugin that runs above autonomic is not seen; the turn-end check reports it.
- Claude Code only: Codex, OpenCode and Devin have no mod runtime.

## Tests

`bash autonomic/run-tests.sh` validates the plugin and runs the kit suites (`claude plugin test`).
