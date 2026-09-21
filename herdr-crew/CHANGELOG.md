# Changelog

All notable changes to the `herdr-crew` plugin.

## 0.1.0

The **port of the orchestrator/worker session model onto herdr**. `herdr-crew` is
`orca-crew` 0.7.0's crew on a different runtime: same roles, same briefs, same
thirteen-step run, same ossify seam, and no change to any ossify contract.
`orca-crew` is unmodified by this release and stays installed until the fleet has
moved; migration is a copy of the two configuration files to the paths below, and
nothing here reads the old ones.

- **Readiness is derived, never declared.** herdr answers live whether it detects
  the pane (`herdr agent list`): a detected seat waits on a typed agent state, a
  seat it does not (`mcode-*`, which has no detection manifest) waits on a screen
  pattern. No configuration field states the path, so a detection manifest landing
  later upgrades a seat with no edit anywhere.
- **Placement is one tab per seat and one full-size pane per tab** — never `pane
  split`. herdr's own guide defaults "Start and coordinate an agent" to a sibling
  split in the current tab; herdr-crew overrides it, because panes sharing a tab
  make a multi-agent screen unreadable. A run of five seats is five readable tabs.
- **Completion is a report file**, at the `REPORT_PATH=` the seat's brief names; the
  typed state is only the doorbell, because herdr's `done` carries no body and a
  hash tells a new report from an old one at the same path. A coordinator seat — a
  spine session, a work-PR session, or a `run-spine` lane driver whose subagents run
  in the background — is waited on through its report file, not a typed state it
  would read as ready too soon.
- **The bounded-wait narrowing.** `orca terminal wait --for tui-idle` becomes one
  `herdr agent wait <pane> --until done --until idle --until blocked --timeout <ms>`
  — run in the background where the host has a background call, in the foreground
  inside that host's cap where it does not: a single call that returns once, with
  `blocked` in the set so a dialog wakes rather than sleeping to the timeout. A round
  of N parallel items is N such waits, one per pane — never a loop of waits, and
  never a re-entry after an empty timeout.
- **The run's state lives in a dagr `run.json`** that the plugin's prose owns and no
  binary writes.
- **The configuration paths move and the format does not.** The machine file is
  `~/.claude/herdr-crew/agents.md` and the project file is `.herdr-crew/roles.md`;
  every field, every role key and every precedence rule is as it was, and both are
  still read as prose.
- **One fail-open hook, and no runtime library.** `hooks-handlers/context-ceiling.sh`,
  gated on `HERDR_PANE_ID` and inert outside a herdr pane, tells a seat its own context
  figure once it passes the `context_ceiling` setting (default 500000 tokens): finish the
  unit in hand and start no new one, and a coordinator seat rotates at its next boundary.
  A run executes no `lib/`, no state directory and no parser; that
  hook is the only deterministic code on a user's path. The suites and the eval
  harness under `tests/` are build-and-test tooling, never run by the plugin.
- **The ossify seam ports unchanged.** The spine execution-assignment phase, the
  approved SEATS block injected into one spine session's brief, the nested
  `run.json`, the three coordinator seats and the close-review writer outside the
  per-item budget, and the fixed procedures are the contract they were; the lane's
  item panes are herdr tabs.

### The verb map

| orca-crew 0.7.0 | herdr-crew |
|---|---|
| `orca terminal create --worktree <sel> --command "<cmd>"` | the run's `herdr workspace create --cwd <path> --label "run: <objective>"` once — its own tab, relabelled with `herdr tab rename`, is the first seat's; each later seat `herdr tab create --workspace <id> --cwd <path> --label "seat: <role> (<agent>)"`; a worktree seat's `herdr worktree create` replaces the tab step (a workspace of its own); then `herdr pane run <pane> "<command:>"`. One tab per seat, never `pane split` |
| `orca terminal wait --for tui-idle` | `herdr agent wait <pane> --until done --until idle --until blocked --timeout <ms>` — every detected seat's readiness, and completion for a detected seat that is not a coordinator. One call that returns once, run in the background where the host has one and in the foreground inside that host's cap where it does not; the three settled states are written out rather than inherited, and `blocked` is in the set so a dialog wakes instead of sleeping to the timeout |
| (no equivalent) | `herdr pane wait-output <pane> --match '<expected_model:>' --timeout <ms>` — an undetected seat's readiness, read from the screen when `model_shows: screen`; its completion doorbell is its report file |
| `orca terminal read` | `herdr pane read <pane>` — serves both `model_shows: banner` and `screen` |
| `orca terminal send` | detected: `herdr agent prompt <pane> "<text>"`, the `/context` send at a task boundary plain and with no `--wait`, because a local slash command settles without a turn; undetected: the message written to a file the seat can read, then a one-line pointer via `herdr pane run <pane> "<line>"` |
| `orca terminal close` | a tab seat: `herdr pane close <pane>`; a worktree seat: `herdr worktree remove --workspace <id>`, never a pane close; the run's own workspace closes last with `herdr workspace close <id>` |
| `orca terminal list` | `herdr pane list` / `herdr agent list`, which is also the readiness discriminator |
| `orca status --json` | `herdr status` |
| `orca orchestration dispatch --inject` | detected: `herdr agent prompt <pane> "<brief>" --wait --until working --until blocked --timeout <ms>`, that `--wait` being the turn-start check; undetected: the brief as a file, then a one-line pointer via `herdr pane run`; `brief_delivery: file` writes the brief and prompts one line pointing at it |
| `orca orchestration ask` / `reply` | a worker writes its question into its report file and waits; the orchestrator answers with the seat's next message — herdr has no worker-to-orchestrator channel |
| `orca orchestration task-list` | the run's dagr `run.json`; `dagr check --strict` lints it |
| `orca orchestration run-use` | naming the run's `run.json` path |
| `worker-start` | the seat launch (row 1) |
| `worker-done` | the seat's **report file**; the doorbell is the typed wait for a detected seat that is not a coordinator, and the report-file wait for an undetected or coordinator seat |
| `worker-read` | `herdr pane read`, only on a `blocked` wake, a missing or malformed report, or a timeout's checkpoint |
| `worker-release` | as `orca terminal close` above |
| `orca skills get orchestration` | `herdr --skill` |
| `ORCA_TERMINAL_HANDLE` | `HERDR_PANE_ID` — the hook gate only |
| `~/.claude/orca-crew/agents.md` | `~/.claude/herdr-crew/agents.md` |
| `.orca-crew/roles.md` | `.herdr-crew/roles.md` |

`skills/orchestrate/references/herdr-mechanics.md` is the authority for every mechanic
above and wins on any disagreement with this table.
