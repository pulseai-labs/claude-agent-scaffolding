# herdr-crew

The orchestrator/worker session model over herdr. One prose skill, no runtime library.

One orchestrator session keeps its context for decisions and dispatches everything else
to worker sessions launched by seat name through herdr — the seats defined in the
operator's own files, not in this plugin. A planned-work seat and a bounded-work seat
implement by complexity class, one reviewer seat runs `/code-review` once per PR and
returns its findings through its report file, the retained implementer works GitHub
threads to zero, and the merge waits for the operator's word.

Every herdr command's syntax comes from `herdr --skill`, the binary's own
version-matched guide. This plugin states what a seat is and who does what; it does not
re-type the guide. `skills/orchestrate/references/herdr-mechanics.md` is the one file
that records the mechanics the guide cannot state or defaults differently — the launch,
the two readiness paths, the send and its turn-start check, the waits, completion,
placement, teardown, and machines — and it wins where the two differ.

## What ships

| Surface | What it carries |
|---|---|
| `orchestrate` (the skill) | The orchestrator session's playbook: the delegation floor and its decidable test, the role list, the run by reference, the briefs, the ossify seam, and the refusals. |
| `references/herdr-mechanics.md` | The mechanics `herdr --skill` cannot state: the seat launch and its placement, the two readiness paths, the typed wait, the turn-start check on a send, the report-file doorbell, teardown, and machines. It overrides the guide's default placement. |
| `references/roles.md` | The role table and the seats that fill it, the launch sequence, retention, the session budget, placement for the dual-repo case, and the writers rules. |
| `references/lifecycle.md` | The thirteen-step run, the operator's own roles and the named points they run at, and rotation past the context ceiling. |
| `references/config.md` | The operator's two files, the agent entries and their fields, the resolved profile and where each value travels, the project file's three sections, and what happens when a file is missing. |
| `references/briefs.md` | Nine dispatched brief templates — the generic five (planned implementer, fast implementer, reviewer, verifier, fix round) and the four dedicated dispatch templates the ossify dispatches use (lane driver, doctor dispatch, direct work-item, non-spine close) — plus the correction-request message template, which is a send and not a session; the file's header states the whole-contract rule and the dispatch matrix. |
| `references/ossify-execution.md` | The spine execution-assignment contract: the four activation facts, the seats and the layers that own them, the approved block injected into the spine session's brief, and the three fixed procedures. |
| `references/ossify-nested-run.md` | The activated spine's nested run: the required worker depth, the nested `run.json`, the round procedure and its gate, the close, and rotation. |
| `references/ossify-pr-briefs.md` | The two PR-lane briefs: the close session's, and the work-PR session's with the merge bind and its return shapes. |
| `references/ossify-briefs.md` | The four blocks an activated spine's dispatches need: the spine session's brief, the item implementer's, the item verifier's, and the correction message to a live implementer. |
| `references/ossify-close-writer.md` | The close-review writer: one per affected hosting repo at a `halted: close-review`, a profile the operator names at the halt rather than a project-file seat. |

## Command

| Command | Skill |
|---|---|
| `/herdr-crew:orchestrate [objective]` | `orchestrate` |

## The delegation floor

The orchestrator's own turns take these kinds of action, and no others: single-command
probes; writing briefs, dispositions, and the handoff; reading the seats' report files;
deciding; conversing with the operator and the workers; executing single authorized
mutations. If an answer needs more than one command's output, it is dispatched to a
verifier session.

## Roles

| Role | Seat | Class |
|---|---|---|
| Orchestrator | this session — the operator launches it | |
| Implementer, planned | a seat the project file names | `contract`, and the default when unclassified |
| Implementer, fast | a seat the project file names | `bounded` |
| Reviewer | a seat with `slash-commands`, `/code-review <PR>` once | |
| Verifier | a seat the project file names — the work-item verify; read-only probes and mechanical runs may take a lighter one. Read-only | |
| Operator | the human: the merge word | |

Seats are names the operator's two configuration files define — `references/config.md` is
the authority. The skill never substitutes `claude --model`.

## Session budget

One implementer seat and one verifier seat per work item; one reviewer per PR. A fix
round may re-use the verifier seat, and a context-rotation replacement occupies the seat
it replaces. Beyond those, the budget admits three kinds of seat: a role the operator
declares in the project file, for that role's dispatch only and against the allowance the
file declares; a `doctor session`, one per `/ossify:doctor` dispatch, released on return;
and, on an activated spine, the four seats below. Any other session is a planning defect,
and the orchestrator stops to re-plan the item. The authority is the skill's
`references/roles.md`. The implementer is retained across consecutive work items until it
passes half its context window (checked by `/context` at each task boundary for a seat
that can answer the probe — one that cannot rotates at its item boundary instead,
`references/roles.md`) or the harness auto-compacts; the next item starts fresh with the
handoff the orchestrator writes from the inputs in its report file. An activated spine adds
four seats outside that budget
— the spine session, a close session, one work-PR session per returned PR, and a
close-review writer.

## With ossify

ossify's ceremonies (`start`, `adopt`, `plan-release`, `plan-spine`, `wayfinder`,
`challenge`, `handoff`, `handoff-resume`) run in the orchestrator session. Its execution
lanes (`run-spine`, `work-item`, `close`, `work-pr`, `doctor`) are dispatched to herdr
sessions. No ossify contract changes.

