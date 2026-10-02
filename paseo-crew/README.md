# paseo-crew

The orchestrator/worker session model over Paseo. One prose skill, no runtime library.

One orchestrator session keeps its context for decisions and dispatches everything else
to worker sessions launched by seat name as Paseo subagents — the seats defined in the
operator's own files, not in this plugin. A planned-work seat and a bounded-work seat
implement by complexity class, one reviewer seat runs `/code-review` once per PR and
returns its findings through its report file, the retained implementer works GitHub
threads to zero, and the merge waits for the operator's word.

Every Paseo command's syntax comes from Paseo's own `paseo` skill, the MCP tool
descriptions, and `paseo <cmd> --help`. This plugin states what a seat is and who does
what; it does not re-type that guide. `skills/orchestrate/references/paseo-mechanics.md`
is the one file that records the mechanics the guide cannot state or sets a default
paseo-crew overrides — the seat launch and its placement, the completion loop and its
attention states, the send, teardown and the cascade, and the handoff — and it wins where
the two differ.

## Requirements

- **Paseo 0.10.2 or later**, running, with its MCP server attached to the orchestrator
  session.
- **This session is itself a Paseo agent** (`PASEO_AGENT_ID` set): the context-ceiling
  hook is gated on it, and every seat is launched as this session's own subagent, drawn in
  Paseo's subagent track.
- **Seat profiles in `daemon.agentProfiles`**, managed by the operator outside every repo
  (through draco28/draco-dotfiles or equivalent) and read by every session with
  `list_profiles`. paseo-crew never writes a profile.
- The **`dagr`** binary on PATH, to create and lint the run's `run.json`: dagr's producer
  contract resolves that validator *before* anything is written, and with none available
  the run starts no run file — not an unvalidated one.
- `jq` on PATH for the context-ceiling hook; without it the hook reports the figure as
  unavailable.
- **ossify**, for the spine paths (`run-spine`, `work-item`, `close`, `work-pr`,
  `doctor`) — required only where those are dispatched.
- **dsh-crew**, only when a spine's `spine session` or `close session` seat names a
  `kind: dsh-spine-driver` agent (`references/dsh-driver.md`); no other seat needs it.
- The `/code-review` skill available to the reviewer session. If it is unavailable, the
  reviewer reports that in its report file and the operator decides.
- The target repository's ruleset requires conversation resolution before merge, so
  GitHub itself refuses a merge while any review thread is open.

## Setup

Two operator-owned markdown files, read as prose — nothing parses them.

Write `.paseo-crew/roles.md` at the project root — the project file, which agent fills
each role for the work at hand, plus the conditions that choose between seats. For a
dual-repo project the project root is the AI workspace; for a single-repo project it is
that repo. If the file is absent and an earlier crew's project file exists at the same
walked-up path, the orchestrator offers a one-time copy (`references/config.md`'s
Migration) — every agent name in it is checked the same way a seat name is resolved, so a
name that is not a Paseo profile or a `kind: dsh-spine-driver` entry still halts.

Put a `can:` sentence in each profile's `notes` — the sentence a role's approval reads to
confirm the seat may run the slash command its brief invokes (`/code-review`,
`/ossify:run-spine`, and so on). Every draco-desk profile's notes already state it.

**Remove Paseo's `paseo-handoff` from `agents.skills.selection`, and remove its installed
copies from `~/.claude/skills` and `~/.agents/skills`.** Deselecting it alone is not
enough — Paseo does not remove an already-installed skill's copies on a `paseo reload`,
so both steps are needed. The reason to remove it at all: `paseo-handoff` builds a
subagent tree on handoff, and paseo-crew's own handoff (`references/paseo-mechanics.md`'s
Handoff) launches its successor detached and verifies it has no parent for exactly that
reason.

A profile with no `model` launches on its provider's default model id, read from
`list_models`; an operator who wants a seat pinned to a specific model adds `model` to
that profile rather than relying on the default. Every profile a seat names must carry
`modeId`: Paseo refuses a launch whose mode the target provider does not offer, so a profile
without one halts the first launch rather than picking a mode for it
(`references/paseo-mechanics.md`, The seat launch).

## What ships

