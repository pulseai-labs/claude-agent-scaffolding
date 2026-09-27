# Configuration

Every seat a run uses, and every value in its profile, is a value the operator edits — through
Paseo's own profile store or the project file below — never a fact this plugin hard-codes;
nothing here parses either one.

## The seat sources

Paseo profiles live in `daemon.agentProfiles`, managed by the operator outside every repo
through draco28/draco-dotfiles and read by every session with the `list_profiles` MCP call —
the one place this file names it. A profile materialises into `create_agent` exactly as
Paseo's own skill states (`paseo-mechanics.md`'s The seat launch).

The project file sits at the project root — which agent fills each role for the work at hand,
plus the conditions that choose between seats. Its role and shape are unchanged: it still
names agents by name, never by command, so no machine detail reaches a repo. For a dual-repo
project the project root is the AI workspace, which is where orchestrators launch; for a
single-repo project it is that repo. Its path is `.paseo-crew/roles.md`.

The optional `~/.claude/paseo-crew/agents.md` holds `kind: dsh-spine-driver` entries only — a
`dsh-session` runs outside Paseo entirely, so no profile can describe it (`dsh-driver.md`).
Any other kind of entry in that file is a config defect, named at approval. It is written by
the operator, with an agent's help, between runs and never edited during one, and nothing in
it is project-specific.

Resolution of the project file is a walk up from the session's working directory: the first
one found on that walk is the one in force. The pairing manifest is not consulted — its
absolute roots are wrong on this host. A seat name resolves to a Paseo profile first, then to
a `kind: dsh-spine-driver` entry in that file; a name found in neither halts the run.

The project file wins for anything it names — a seat, an extra role, a condition; it never
redefines how a seat is launched. Workers never read either file — a brief is the whole
contract a worker sees.

## Profiles

A seat's profile materialises into `create_agent` exactly as Paseo's own skill states:
`provider` + `model` → `provider/model`, `modeId` → `settings.modeId`, `thinkingOptionId` →
`settings.thinkingOptionId`, `featureValues` → `settings.features` (`paseo-mechanics.md`'s The
seat launch, which also covers a profile with no `model` or no `modeId`; this file does not
restate either gap).

The agent-entry fields of the earlier crews map like this:

| earlier field | paseo-crew source |
|---|---|
| `command:` | the materialised `create_agent` call — nothing to type |
| `expected_model:` | the profile's `model`, or the default id `paseo-mechanics.md` reads for one that has none |
| `effort:` | the profile's `thinkingOptionId`, or `(provider default)` |
| `can:` | a `can:` sentence in the profile's `notes` — every draco-desk profile's notes already state it |
| `note:` | the rest of the profile's `notes` |

The fields that said where a model shows and how a brief is delivered are gone:
`paseo inspect --json` reports `Model` for every seat, and `initialPrompt` /
`send_agent_prompt` carry text whole, so no composer can fragment it.

**The one exception: a `kind: dsh-spine-driver` entry.** A `dsh-session` runs outside Paseo
entirely, so no `provider`, `model`, `modeId`, `thinkingOptionId` or `featureValues` describes
it — a `kind: dsh-spine-driver` entry has no `command:` to resolve into a profile row either,
and its fields, values and profile row are `dsh-driver.md`'s: `preset:`, `route:`, `effort:`,
and its own `model_shows: transcript` and `brief_delivery: api`. That is the one exception to
this section's field list, named here rather than left implicit.

## What a resolved profile carries

A resolved profile renders as one row wherever it travels:

`<profile id> | <provider>/<model> | mode: <modeId> | thinking: <thinkingOptionId>`

| field | set by | consumed at | travels |
|---|---|---|---|
| profile id | the project file's Agent column | the seat label, the brief's `SEAT_PROFILE` | every resolved profile |
| `provider` / `model` | the profile | the launch, the model check | every resolved profile |
| `modeId` | the profile | the launch | every resolved profile |
| `thinkingOptionId` | the profile | the launch | every resolved profile |
| `can:` | the profile's `notes` | the seat's approval | never — checked where a seat is approved |
| `note:` | the profile's `notes` | the coordinator's read | never |

`can:` and `note:` never travel: a brief's record of its own seat's launch is the resolved
row above, nothing from `notes`.

`can:` is checked where a seat is approved — the project-file approval, the spine-seat
approval, the PR-transition ask, the close-review halt ask — never at dispatch. The
requirement is per role: a role whose shipped or declared brief invokes a slash command needs
`can: slash-commands` on the profile that fills it.