`run-spine` is dispatched on its own by default. When this session has just planned the
spine — and only then; installation, an environment variable, or a project file found on
disk activate nothing — the phase in `references/ossify-execution.md` applies instead:
the operator approves one implementer and one verifier seat per work item plus the
coordinator seats, the set is injected into one spine session's brief, and that session
launches a fresh tab and pane per item seat — the implementer and the verifier each in
its own tab. Only the top talks to the operator; every other seat asks upward, one hop
per layer, in its report file, and every dispatched session returns a checkable artifact
— a PR list, a ledger comment id, a merge SHA — never narrative.

## Placement

One tab per seat and one full-size pane per tab: herdr-crew places a seat with
`herdr tab create` and **never `pane split`**, because panes sharing a tab make a
multi-agent screen unreadable. That overrides `herdr --skill`, whose "Start and
coordinate an agent" defaults to a sibling split in the current tab — a seat reading
that guide does not split. A run of five seats is five readable tabs. The orchestrator
stays in the pane the operator launched it in, and herdr-crew does not move it.

## Readiness and completion

**Readiness is derived, never declared.** herdr answers live which path a seat takes:
whether `herdr agent list` returns a record for the pane. A seat herdr detects waits on
a typed agent state; a seat it does not (an `mcode-*` lane, with no detection manifest)
waits on a screen pattern. A detection manifest landing later therefore moves a seat to
the typed path with no edit anywhere.

**Completion is a report file.** herdr's typed state carries no body, so the file at the
`REPORT_PATH=` the brief names is the contract and the state is only the doorbell. A
coordinator seat — a spine session, a work-PR session, or a `run-spine` lane driver, each
running work of its own in the background — reads ready before its report exists, so it is
waited on through its report file directly. The top is not waited on: it is the one that
waits, and it has no report file of its own. Every file a run keeps is placed outside every
seat's worktree, so removing a worktree never takes one.

**Every wait is one call that returns once** — a background call where the host has one,
the wait in the foreground inside that host's cap where it does not — never a loop, and
never a re-entry after an empty timeout. A round of N parallel items is N such waits, one
per pane, each waking the session when it exits; the round's barrier closes when every
item's report file is in hand.

## The run's state

A run's state lives in a dagr `run.json` the plugin's prose owns and no binary writes.
**Binding** an existing one is naming its path, and one run
is one file per objective. **Creating** one is dagr's producer contract — a temp-file
write, `dagr check --strict`, then the rename (`references/lifecycle.md`, step 1). The top
binds the run's file; a spine session creates a nested one of its own, which keeps item
traffic out of the top's.

## Context ceiling

One fail-open hook, gated on `HERDR_PANE_ID`, tells a seat in a herdr pane its own context
figure once it reaches the `context_ceiling` setting (default 500000 tokens): finish the
unit in hand and start no new one, and a coordinator seat rotates at the next boundary. It
never allows, denies or asks, it is inert outside a herdr pane, and it reports the figure as
unavailable rather than guessing when it cannot read it. The rotation itself is prose, in
`references/lifecycle.md`. That hook is the only deterministic code a run executes: a run
has **no `lib/`, no state directory, no parser** — `agents.md` and `roles.md` are read as
prose and nothing parses them. The suites and the eval harness under `tests/` are
build-and-test tooling; the plugin never runs them on a user's path.

## Configuration

Two operator-owned markdown files, read as prose — nothing parses them.
`~/.claude/herdr-crew/agents.md` is the machine file: the agents this machine can
launch, one block each, with the field table in `skills/orchestrate/references/config.md`
saying what each means and where it travels. `<project root>/.herdr-crew/roles.md` is the
project file: which agent fills each role, the operator's own roles, and the conditions
that choose between seats — it wins for anything it names. With neither file the
session's own work needs no setup, and the first delegated dispatch halts naming the file
to add; a seat name neither defines halts the run.

Only those two paths are read. The ones orca-crew used resolve to nothing here —
the project file is found by walking up from the session's working directory
looking for `.herdr-crew/roles.md`, and the machine file has one fixed path — so
migrating is a copy of the two files to the paths above. orca-crew itself is
unmodified by this release and stays installed until the fleet has moved.

**DeepSeek Harness seats.** A spine's `spine session` and `close session` seats can name a
`kind: dsh-spine-driver` agent: a dsh session the top spawns and watches through dsh-crew's
`dsh-session` skill, whose items take their routes from `.dsh-crew/roles.md`.
`references/dsh-driver.md` is the contract.

## Requirements

- herdr 0.9.1 or later, running — **and the orchestrator session itself running inside one
  of its panes**: the context-ceiling hook is gated on `HERDR_PANE_ID`, and every seat is
  placed relative to the pane the operator launched this session in.
- The **`herdr-dagr`** plugin's `dagr` binary on PATH, to create and lint the run's
  `run.json`: dagr's producer contract resolves that validator *before* anything is
  written, and with none available the run starts no run file — not an unvalidated one.
- `jq` on PATH for the context-ceiling hook; without it the hook reports the figure as
  unavailable.
- The agents named in `~/.claude/herdr-crew/agents.md` resolvable where their pane
  runs; one that is not shows `command not found` and stops that dispatch.
- The `/code-review` skill available to the reviewer session. If it is unavailable, the
  reviewer reports that in its report file and the operator decides.
- The target repository's ruleset requires conversation resolution before merge, so
  GitHub itself refuses a merge while any review thread is open.

## Tests

```bash
bash herdr-crew/run-tests.sh
```

Six suites: frontmatter and invocation posture across the three surfaces; five fidelity
pins, each exactly once; the herdr mechanics contract; the config contract, including the
sweep for a personal name across the shipped prose surfaces; the ossify spine-execution
contract; and the context-ceiling hook's behaviour at its interface. A session-driven
eval harness for the spine-execution surface lives under `tests/eval/` and is run by hand
from its RUNBOOK — the runner does not execute it.