| Surface | What it carries |
|---|---|
| `orchestrate` (the skill) | The orchestrator session's playbook: the delegation floor and its decidable test, the role list, the run by reference, the briefs, the ossify seam, and the refusals. |
| `references/paseo-mechanics.md` | The mechanics Paseo's own guide cannot state: the seat launch and its placement, the two gaps in the profile-to-`create_agent` map, the completion loop with its `report` exit and four attention exits, the finish notice as a hint, the heartbeat backstop, sending a seat a message, the `/context` probe, teardown and the cascade, and the handoff. It overrides the guide's default where the two differ. |
| `references/roles.md` | The role table and the seats that fill it, the launch sequence, retention, the activated-ossify-spine exception, the session budget, placement for the dual-repo case, and the writers rules. |
| `references/lifecycle.md` | The thirteen-step run, the operator's own roles and the named points they run at, and rotation past the context ceiling. |
| `references/config.md` | The seat sources — Paseo profiles and the optional dsh-only machine file — the profile field map, the resolved-profile row and where each value travels, the project file's three sections, and what happens when a file is missing. |
| `references/briefs.md` | Nine dispatched brief templates — the generic five (planned implementer, fast implementer, reviewer, verifier, fix round) and the four dedicated dispatch templates the ossify dispatches use (lane driver, doctor dispatch, direct work-item, non-spine close) — plus the correction-request message template, which is a send and not a session; the file's header states the whole-contract rule and the dispatch matrix. |
| `references/ossify-execution.md` | The spine execution-assignment contract: the four activation facts, the seats and the layers that own them, the approved block injected into the spine session's brief, and the three fixed procedures. |
| `references/ossify-nested-run.md` | The activated spine's nested run: the required worker depth, the nested `run.json`, the round procedure and its gate, the close, and rotation. |
| `references/ossify-pr-briefs.md` | The two PR-lane briefs: the close session's, and the work-PR session's with the merge bind and its return shapes. |
| `references/ossify-briefs.md` | The four blocks an activated spine's dispatches need: the spine session's brief, the item implementer's, the item verifier's, and the correction message to a live implementer. |
| `references/ossify-close-writer.md` | The close-review writer: one per affected hosting repo at a `halted: close-review`, a profile the operator names at the halt rather than a project-file seat. |
| `references/dsh-driver.md` | The dsh spine driver: an agent of `kind: dsh-spine-driver` filling a spine's `spine session` and `close session` seats, carried byte-identical from its source plugin apart from the plugin name (`tests/test-paseo-crew-parity.sh`). |

## Command

| Command | Skill |
|---|---|
| `/paseo-crew:orchestrate [objective]` | `orchestrate` |

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
the authority. The skill never substitutes a guessed provider or model.

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
lanes (`run-spine`, `work-item`, `close`, `work-pr`, `doctor`) are dispatched to Paseo
sessions. No ossify contract changes.

`run-spine` is dispatched on its own by default. When this session has just planned the
spine — and only then; installation, an environment variable, or a project file found on
disk activate nothing — the phase in `references/ossify-execution.md` applies instead:
the operator approves one implementer and one verifier seat per work item plus the
coordinator seats, the set is injected into one spine session's brief, and that session
launches a fresh subagent per item seat. Only the top talks to the operator; every other
seat asks upward, one hop per layer, in its report file, and every dispatched session
returns a checkable artifact — a PR list, a ledger comment id, a merge SHA — never
narrative.

## Readiness and completion

**There is no readiness wait.** `create_agent` returns an agent that has already taken
its brief as `initialPrompt`; there is no TUI, and no typed state to wait on before
sending it anything.

**Completion is a report file.** A seat's result is the file at the `REPORT_PATH=` its
brief names; Paseo's typed status carries no body, so the file is the contract and the
status is only the doorbell. The orchestrator writes one background wait per dispatch —
Claude Code's Bash tool with `run_in_background` — that polls inside itself and returns
once, on the report, or on one of four attention exits: a pending permission, continuous
idle past the brief's `SETTLE_WINDOW` with no report, an error or closed status, or the
dispatch's `TIME_BUDGET` exceeded. A round of N parallel items is N such waits, one per
seat, each waking the session when it exits — never a loop, and never a re-entry after an
empty timeout. Paseo's `notifyOnFinish` notice is a hint only: it fires once, on the
seat's first idle, and is lost on a daemon restart, so a heartbeat backstop re-arms a lost
wait while any dispatch is live.

