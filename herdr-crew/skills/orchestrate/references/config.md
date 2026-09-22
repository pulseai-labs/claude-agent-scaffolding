# Configuration

Every seat a run uses, and every value in its profile, is a value the operator
edits, not a fact the plugin hard-codes. herdr-crew ships no agents of its own: a coordinator reads
two markdown files the way it reads any other file, and nothing anywhere parses them.

## The two files

`~/.claude/herdr-crew/agents.md` is the machine file — the agents this machine can
launch. It is written by the operator, with an agent's help, between runs and never
edited during one, and nothing in it is project-specific.

`.herdr-crew/roles.md` sits at the project root — which agent fills each role for the
work at hand, plus the conditions that choose between seats. The orchestrator writes
it on the operator's instruction at spine planning, and the operator approves it
before use. It names agents by name, never by command, so no machine detail reaches a
repo. For a dual-repo project the project root is the AI workspace, which is where
orchestrators launch; for a single-repo project it is that repo.

Resolution is a walk up from the session's working directory: the first project file
found on that walk is the one in force. The pairing manifest is not consulted —
its absolute roots are wrong on this host.

The project file wins for anything it names — a seat, an extra role, a condition; it
never redefines how an agent is launched. Workers never read either file — a brief is
the whole contract a worker sees.

## Agent entries

The machine file is one block per agent, named by a `###` heading:

```markdown
### fast-coder
command: <the launch command on this machine — an alias, a binary, flags and all>
expected_model: <the model id its banner or screen must show>
effort: <the effort it runs at — the embedded flag's value, or (agent default)>
model_shows: banner
brief_delivery: inject
can: slash-commands

### devin-impl
command: devin-implementer --effort max
expected_model: <the model id its banner or screen must show>
effort: max
model_shows: screen
brief_delivery: inject
can: —
note: the seat guard only arms through this launcher; never define a bare `devin` agent

### mcode-glm
command: mcode-glm
expected_model: <the model id its banner or screen must show>
effort: (agent default)
model_shows: screen
brief_delivery: file
can: —
```

Each field exists because a measured case needs it:

- `command:` — the exact command run in the seat's pane.
- `expected_model:` — the model id the seat must show where `model_shows` reads
  it, and the only source for a brief's `SEAT_EXPECTED_MODEL` — never parsed out
  of `command:`. A `--model` flag in the command must agree; a disagreement is a
  config defect named at approval, never reconciled at launch.
- `effort:` — the effort the seat runs at, and the only source for a brief's
  `SEAT_EFFORT` — the embedded flag's value, or the operator's declaration
  (`(agent default)` when the seat just runs its own).
- `model_shows:` — where the launched model is verified, both read with `herdr
  pane read`: `banner` the emitted stream; `screen` the rendered screen — a
  status-bar agent returns nothing on the default read.
- `brief_delivery:` — `inject` is the ordinary dispatch; `file` writes the brief to
  a file and sends one line pointing at it, for an agent whose composer fragments injects.
