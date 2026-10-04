# Changelog

All notable changes to the `herdr-crew` plugin.

## 0.2.7

**Every launch marks its session for seat-mods 0.2.0.** seat-mods 0.2.0 guards a session
whose `SEAT_MODS_ROLE` is unset or empty as an implementer, and treats exactly
`orchestrator` and `coordinator` as unguarded — so herdr-crew 0.2.5's coordinator seats,
and the top's rotation successor, would have launched as guarded implementers that cannot
merge. 0.2.7 marks every seat it launches into a herdr pane — and an operator-declared
role with no `replaces:` as a guarded `implementer`.

- **The two free roles are marked at launch.** `herdr-mechanics.md` step 2 is rewritten
  from the 0.2.5 complement (coordinator seats listed as unguarded) to the marking: a guarded seat — implementer, verifier
  or reviewer, and a `replaces:` role as the role it replaces — exports its role with
  `SEAT_MODS_ALLOW`; a project-file role with no `replaces:` is marked a guarded
  `implementer`, its report and scratch directories in `SEAT_MODS_ALLOW`; a coordinator
  seat — the spine, close or work-PR session, the doctor session, the lane driver — exports
  `SEAT_MODS_ROLE=coordinator`; the top's rotation successor exports
  `SEAT_MODS_ROLE=orchestrator`; neither free role gets `SEAT_MODS_ALLOW`. The operator's
  own top is not launched here — the operator starts it through a `claude-orch` alias that
  sets `orchestrator`. Every site that orders one of these launches names the marking and
  points at step 2, as 0.2.5's guard clauses do: `ossify-execution.md`'s top column;
  `ossify-nested-run.md` §4 (the spine `rotate:` successor, the first close, a
  re-dispatched close, the work-PR session, the record pass); the close and work-PR
  sections of `ossify-pr-briefs.md`; the spine brief's header; `lifecycle.md` step 1b, the
  rotation section (the top's own successor, whose marking is `orchestrator`) and the
  `## My roles` clause; `SKILL.md` §6's lane-driver dispatch, its close/work-PR/record-pass
  transition, and its doctor, non-spine-close and direct-work-item bullets; `briefs.md`'s
  direct-work-item and non-spine-close template headers; `commands/orchestrate.md`'s spine
  start; and `roles.md`'s spine-session sentence, session budget, doctor sentence and
  launch block. The marking is a herdr pane's: a `kind: dsh-spine-driver` seat is a dsh
  session, not a pane, and is never marked (`dsh-driver.md`).
- **The #658 findings deferred from #655 are folded in.** Step 2 now defines `<run dir>` —
  the directory holding the run's `run.json`, outside every worktree; the
  missing-status-line record routes the top's own launches as well as a coordinator's (a
  coordinator records it to the top, the top to the operator) and states its disposition —
  no halt, no re-launch, never silent; the status line is read from the rendered viewport
  (`--source visible`) even where a `banner` seat's model read is the default stream; both
  budget controls' failure messages name the remedy — "lower REF_BUDGET to N" — instead of
  reading as over-budget failures; the root README's "Since 0.2.5" sentence drops the
  launch class that does not exist and adds the close-review writer; and the plugin README
  describes the marking. This is every #658 item: the altitude one is re-homed as #663
  (the marking stays at prose launch sites, so a new site added without a clause still
  passes the suite).
- **Tests and budgets.** The spine-contract suite's value sweep flips from "no
  coordinator-valued guard anywhere" to a whitelist over the exact assigned word — one of
  the five roles, or the shipped `<role>` slot, terminated by end of line, whitespace or
  its closing quote — with seeded controls for each invalid shape (a coordinator noun, a
  trailing comma, semicolon or period, an unbalanced or stray quote, an empty value, `<>`
  and `<close-session>`), for both accepted free roles, for the pane-run recipe's closing
  quote, and for the assignment-less prose control; one pin per coordinator, orchestrator
  and operator-role site sits beside 0.2.5's guard-site pins, and the plugin README's
  pane-scoped opening is pinned. The reference budgets enforce 275 for
  `herdr-mechanics.md` (272 -> 275) and 209 for the ossify references (204 -> 209), each
  raised only to the new minimum; each adjacent control still refuses a file one line over
  the real reference and now names the lowering remedy when it fires.

No runtime library, no ossify contract change. `dsh-driver.md` is untouched: dsh sessions
are not herdr panes and do not load Claude Code mods. seat-mods 0.2.1 carries this
release's docs only — the rollout wording, the "Without an orchestrator plugin" section
and a reviewer `SEAT_MODS_ALLOW` example — no seat-mods code.

**Known limit.** seat-mods 0.1.0 reads `coordinator` and `orchestrator` as invalid roles
and denies every tool call (`seat-mods/hooks/rules.ts:106-110` and `register.ts:50` at tag
`seat-mods-v0.1.0`), so herdr-crew 0.2.7 must be installed together with seat-mods 0.2.0.
paseo-crew, orca-crew and dsh-crew do not mark sessions yet. An operator-declared role
with no `replaces:` is marked a guarded `implementer` and runs under implementer rails.

## 0.2.6

**The context-ceiling hook stands down where `molt` is active.** In a session whose
`molt` marker (`~/.claude/state/molt/active/<session_id>`) is under a day old, the hook
prints nothing: `molt` hands the session off in place at its own threshold, and a second,
conflicting rotation order would leave two tops on one run. Without `molt` installed no
marker exists and nothing changes. A stale marker is ignored, a session id that is not a
plain name is never a marker, and without `jq` the id is read as text. The rotation prose
is unchanged in this release.

## 0.2.5

**The seat-mods guard reaches every launch site (#651, part 5).** The guard rule lived
only in `herdr-mechanics.md`'s launch, step 2, while a coordinator spends the rows it
receives "verbatim" — command, model, effort and delivery carry no guard — so a
replacement PR-fix seat went out unguarded in a live run.

- **Every launch site states the requirement; the mechanics stay in one place.** The
  work-PR brief guards the reviewer and the PR-fix seats (a released reviewer re-created
  for a delta re-review, guarded again), the spine brief and the nested-run round
  procedure guard the item seats and the replacement pair, and the close-review writer
  is dispatched as a guarded seat under role `implementer`. Each site names the role it
  guards and points at `herdr-mechanics.md` step 2; none restates the export. The top's
  own launch reads the same requirement from `lifecycle.md` step 3, and `roles.md`'s
  launch block shows the export line for those roles.
- **The complement is stated where the rule is.** Step 2 binds a coordinator launching
  its own child seats exactly as it binds the top, and every replacement launch; the
  coordinator seats (the spine, close or work-PR session, the doctor session, the lane
  driver) and the orchestrator — a rotation successor included — are never guarded. A
  guarded seat whose status line lacks `seat: <role>` is recorded by its coordinator in
  its report file, never silently ignored.
- **Tests and budgets.** A new section of the spine-contract suite pins every launch
  site's guard clause, the binding, complement and status-line clauses, and sweeps every
  shipped file for a coordinator-valued `SEAT_MODS_ROLE` with two seeded controls; the
  reference budgets enforce 266 for `herdr-mechanics.md` (260 -> 266) and 204 for the
  ossify references (200 -> 204), each with an adjacent control that a file one line
  over the real reference is still refused.

No runtime library, no ossify contract change. `dsh-driver.md` is untouched: dsh sessions
are not herdr panes and do not load Claude Code mods.

## 0.2.4

**The `run.orchestrator` rebind (#556).** dagr routes the operator's `m` composer to
`run.orchestrator`, and nothing rebound it: after a rotation the field still named the
pane the file was created in, so the operator's messages queued at a top that had stood
down.

- **One rule, carried to each successor's own contract.** A session that binds an
  existing `run.json` rewrites `run.orchestrator` to its own `$HERDR_PANE_ID` — dagr's
  stable-agent fallback otherwise — in the same producer loop every other write takes.
  It is stated at `lifecycle.md` step 1 and carried verbatim to the top's rotation, the
  spine brief's continue (`ossify-briefs.md`, the `rotate:` successor), and the work-PR
  brief's continue (`ossify-pr-briefs.md`, the `open:` successor), because a brief is the
  whole contract its reader sees; `ossify-nested-run.md` §4 says the new spine session
  rebinds. The contracts that build a work-PR dispatch — `lifecycle.md` step 1b and its
  rotation paragraph, `ossify-nested-run.md` §4 and `ossify-execution.md`'s top column —
  carry the predecessor's `RUN_JSON` path into a resumed dispatch, so the successor's
  continue branch and its rebind are reachable instead of a second run file being minted.
- **One writer, one router.** The handoff is the predecessor's last write; from the
  handoff on the predecessor writes nothing to the run file and takes no dispatch action,
  and the successor's rebind is its first write — the rebind does not wait on the
  stand-down, which kills waits and writes nothing. An operator message dagr queued at the
  old pane in the interval is a wake that fires anyway: read and handed to the successor,
  never acted on. The handoffs record the pane the block names at writing — lifecycle
  step 13, the rotation handoff, the spine `rotate:` return, and the work-PR `open:`
  return.
- **The #556 gap sentence is gone** from `lifecycle.md`; the plugin `README.md`'s binding
  sentence carries the rebind.
- **Tests and budgets.** `tests/test-ossify-spine-contract.sh` pins the carried sentence
  at all three sites (flat-counted), the four handoff records, the four dispatch carriers
  of a resumed work-PR `RUN_JSON`, and the gap sentence's absence as a flat, plugin-wide
  sweep; every pin was mutation-tested with a semantic mutation that applies and runs. The
  three budgeted files land at the 200-line gate (`ossify-briefs.md` 200,
  `ossify-pr-briefs.md` 200, `ossify-nested-run.md` 200) by trading lines inside each file,
  no raise. No new eval surface and no rubric criterion: the rebind sequence is checked by
  the recorded-claims walkthrough in the verification dispatch, and no eval result covers
  it.

## 0.2.3

**The worker ping and the heartbeat backstop (#640).** The orchestrator's wake was
pull-only: a wait armed on the wrong report path, or one that died, failed silently, and a
worker had no sanctioned way to say it had finished.

- **The ping.** Every report-producing brief carries `NOTIFY_PANE` — the dispatcher's own
  pane id only when herdr detects it and the seat shares its server, otherwise the sentinel
  `none` — and after every atomic report rename the worker sends one literal
  `REPORT READY: <task> <kind> <path>` line there: single-quoted as one argument so `$` and
  backticks stay data, skipped when the target is `none`, one send, no `--wait`, no retry, and
  a failed send leaves the report intact. A coordinator fills its children's slot with its own
  pane id; an operator's `brief:` gets the same envelope in the dispatched copy, never in the
  stored file. A parent herdr cannot target keeps the report-file wait and the heartbeat, no
  push promised.
- **Consumption.** One generation rule (hash or identity) comes first on any signal: the
  typed wake treats a byte-identical atomic replacement as new, exactly as the ping and the
  doorbell do; a new generation is read, noted, acted on once by kind, and retires that
  dispatch's armed wait and companion; an already-consumed one is not read, not acted on, and
  retires nothing, so a stale same-path ping never cancels the current phase's wait. A ping
  naming a path other than the briefed report path is surfaced, never read. Deduplication
  governs the report and its waits alone: a live dialog and a heartbeat tick are still handled.
- **The heartbeat.** One bounded background timer of about 15 minutes per session holding any
  live herdr-pane dispatch — a typed-wait seat included, not only a report-file wait; a dsh
  session, which has no pane or `REPORT_PATH`, keeps `dsh-driver.md`'s own route — re-armed per
  tick, not a completion wait and never a re-entry. Each tick: the
  generation check, then at most one health check per live seat; `working` asks nothing,
  `blocked` takes the dialog procedure, and idle/done with no report, `unknown` or an
  unreadable seat is surfaced once per dispatch as observed state and uncertainty — never as
  a failed task and never as a retry. Killed when the last dispatch settles, at teardown and
  at a rotation's stand-down, where the successor arms a fresh one; a host with no background
  timer keeps the wait/ping fallback, never a rolling foreground loop.
- **Reconciled prose.** `SKILL.md`'s "no keepalive" and the loop-of-waits rule now carve the
  ping and the heartbeat out explicitly; `lifecycle.md` step 5 arms and kills the heartbeat
  and step 3 fills `NOTIFY_PANE`; rotation hands the ping target over (a retained worker
  keeps the predecessor's pane until the successor's next message carries its own, its
  heartbeat covering the interval); `roles.md` and `ossify-execution.md` prefer a seat herdr
  detects where the project file offers a choice, as prose over any profile field.
- **Tests and budget.** The mechanical suites gained the `NOTIFY_PANE` slot counts and the
  narrow command-policy carve-out — the ping is the one herdr command a brief states, with
  an adjacent control proving any other agent command still fails. `herdr-mechanics.md`'s
  ceiling rose 245 → 260 for the two new mechanics, traded back twelve lines elsewhere. No
  new eval surface: the semantics are walked as recorded claims in the ordinary verifier
  dispatch.

## 0.2.2

- **Guarded seats** (`references/herdr-mechanics.md`, the launch's step 2): before an implementer,
  verifier or reviewer seat's command, its pane exports `SEAT_MODS_ROLE` and `SEAT_MODS_ALLOW` (its
  report directory and its own scratch directory, `<run dir>/scratch/<role>-<n>`, with no `:` or
  space) for the seat-mods plugin — `herdr worktree create` takes no `--env`. Coordinator
  seats and the orchestrator never get them. A guarded seat whose status line lacks `seat: <role>`
  runs unguarded, and the run record says so. An ossify implementer's list adds its handoff's
  directory, where it writes `report.md`. Neither variable ever goes in `settings.json`, a shell
  profile or a `command:` line.
- **Briefs that use scratch** (`briefs.md`: planned and fast implementer, fix round, verifier;
  `ossify-briefs.md`: item verifier) name that scratch directory as `SCRATCH_DIR`; commit-message
  files for `git commit -F` go there, and the implementer `NEVER` clauses list it beside
  `REPORT_PATH` as an exception outside the worktree. It replaces the session scratchpad, which the
  seat-mods guard cannot locate.

## 0.2.1

- **`references/dsh-driver.md` §3** recommends `.dsh-crew/roles.md`'s verifier as `driver`:
  since dsh-crew 0.3.1 the verifier always runs the driver's own route and effort. The
  implementer route and effort still come from the allow-list.
- **`references/dsh-driver.md` §5:** before each spawn the top diffs the installed
  `crew-spine` preset against the plugin's and halts on a difference, since a stale preset's
  persona cannot stop itself before run-spine's first mutation. A stop from the driver's
  pre-mutation step 0 checks is retried by sending the same first message to a fresh session,
  never by `continue` to the stopped one.

## 0.2.0

**The dsh spine driver.** A spine's spine and close seats can be a DeepSeek Harness (dsh)
session instead of a launched command. `references/dsh-driver.md` is the whole contract,
and dsh-crew 0.3.0 supplies the session, its skills and the presets.

- **The `kind: dsh-spine-driver` agent entry** has no `command:`: `preset: crew-spine`,
  a `route:` and `effort:` from `~/.dsh/settings.yaml`, the model read from the session's
  transcript, and the brief sent as one steered message through dsh-crew's `dsh-session`
  skill. Every surface the top reads before that file admits the kind: `config.md`'s
  agent entries and capability table, `lifecycle.md` step 1b, the delegation floor's
  actions and reads, `ossify-nested-run.md` §4, `ossify-execution.md` §3 and §7, and the
  command.
- **`.dsh-crew/roles.md` in place of item rows.** At spine planning the top recommends
  that file's implementer, verifier and reviewer rows in the one approval phase and
  writes it; the items get no per-item seats from this plugin.
- **dsh-crew's item procedure.** A dsh-driven spine runs its items through
  `dsh-executor`: no worker-authored plan gate, one automatic correction and then a stop
  for the operator, and no nested-depth ask.
- **Every close in a fresh dsh session**, never the spine driver's, so dsh-crew's
  reviewer pass runs at close review and a close-sent correction has its executor.
- **The top watches the transcript**: the driver's `ask_user_question` goes to the
  operator in the browser and the top relays its text; a token-free wait ends on a turn
  end, a pending question or `context_ceiling`; only a `completed` turn is a completion;
  rotation is a steered hand-off.
- **Parity pin.** `tests/test-herdr-crew-parity.sh` holds `references/dsh-driver.md`
  byte-identical to orca-crew's apart from the plugin name.
- No eval fixture is added; the dsh lane is verified by a real spine run.

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
  not be read rather than "none". The two separator spellings a JSON writer produces
  — compact, and one space after the colon — are read on the raw paths, with a third,
  space-on-both-sides form kept as a belt alternative; what stays outside them is
  stated where the boundary is drawn.
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