| role | its brief invokes | needs |
|---|---|---|
| reviewer | `/code-review` | `slash-commands` |
| implementer, verifier | no command | — |
| fix-round implementer | `/ossify:work-pr` when ossify is installed | `slash-commands` then |
| ossify item implementer | `/ossify:work-item` | `slash-commands` |
| item verifier | no command | — |
| spine session, default lane | `/ossify:run-spine`; spawns `ossify:implementer-agent` subagents through the `Agent` tool | `slash-commands, subagents` |
| spine session, external-executor lane | `/ossify:run-spine` | `slash-commands` |
| spine or close session on a `kind: dsh-spine-driver` agent | its persona, no command (`dsh-driver.md`) | — |
| close session | `/ossify:close` | `slash-commands` |
| work-PR session | `/ossify:work-pr` | `slash-commands` |
| doctor session | `/ossify:doctor` | `slash-commands` |
| PR-fix seat inside work-PR | none — the clause is removed | — |
| close-review writer | no command | — |
| an operator-defined role | whatever its `brief:` invokes | as declared |

## The project file

Three sections. `## Seats` is a table of role, agent and when — the Agent column names a
Paseo profile id:

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

`## My roles` holds the operator's own roles as blocks (next section). `## Conditions` is
free text: conditions are sentences the coordinator reads when it picks a seat, and nothing
parses them. The plugin ships the role list — orchestrator, implementer, verifier, reviewer
and the coordinator seats (spine session, close session, work-PR session), plus a `doctor
session` for `/ossify:doctor` dispatches; the project file fills them and does not define new
built-ins. The close-review writer is not a project-file seat — the operator names its
profile at the halt that creates it (`ossify-close-writer.md`).

## Roles of the operator's own

A role under `## My roles` is a block:

```markdown
### security-audit
at: before-merge-ask
agent: sonnet-review
blocks: yes
brief: ./briefs/security-audit.md
```

- `at:` places the role at a named point of the run (`lifecycle.md`): `after-implementer`,
  `before-review`, `after-disposition`, `before-merge-ask`, `at-teardown` — or `at: on-demand`,
  with no fixed point, dispatched when wanted.
- `agent:` — the profile id the role launches on.
- `blocks:` — `yes` holds the run at its point until the role passes or the operator
  overrules it; anything else it returns is advice the orchestrator records.
- `brief:` — the file the coordinator sends as that role's brief. It must carry a report
  envelope — a `REPORT_PATH` and a completion shape — checked at approval with `can:` and the
  block's other fields; without one the role cannot return.
- `replaces:` — hands the role a step the plugin owns; the valid targets are `implementer`,
  `verifier`, `reviewer` only. The named seat is not launched for that run — the operator's
  role runs at the step's point in its place, and the handoff states the step was the
  operator's, so no reader infers a guarantee not given. The merge ask, teardown and the
  coordinator's decisions are not replaceable; a spine's seats need none — each is already the
  operator's choice.

On-demand seats cost sessions: the project file says how many may exist at once, the default
is one, and anything beyond the declared number is a planning defect.

## Migration

If the project file is absent and `.herdr-crew/roles.md` exists, the orchestrator offers a one-time copy.
Every agent name in it is checked the same way a seat name is resolved above. On draco-desk
every seat name in this repo's `.herdr-crew/roles.md` is already a profile id, because the
profiles were named after the seats (dotfiles #2). paseo-crew never reads `.herdr-crew/` at
run time.

## When a file is missing

What the session does itself — reading, planning, the ceremonies it runs in its own context — needs no setup in any state: every role falls back to the agent this session is already running, and paseo-crew works on install.
Delegation meets each state's missing half — a session cannot invent a profile or a role mapping, so its first delegated dispatch halts; which gap it names depends on what exists:

- **No profiles** — the operator's profile store returns nothing this seat's name resolves to;
  the halt names the profile to add in `daemon.agentProfiles`, which this plugin never writes.
- **No project file** — roles name profiles nothing here maps to a role; the halt names the
  project file above and the `## Seats` section to add.
- **A project file naming unknown names** — a role's agent is neither a profile the operator's
  store returns nor a `kind: dsh-spine-driver` entry in the machine file; the halt names the
  entry to add.

Each halts at the first delegated dispatch, naming what to add. A run never writes
`daemon.agentProfiles` or the machine file itself; both are the operator's.
