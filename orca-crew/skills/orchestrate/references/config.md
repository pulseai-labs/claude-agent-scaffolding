# Configuration

Every seat, command, model and effort a run uses is a value the operator edits, not a
fact the plugin hard-codes. orca-crew ships no agents of its own: a coordinator reads
two markdown files the way it reads any other file, and nothing anywhere parses them.

## The two files

`~/.claude/orca-crew/agents.md` is the machine file — the agents this machine can
launch. It is written by the operator, with an agent's help, between runs and never
edited during one, and nothing in it is project-specific.

`.orca-crew/roles.md` sits at the project root — which agent fills each role for the
work at hand, plus the conditions that choose between seats. The orchestrator writes
it on the operator's instruction at spine planning, and the operator approves it
before use. It names agents by name, never by command, so no machine detail reaches a
repo. For a dual-repo project the project root is the AI workspace, which is where
orchestrators launch; for a single-repo project it is that repo.

Resolution is a walk up from the session's working directory: the first project file
found on that walk is the one in force. The pairing manifest is deliberately not
consulted — it records absolute roots from another machine and is wrong on this host.

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

- `command:` — the exact command Orca runs to open this seat's terminal.
- `expected_model:` — the model id the seat must show where `model_shows` reads
  it, and the only source for a brief's `SEAT_EXPECTED_MODEL` — never parsed out
  of `command:`. When the command carries a `--model` flag the two must agree;
  a disagreement is a config defect named at approval, never a value reconciled
  at launch.
- `effort:` — the effort the seat runs at, and the only source for a brief's
  `SEAT_EFFORT`. When `command:` embeds the flag, `effort:` records the same
  value; when it embeds none, `effort:` is the operator's declaration —
  `(agent default)` when the seat just runs its own default.
- `model_shows:` — where the launched model is verified. `model_shows: banner` reads
  the emitted stream; `model_shows: screen` reads the rendered screen — an agent that
  paints its model into a status bar returns nothing on the default read.
- `brief_delivery:` — `brief_delivery: inject` is the ordinary dispatch;
  `brief_delivery: file` writes the brief to a file and sends one line pointing at it,
  for an agent whose composer fragments a multi-line inject.
- `can:` — what the agent is able to run; a reviewer seat needs `slash-commands` for
  `/code-review`. It is checked when the operator approves the project file, not
  discovered at dispatch.
- `note:` — free prose the coordinator reads when it uses that agent.

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
verifier, reviewer and the coordinator seats (spine session, close session, work-PR
session, close-review writer); the project file fills them and does not define new
built-ins.

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
- `replaces:` — hands the role a step the plugin owns. The valid targets are
  `implementer`, `verifier`, `reviewer`, and only those — the session roles this
  lane owns. The named seat is not launched for that run: the operator's role runs
  at the step's point in its place, and the handoff then states that the step was
  the operator's, so no reader infers a guarantee that was not given. The merge
  ask, teardown and the coordinator's own decisions are not seats and are not
  replaceable; a spine's seats need no `replaces:` — each is already the
  operator's choice at approval.

On-demand seats cost sessions: the project file says how many may exist at once, the
default is one, and anything beyond the declared number is a planning defect.

## When a file is missing

What the session does itself — reading, planning, the ceremonies it runs in its
own context — needs no setup: with no files at all, every role
falls back to the agent this session is already running, and orca-crew works on
install. A session cannot recover its own launch command, so
the first delegated dispatch halts with a message naming the machine file and
the one entry the operator must add, in the shape above — a run never writes
machine-level configuration itself.
A name the files do not define is never guessed:
a seat name that neither file defines halts the run and is reported, exactly as
a missing alias did.
