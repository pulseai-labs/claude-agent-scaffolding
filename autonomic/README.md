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
| `/autopilot status` | mode, source, scope, policy, ledger, bell, pain file, loop count |
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
ran and was not denied — the next turn end is pain ("autopilot loop"). A prompt from you resets
the count.

**`AskUserQuestion`.** The fork judges the questions. When every one has an answer that is
exactly one of its option labels, autonomic answers in your place and writes one ledger line per
question. Anything else — not covered, a label that is not an option, a fork that fails — goes to
you, and the bell rings.

**Permission asks.** autonomic acts only on an `ask` verdict; an `allow` is left alone and a
`deny` is never changed (a deny rings once per tool and reason, as "hard deny"). First, in code,
the **never-approve list** keeps the ask with you and rings:

- a force push (`-f`, `--force`, `--force-with-lease`, `--mirror`, a `+` refspec);
- a push to the default branch (`origin/HEAD`, or `main`/`master` when unknown) — an explicit
  refspec, `HEAD`, `--all`, or a bare `git push` from the default branch or an unknown branch;
- branch deletion as seat-mods reads it (`branch -D`, `-d` with force, `push --delete`, `:ref`) —
  a plain `git branch -d` is not on the list;
- `rm -r` of a path outside the worktree, or of a path autonomic cannot read (a variable, a
  quoted path, anything after a `cd`);
- `--no-verify`, or `git commit -n`.

The list reads each command segment with seat-mods' shell reader (copied, and held identical by
`tests/test-mod-shell-parity.sh`). Otherwise the fork judges the call against the policy's
permission scope: `allow` is recorded and the tool runs; anything else leaves the ask and rings.

## The ledger

One line per decision:

```
- <ISO time> · <session id> · <case> · Q: <question> · A: <answer> · why: <reason>[ · usage: in=<n> cached=<n> out=<n>]
```

Path: `AUTONOMIC_LEDGER` when set (relative to the repo root when relative), else
`<repo root>/.autonomic/ledger.md`, else `<cwd>/.autonomic/ledger.md` outside git. autonomic only
appends; the session's own commits carry the file. In a dual-repo project, point
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
  announces the scope once with the first prompt.
- **A child's scope is its brief.** A crew child (`MOLT_HANDOFF=parent`) never molts; its
  replacement is a fresh session that takes its mode from `AUTONOMIC_MODE` and its scope from its
  brief and handoff.
- **molt keeps the turn end.** autonomic neither blocks nor forks when the reply carries a
  `MOLT-HANDOFF:` line, when `MOLT_STATUS_PATH`'s last line is `handoff required` or
  `handed-off …`, or when a plugin beneath it has already blocked the stop (molt's command).
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

A bad number falls back to its default; `/autopilot status` and a toast name it.

## Failure behaviour

| Failure | Result |
|---|---|
| autonomic does not load, or a hook throws | the event passes through unchanged: the session behaves as manual |
| policy missing or empty | autopilot refuses: `autopilot: no policy` |
| ledger not writable | autopilot refuses, or drops to manual mid-run, with a toast |
| fork fails or its reply does not parse | one retry, then pain |
| nothing to fork yet (a session's first response, just after a clear) | the event passes through; an `AskUserQuestion` goes to you |

Log: `~/.claude/state/autonomic/autonomic.log`.

## Cost

One cached fork at each autopilot turn end, and one at each `AskUserQuestion` and each `ask`
verdict not on the never-approve list. A fork re-sends the session's own last request, so its
prefix is served from the prompt cache; the ledger's `usage` field records what each one cost.

## Limits

- Two notices above the prompt do not stack: when molt and autonomic both have one, one shows; the
  other is still in the toast and the log.
- A herdr worker ping arrives as a typed prompt, so it resets the loop count, as it resets molt's
  manual pause count.
- The loop guard counts any tool but a read as a change, so a loop of Bash reads is not caught.
- The permission fork judges a subagent's call against the main session's transcript.
- Claude Code only: Codex, OpenCode and Devin have no mod runtime.

## Tests

`bash autonomic/run-tests.sh` validates the plugin and runs the kit suites (`claude plugin test`).