## The run's state

A run's state lives in a dagr `run.json` the plugin's prose owns and no binary writes.
**Binding** an existing one is naming its path, and one run
is one file per objective. **Creating** one is dagr's producer contract — a temp-file
write, `dagr check --strict`, then the rename (`references/lifecycle.md`, step 1). The top
binds the run's file; a spine session creates a nested one of its own, which keeps item
traffic out of the top's.

## Context ceiling

One fail-open hook, gated on `PASEO_AGENT_ID`, tells a seat in a Paseo agent its own
context figure once it reaches the `context_ceiling` setting (default 500000 tokens):
finish the unit in hand and start no new one, and a coordinator seat rotates at the next
boundary. Any JSON number of 1 or more is taken as the ceiling, and a context figure is a whole
number of tokens, so a fractional setting takes effect at the next whole token — 100000.5
fires at 100001 — while a value below 1, or a spelling that is not a JSON number, is ignored and the
default applies. It never allows, denies or asks, it is inert outside a Paseo agent, and it
reports the figure as unavailable rather than guessing when it cannot read it. The
rotation itself is prose, in `references/lifecycle.md`. That hook is the only
deterministic code a run executes: a run has **no `lib/`, no state directory, no
parser** — profiles are read through `list_profiles` and `roles.md` is read as prose;
nothing parses either. The
suites and the eval harness under `tests/` are build-and-test tooling; the plugin never
runs them on a user's path.

## The handoff

The orchestrator's own rotation **materialises its successor's profile first** — so a gap
halt leaves it the orchestrator with its waits armed — and **then stands down**: it kills
its armed waits and deletes its heartbeat, and only then launches its successor **detached**:
`env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD paseo run -d`, with the resume as the launch
prompt, so the new agent is not parented to the session standing down. `paseo inspect
<new id> --json` then confirms the successor started and `ParentAgentId` is `null`; a
failed successor is cancelled, never archived, and reported to the operator, while the
predecessor re-arms and stays the orchestrator. A
predecessor is never archived while its own seats still run — the successor shares its
workspace, and the cascade would take them.

## Known limits

- **The handoff's failure branch is fail-closed by ruling** (2026-09-27): a failed
  successor is cancelled, never archived, and reported to the operator; nothing reads
  what it started, and a successor that fails after the launch check passes is not
  watched. Those limits, and the reviewed-delta requirement's, are recorded in
  [issue #612](https://github.com/pulseai-labs/claude-agent-scaffolding/issues/612).
- **Cross-machine seats are out of scope.** Every seat runs on the daemon the
  orchestrator talks to.
- **Paseo's finish notice is one-shot upstream** (getpaseo/paseo#3875): it fires once, on
  a seat's first idle after running, and a daemon restart loses it — never the only thing
  that can wake a dispatch's wait, which is why the heartbeat backstop exists.

## Configuration

Every seat a run uses, and every value in its profile, is a value the operator edits —
through Paseo's own profile store or the project file, never a fact this plugin
hard-codes; nothing here parses either one. Paseo profiles live in `daemon.agentProfiles`
and are read by `list_profiles`. `.paseo-crew/roles.md` is the project file: which agent
fills each role for the work at hand, the operator's own roles, and the conditions that
choose between seats — it wins for anything it names. `references/config.md` names the
optional dsh-only machine file, holding `kind: dsh-spine-driver` entries only, for a
spine's `spine session` and `close session` seats (`references/dsh-driver.md`). With
neither file the session's own work needs no setup, and the first delegated dispatch
halts naming the file to add; a seat name neither defines halts the run.

## Tests

```bash
bash paseo-crew/run-tests.sh
```

Six suites: frontmatter and invocation posture across the three surfaces; five fidelity
pins, each exactly once; the Paseo mechanics contract; the config contract, including the
sweep for a personal name across the shipped prose surfaces; the ossify spine-execution
contract; and the context-ceiling hook's behaviour at its interface. A session-driven
eval harness for the spine-execution surface lives under `tests/eval/` and is run by hand
from its RUNBOOK — the runner does not execute it.