- `can:` — what the agent is able to run, comma-separated: `slash-commands`,
  `subagents` (the lane's `Agent`-tool workers), or `—`. The per-role requirement
  is in the resolved-profile table below, checked at approval, never at dispatch.
- `note:` — free prose the coordinator reads when it uses that agent.

A seat's readiness path is never a field here: it is derived by asking `herdr
agent list` whether the pane is detected — detected waits on a typed state
(`herdr agent wait`), undetected waits on a screen pattern (`herdr pane
wait-output`). So a detection manifest landing later upgrades a seat from the
screen path to the typed path with no edit anywhere.

## What a resolved profile carries

An agent name resolves through the machine file to a **profile** — the values a
launch needs. This table is the contract for which travels where: every surface
carrying a profile conforms rather than restating a field list.

| field | set by | consumed at | travels |
|---|---|---|---|
| `command:` | the machine entry | `pane run` | every resolved profile |
| `expected_model:` | the machine entry | the model read, and the worker's own check | every resolved profile |
| `effort:` | the machine entry | the launch | every resolved profile |
| `model_shows:` | the machine entry | the model read | every resolved profile — the launching session never opens this file |
| `brief_delivery:` | the machine entry | the brief's delivery | every resolved profile |
| `can:` | the machine entry | the seat's approval | never — checked where a seat is approved |
| `note:` | the machine entry | the coordinator's read | never |

A resolved profile renders as one row wherever it travels:

`<command> | model: <expected model> | effort: <effort> | model_shows: <banner|screen> | brief_delivery: <inject|file>`

A brief's record of its own seat's launch is the row's first three values only —
a session launches nothing with its own profile.

`can:` is checked where a seat is approved — the project-file approval, the
spine-seat approval, the PR-transition ask, the close-review halt ask — never at
dispatch. The requirement is per role: a role whose shipped or declared brief invokes a slash command needs
`can: slash-commands` on the agent that fills it.

| role | its brief invokes | needs |
|---|---|---|
| reviewer | `/code-review` | `slash-commands` |
| implementer, verifier | no command | — |
| fix-round implementer | `/ossify:work-pr` when ossify is installed | `slash-commands` then |
| ossify item implementer | `/ossify:work-item` | `slash-commands` |
| item verifier | no command | — |
| spine session, default lane | `/ossify:run-spine`; spawns `ossify:implementer-agent` subagents through the `Agent` tool | `slash-commands, subagents` |
| spine session, external-executor lane | `/ossify:run-spine` | `slash-commands` |
| close session | `/ossify:close` | `slash-commands` |
| work-PR session | `/ossify:work-pr` | `slash-commands` |
| doctor session | `/ossify:doctor` | `slash-commands` |
| PR-fix seat inside work-PR | none — the clause is removed | — |
| close-review writer | no command | — |
| an operator-defined role | whatever its `brief:` invokes | as declared |

## The project file

Three sections. `## Seats` is a table of role, agent name and when:

```markdown
## Seats

| Role | Agent | When |
|---|---|---|
| orchestrator | <this session's seat> | |
| implementer | strong-coder | default |
| implementer | fast-coder | the item is one file, mechanical, or read-only |
| verifier | strong-coder | |
| reviewer | sonnet-review | every PR |
| spine session | strong-coder | |
```

`## My roles` holds the operator's own roles as blocks (next section). `## Conditions`
is free text: conditions are sentences the coordinator reads when it picks a seat, and
nothing parses them. The plugin ships the role list — orchestrator, implementer,
verifier, reviewer and the coordinator seats (spine session,
close session, work-PR session), plus a `doctor session` for `/ossify:doctor`
dispatches; the project file fills them and does not define new
built-ins. The close-review writer is not a project-file seat — the operator names
its profile at the halt that creates it (`ossify-close-writer.md`).

## Roles of the operator's own

A role under `## My roles` is a block:

```markdown
### security-audit
at: before-merge-ask
agent: sonnet-review
blocks: yes
brief: ./briefs/security-audit.md
```

- `at:` places the role at a named point of the run (`lifecycle.md`):
  `after-implementer`, `before-review`, `after-disposition`, `before-merge-ask`,
  `at-teardown` — or `at: on-demand`, with no fixed point, dispatched when wanted.
- `agent:` — the seat name the role launches on.
- `blocks:` — `yes` holds the run at its point until the role passes or the operator
  overrules it; anything else it returns is advice the orchestrator records.
- `brief:` — the file the coordinator sends as that role's brief.
- `replaces:` — hands the role a step the plugin owns; the valid targets are
  `implementer`, `verifier`, `reviewer` only. The named seat is not launched for
  that run — the operator's role runs at the step's point in its place, and the
  handoff states the step was the operator's, so no reader infers a guarantee not
  given. The merge ask, teardown and the coordinator's decisions are not
  replaceable; a spine's seats need none — each is already the operator's choice.

On-demand seats cost sessions: the project file says how many may exist at once, the
default is one, and anything beyond the declared number is a planning defect.

## When a file is missing

What the session does itself — reading, planning, the ceremonies it runs in its
own context — needs no setup in any state: every role falls back to the agent this session is already running, and herdr-crew works on install. Delegation meets each state's missing half — a session cannot recover its own launch command, so the first delegated dispatch halts; which file it names depends on what exists:

- Neither file — the machine file and the one entry to add, in the shape above.
- Machine file only — agent names have launch details but no role mapping; it
  names the project file and the `## Seats` section to add.
- Project file only — roles name agents nothing resolves; it names the
  machine file and the entry to add.

A run never writes machine-level configuration itself. A name the files do not
define is never guessed — a seat name that neither file defines halts the run
and is reported, exactly as a missing alias did.
