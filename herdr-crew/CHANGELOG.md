# Changelog

All notable changes to the `herdr-crew` plugin.

## 0.1.1

The **0.1.0 port, corrected against its own first pilot**. 0.1.0 was written from
`orca-crew`'s shape; 0.1.1 is what one real run measured that shape to be wrong
about — the worktree launch, the detection figure, the workspace a teardown
leaves — plus the defects the port's own generator kept producing, and the gates
that hold the corrections. No new surface, no runtime library, and no change to
any ossify contract; `orca-crew` is unmodified by this release too.

- **A brief is a whole contract** (#539). The port's defect generator was a
  template defined as "take template X and replace lines Y and Z": three times
  that composition borrowed the wrong context and shipped a brief ordering a seat
  to do the wrong thing. `briefs.md`'s header now states the rule and carries the
  dispatch matrix that makes it checkable — which coordinator constructs which
  child briefs, and what its dispatch must carry verbatim — and four dedicated
  templates replace what composition remained: lane driver, doctor dispatch,
  direct work-item and non-spine close, each complete on its own. The fix-round
  template stands alone too, carrying its own seat lines, TASK, completion body and
  NEVER line rather than the fast-implementer brief with lines replaced. The
  non-spine close's DONE carries three results, the halt among them —
  `halted: <step> — <evidence>` and, on its own line, what it had already opened —
  because a close can halt after opening a PR in one repo, and hiding those PRs
  strands them. `SKILL.md`'s brief sections name the set and point at the
  templates instead of assembling one from another.
- **The rules a seat's location will not load are a slot** (#537). Every dispatched
  template carries `RULES THAT DO NOT LOAD HERE`, filled verbatim or `none`: a seat
  placed inside a canonical worktree — the reviewer, the verifier, the item
  verifier — gets the project's rules pasted into its brief, because a brief is the
  whole contract a worker ever sees and its own project's rules do not load where
  it sits.
- **The report file is replaced atomically, in every slot** (#540). Opening the
  path truncates it before the content lands, and the orchestrator's doorbell
  polls the file's hash, so an in-place write can wake it on half a report. The
  shape is stated in `briefs.md`'s header and in all fifteen `REPORT_PATH=` slot
  lines across the four brief files — a temp file in the same directory renamed
  over the path, never in pieces, and a plan, a question and a final report alike.
  No tool here documents an atomic rename, so the requirement is the writer's.
- **The pilot's three corrections** (#542, #543, #544). `herdr worktree create`'s
  `--label` names the worktree's **workspace**, never the seat's tab, so a worktree
  seat needs the `tab rename` the launch's step 1 prescribes. That call opens
  **two** workspaces — the worktree's own and the **source repository's** checkout
  — while `worktree remove` releases only the worktree's, so teardown names the
  source-repo workspace the run did not create and the operator's to close, the
  canonical checkout in the dual-repo case. And detection is two events, not one:
  a record at about 0.6 s still carrying `agent_status: unknown`, and a settled
  state at about 4 s — so the first ask chooses only the readiness wait, while the
  **send's route**, and the completion wait with it, comes from a second ask made
  after the model read.
- **The run's seams** (#515, #516, #517, #519, #522). The top's rotation launches
  its successor through the seat launch every other seat gets — the readiness path,
  the model read against the profile the handoff recorded, then the second
  detection ask — and sends its resume on the route that ask fixes, so a successor
  is never sent its resume before its TUI accepts input. A later launch whose
  `herdr workspace list` no longer shows the run's workspace creates it again first
  and binds the id that call returns; the handoff records a machine label beside
  every seat not on this machine, and every later operation on that pane goes
  through it, because pane ids are server-scoped. The `/context` probe at a task
  boundary is conditioned on the seat being able to answer it — the profile's
  `can: slash-commands` **and** the route the send takes — and a seat failing
  either is never sent the probe: it rotates at its item boundary on the run's own
  record instead. `mv` joins the command's allowlist, and dagr's producer contract
  is stated as the rule for every write of `run.json`, not only its creation. An
  orchestrator started outside a herdr pane is refused: with no `HERDR_PANE_ID` the
  hook is inert, and a rotation later needs a `HERDR_WORKSPACE_ID` that is absent
  too.
- **The context-ceiling hook reports what it cannot read** (#516, #519, #527). Four
  defects, all against the header's own promise that a figure which cannot be read
  is reported as unavailable, never guessed: a transcript that exists but cannot be
  read says so now, instead of producing no notice at all; a `usage` object missing
  any of its three counters no longer reads as a figure of zero, which is a figure
  the ceiling check believes; a machine with no `jq` recognises the wake path as
  well as the prompt, so a coordinator woken by a background wait is still told;
  and an input `jq` cannot parse attributes its notice to the event the raw input
  names. A `tail` that cannot run is the same class and takes the same path: its
  status is read under `pipefail`, so it reports that the transcript's tail could
  not be read rather than "none". The three separator spellings a JSON writer
  produces are read on the raw paths, and what stays outside them is stated where
  the boundary is drawn.
- **The first-run halt shows an entry to copy** (#518). Neither seat file exists on
  a fresh machine, so the halt is right — but the section named the file to add and
  never showed one complete, with the model id the seat must show a slot in all
  three illustrative entries. It now names the remedy and follows it with one
  worked machine entry, every field filled and every value obviously illustrative.
  An operator-defined role's `brief:` gains its obligation beside that: the file it
  names must carry a report envelope — a `REPORT_PATH` and a completion shape —
  checked at approval with `can:` and the block's other fields, because without one
  the role cannot return.
- **The triggers are herdr-specific** (#535). The frontmatter description claimed
  the same generic phrases `orca-crew`'s does, so while both are installed a
  generic request could select the Orca playbook mid-migration. It now triggers on
  "the herdr orchestrator session", "a herdr worker seat", "the herdr crew",
  "dispatch to a herdr session" and "execution assignments for a spine in herdr",
  and on `/herdr-crew:orchestrate`. The generic phrases return when `orca-crew`
  retires.
- **The gates the review rounds showed were missing.** The rounds reverted this
  release's clauses in turn, and every one whose revert left all six suites green is
  now pinned: the report slots by count in all four brief files, the probe's two
  conditions, the workspace recreation, both machine-label clauses, the nested
  run's identity anchor — with an absence pin that keeps #552's false "close guard
  fingerprints" claim from walking back in — and the eval fixtures' frontmatter,
  which nothing parsed before. The personal-name sweep reads each file as one line,
  because a name split by a markdown wrap was structurally invisible to a per-line
  count. Two repo-root parity pins hold this plugin's copies of `orca-crew`'s
  fidelity pins and ossify's eval aggregator to their sources while `orca-crew`
  stays installed for the migration.

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
| `worker-read` | `herdr pane read`, only on a `blocked` wake, a missing or malformed report, a timeout's checkpoint, or the false wake's own read |
| `worker-release` | as `orca terminal close` above |
| `orca skills get orchestration` | `herdr --skill` |
| `ORCA_TERMINAL_HANDLE` | `HERDR_PANE_ID` — the hook gate only |
| `~/.claude/orca-crew/agents.md` | `~/.claude/herdr-crew/agents.md` |
| `.orca-crew/roles.md` | `.herdr-crew/roles.md` |

`skills/orchestrate/references/herdr-mechanics.md` is the authority for every mechanic
above and wins on any disagreement with this table.
