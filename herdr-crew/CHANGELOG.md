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
  spine or work-PR session running work of its own in the background — is waited on
  through its report file, not a typed state it would read as ready too soon.
- **The bounded-wait narrowing.** `orca terminal wait --for tui-idle` becomes one
  `herdr agent wait <pane> --until done --until idle --until blocked --timeout <ms>`
  run in the background: a single call that returns once, with `blocked` in the set
  so a dialog wakes rather than sleeping to the timeout. A round of N parallel items
  is N such waits, one per pane — never a loop of waits, and never a re-entry after
  an empty timeout.
- **The run's state lives in a dagr `run.json`** that the plugin's prose owns and no
  binary writes.
- **The configuration paths move and the format does not.** The machine file is
  `~/.claude/herdr-crew/agents.md` and the project file is `.herdr-crew/roles.md`;
  every field, every role key and every precedence rule is as it was, and both are
  still read as prose.
- **One fail-open hook, and no library.** `hooks-handlers/context-ceiling.sh`, gated
  on `HERDR_PANE_ID` and inert outside a herdr pane, tells a coordinator seat its own
  context figure once it passes the `context_ceiling` setting (default 500000
  tokens). There is no `lib/`, no state directory and no parser; that hook is the
  plugin's only deterministic code.
- **The ossify seam ports unchanged.** The spine execution-assignment phase, the
  approved SEATS block injected into one spine session's brief, the nested
  `run.json`, the four coordinator seats outside the per-item budget, and the fixed
  procedures are the contract they were; the lane's item panes are herdr tabs.

### The verb map

| orca-crew 0.7.0 | herdr-crew |
|---|---|
| `orca terminal create --worktree <sel> --command "<cmd>"` | `herdr worktree create` / `herdr workspace create --cwd`, then `herdr tab create --workspace <id> --cwd <path> --label <text>`, then `herdr pane run <pane> "<command:>"` |
| `orca terminal wait --for tui-idle` | `herdr agent wait <pane> --until idle --timeout <ms>` — detected seats |
| (no equivalent) | `herdr pane wait-output <pane> <pattern>` — undetected seats |
| `orca terminal read` | `herdr pane read <pane>` |
| `orca terminal send` | `herdr agent prompt <pane> "<text>"` |
| `orca terminal close` | `herdr pane close <pane>` / `herdr workspace close <id>` |
| `orca terminal list` | `herdr pane list` / `herdr agent list`, which is also the readiness discriminator |
| `orca status --json` | `herdr status` |
| `orca orchestration dispatch --inject` | `herdr agent prompt`; `brief_delivery: file` writes the brief and prompts one line pointing at it |
| `orca orchestration ask` / `reply` | `herdr agent prompt` + `herdr agent wait` + `herdr pane read` — no mailbox; the orchestrator is the only asker |
| `orca orchestration task-list` | the run's dagr `run.json` |
| `orca orchestration run-use` | naming the run's `run.json` path |
| `worker-start` | the seat launch |
| `worker-done` | the seat's report file, woken by a typed wait |
| `worker-read` | `herdr pane read`, the same narrow cases |
| `worker-release` | `herdr pane close` / `herdr workspace close` |
| `orca skills get orchestration` | `herdr --skill` |
| `ORCA_TERMINAL_HANDLE` | `HERDR_PANE_ID` — the hook gate only |
| `~/.claude/orca-crew/agents.md` | `~/.claude/herdr-crew/agents.md` |
| `.orca-crew/roles.md` | `.herdr-crew/roles.md` |
