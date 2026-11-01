# Changelog

All notable changes to the `baton` plugin.

## 0.12.0 - 2026-11-01

A supported way to clone a run (#974).

- **Added: `baton clone <run> <new-id>`.** It replaces the hand copy of a run directory, which went
  wrong three ways: `units` written as an array, `spine/` copied so a closed unit's seat launched
  again, and a live session or request record carried into the copy. A clone holds `run.json`,
  `recipe.json`, `seats.json` when the source has one, one `cloned` event and empty `queue` and
  `out`. Units stay an object. Each unit is rebuilt from an allowlist of fields (identity, stage,
  file digests) and starts a fresh visit to its stage, so a field added to a unit later is dropped
  from a clone until someone lists it. The recipe digest is taken from the bytes the clone holds.
  Flags: `--recipe` (re-pin), `--param`, `--reset <unit>[=<stage>]`, `--fresh`.
- **Added: a clone starts parked for `cloned`, and the tick does nothing for such a run.** A park
  only stops launches, so a parked run would still read sources and merge. A clone could otherwise
  start work the operator did not ask for. `baton unpark <new-id>` starts it. Clone never installs
  the timer.
- **Changed: `baton report` counts a `cloned` event as the start of the run.**
- Skill-first question 2: mechanical work on baton's own closed state (`run.json`, `recipe.json`,
  `seats.json`). Clone reads no open input and judges nothing. The new-id check is `arm`'s, shared.
- Known limits: clone does not refuse a clone alongside an armed run of the same project. Baton has
  no such rule in code (`arm` does not check; the skill's preflight does), and which param names
  the project is recipe-specific. The clone is parked, so the check is made before `unpark`.

## 0.11.0 - 2026-11-01

A stop park says where its reason is (#1018).

- **Added: `stop_file` on a `stop` park's event.** The stage's stop file, rendered: the path only,
  never its text, which a seat wrote. A notifier reads the file itself. Other parks carry none.
  `bot-on-openbot` 0.3.0 shows it. Baton parses no stop text and decides nothing from it (skill-first
  question 2: it renders a path from the recipe's own template).
- **Changed: the example lane's brief writes a round barrier plainly.** A halt `no spec for <work item>`
  (a spine planned one round at a time) is a stop whose file starts `round barrier: the next round is
  not planned yet`, says to plan it with plan-spine and then unpark, and says an unpark before the
  specs exist stops again; the halt line follows. Additive: `recipe.json` is unchanged, so an armed
  run keeps its pinned recipe, and a stop file in the old wording still shows as it is.
- **Docs: the runbook names the round barrier.**
## 0.10.2 - 2026-11-01

Three small fixes found in the #993 live acceptance.

- **Changed: bare `baton status` names each row's run and heads the columns (#1001).** Rows
  were `<unit> <stage> <launches> <stalls> <parked> <thread>` with no run id, so rows of different
  runs could not be told apart. The bare form now starts each row with the run id and prints a
  header line first. `baton status <run>` is unchanged: no run id, no header. The README names the
  columns. Nothing in this repo parses the output.
- **Changed: the skill's preflight checks who walks a spine's `user:` lines (#1003).** When the
  spine has such a line and no standing order names the `spine_finish` seat's role, the proposal
  says the run parks after the merge until the operator walks the lines or an order is added. It
  warns and does not stop the arm.
- **Documented, no code change: a driver launch can leave a project-scope row in
  `~/.claude/plugins/installed_plugins.json` (#1004).** Claude Code writes it at startup, from the
  launch directory's tracked `.claude/settings.json`. baton cannot prevent it. See Known limits in
  the README.

## 0.10.1 - 2026-11-01

Each verify round leaves its record (#1005). `examples/ossify-spine` moves the last verdict to
`out/<unit>/verdict-<n>.json` before the next verify, and a used packet to
`correction-<n>.txt` on the way back to verify. An operator can read what the verifier said in
round 1. `verify.md` still holds only the last pass.

## 0.10.0 - 2026-10-30

Seats from crew's config, any harness, a `verify` stage (#993).

- **Added: a stage `role` (crew role names verbatim).** A session stage, `triage` or `driver` with a
  `role` needs no `instance` or `model`; `recipeRoles` lists a recipe's roles.
- **Added: the role table and `baton arm --seats <file>`.** One JSON object keyed by role (`agent`,
  `argv`, `brief_delivery`, `expected_model`, `effort`, `env`, optional `review`; schema in the
  README). `arm` validates it, copies it byte for byte to `<run dir>/seats.json` and records
  `seats_sha256`. A recipe that names roles refuses to arm without `--seats`, and a role the table
  lacks refuses with `role table has no role "<role>" (stage <stage>)`, writing no run directory.
  Extra roles are allowed. `BATON_ROLE` and `BATON_ROLE_TABLE` are refused in a table's and a
  stage's env.
- **Changed: the engine launches a role stage on its role's agent.** The claim gets the role's env
  with the stage env over it (the stage wins), plus `BATON_ROLE` and `BATON_ROLE_TABLE`; a message may
  use `{agent.name}` and `{agent.review}`. A missing or invalid table, or a missing role, parks the
  unit `launch failed` (a driver escalates); no attempt is counted.
- **Changed: `bin/baton-seat` execs the table's argv** with no shell: the message as the last
  argument (`inject`, at most 131071 bytes) or `Read <state>/briefs/<nonce>.md and follow it.`
  (`file`; `/` in the nonce is written `%2F`). New refusals `norole`, `noargv`, `notable`. A claim without `BATON_ROLE` still execs
  `omp-seat` from `OMP_T3_SEAT` and `OMP_T3_VIA`, so staged recipes run unchanged.
- **Changed: the example recipe.** Every session stage, `triage` and `driver` names its crew role;
  `instance`, `model`, the `OMP_T3_` keys and the `via` param are gone. The item flow is
  implement → verify → close → land, and correct → verify (`reclose` is removed). `verify`
  (role `verifier`, `build` slot) writes `out/<unit>/verdict.json` (new `briefs/verify.md`), and close
  runs with `--verdict`. `spine_review` runs `{agent.review}`. The briefs name each skill for both
  harnesses (`/<plugin>:<skill>` on Claude Code, `skill://<skill>` on OMP).
- **Changed: `running-a-spine-on-baton`.** A seat step reads `.crew/roles.md` and
  `~/.claude/crew/agents.md`, picks one agent per role, turns a plain-program `command:` into an
  argv (a shell function or alias is a question; a Devin argv ends with `--`), drops the PR
  placeholder from `review:`, and shows a stage/role/agent/command/model/effort table with the arm
  command. A role with no row is one question and arms nothing. The seat file is written only after
  the yes. `via` is gone.
- Known limits: triage can answer, and baton can interrupt, only an OMP seat's prompt, so a stuck
  Claude Code or Devin seat stalls into a stop; a close resumed after its commit halts on a stale
  verdict; untracked files left between `verify` and `close` halt close on a stale verdict (fails
  closed).

## 0.9.0 - 2026-10-29

The follow-ups triaged on 2026-10-29: #920, #906, #930, #908, #969 and three items of #899.

- **Fixed: a malformed `run.json` is refused (#920).** `readRun` refuses a run.json that is not an
  object, whose `id` is not its directory name, whose `status` is not `armed`, `parked`, `disarmed`
  or `done`, or whose `units` is not an object of objects keyed by their own id. Before, an array of
  units loaded, lost every unit on the next save and replayed the unit files. The CLI prints the
  real error (rc 2) instead of "no such run"; the tick reports it; the file is never rewritten.
- **Changed: a hook-failure park names its hook (#906).** `before failed`, `after_launch failed` and
  `run failed` (a merge stage's `run_after` too) add `hook` (1-based) and `argv` to the park event
  and end the notice with ` — hook <n> (<program>)`; the rendered arguments, which may hold a
  param's value, stay in the event and never leave the host. The reasons are unchanged,
  so the driver guard and `driver.md` still match. A driver's escalate notice keeps the suffix.
- **Fixed: Orca message files of refused launches are removed (#930).** New optional
  `Host.endRun(runId)`: the Orca host removes the run's files under `<state>/orca/messages/` when the
  run finishes and on `disarm`.
- **Changed: a `thread gone` park points at `seat.log` (#930).** New optional `Host.goneNote()`; the
  Orca host's names `<state>/claims/seat.log`, where a launcher refusal is logged.
- **Changed: a blocked park's screen tail keeps the picker's question (#930)** when it scrolled out of
  the last 12 lines, for the pickers `parsePicker` reads.
- **Changed: the park event leaves `questions` off when the list is empty (#899).** A test pins that a
  plain `unpark` keeps a unit's triaged request ids.
- **Changed: the example recipe (#908, #899).** `correct.md`, `spine-work.md` and `lane.md` end
  with a numbered step that writes their done file with the exact command. The spine PR's ack
  notice names the phone's Merge button.
- **Fixed: `baton-seat` refuses a message it cannot read after its checks (#930)** (`nomsg`),
  instead of launching the seat with an empty prompt: a disarm's message cleanup could race a
  launch.
- **Changed: `running-a-spine-on-baton` (#969).** The bridge check reads baton's `notify` argv and the
  bridge version; the agent check reads `agents[<repo>]` first; `oss` comes from the project's
  install entry; roots fall back to `oss repo_root`; the preflight checks one `target_repo`, the
  recipe copy's first use and `~/.local/bin/baton`; values are quoted; a yes that changes a value
  shows the command again; the arm is confirmed from `run.json`.
- **Added: `tests/skill.test.ts`** pins the skill's approval stop and no-watch rule and the done-file
  briefs' last step.
- Known limits: per-hook labels are not offered (index and program only); the question is kept only for
  pickers `parsePicker` reads; `{pending.questions}` still renders `[]` for an empty list.

## 0.8.0 - 2026-10-29

baton's first skill: a project's orchestrator can take a planned ossify spine to an armed run
without this marketplace's workspace memory (#964).

- **Added: `skills/running-a-spine-on-baton/SKILL.md`.** Prose. A read-only preflight (the spine
  is planned, no run of this project is armed or parked, the bot-on-openbot bridge is up, the
  project's OpenBot agent, both repos in Orca, the shared recipe copy against the installed
  example), then the full `baton arm` command with one source line per value, then a stop for the
  operator's yes. After arming: no watching, status only on request, and the README runbook for
  parks. The skill points to this README for the commands, the arm example and the runbook.
- Known limits: the `ossify-spine` example recipe only. The seat model `via` comes from the
  operator's current rule, so a project with no recorded rule gets a question. No Codex manifest.

## 0.7.0 - 2026-10-27

A blocked park can be answered from outside the Orca terminal, through a screen check that only
refuses (README, "Answering a blocked park").

- **Added: `baton screen <run> <unit>`.** One JSON line `{park_at, thread, screen, picker}` for a
  unit in a blocked park: its screen read now and the picker parsed from it, or `picker: null`. No
  lock, nothing sent. rc 2 when the unit is not in a blocked park (or the run is disarmed or done,
  an `unpark --to` is in flight, or the host has no `screen`).
- **Added: `baton answer <run> <unit> --park <at> --screen <n> <label>` and
  `--screen-text <text> --question <line>`.** Under the store lock, they read the screen again and
  send the picker's fixed keys only while the same blocked park and the same option label (or
  question line) are on screen. Every failed check is rc 2 with one line and nothing sent.
  `--screen-text` refuses empty text and any control byte. Events: `answered` with `screen` and
  `label`, or `screen_text: true` (the text is not logged). The three-argument form is unchanged.
- **Added: `src/picker.ts`.** `parsePicker` reads one live picker of two kinds, omp's `ask` box and
  its numbered `/review` box, and only a box with a `⏎ select` footer (the `ask` call above it and
  answered pickers read as none). `keysFor` and `textKeys` are the key sequences recorded on
  omp v18.11.3 (Up over every row, Down to the row, Enter; free text through the Other row).
- **Added: `Host.keys?(threadId, text)`.** The Orca host sends the text unchanged with
  `orca terminal send --text`; a gone terminal is `AnswerRefused("terminal gone")`.
- Known limits: other picker shapes read as no picker; free text needs an Other row; the check and
  the send are separate Orca calls.

## 0.6.0 - 2026-10-27

Orca is the only host (operator ruling 2026-10-27: no move back to T3).

- **Removed: the T3 host.** `src/hosts/t3.ts`, its login (`t3-login.ts`) and its MCP client
  (`mcp.ts`) are gone, with the `baton t3 login | token-status | call` subcommands, the tick's T3
  token-expiry notice, and `bin/omp-t3-claim` (the T3 claim launcher). `bin/baton-seat` reads the
  same claim files and stays.
- **Changed: the default host is Orca.** No `host` key, or `"host": "orca"`, selects it. Any other
  value, `"t3"` included, now fails `arm` and the tick with `config: host must be "orca"`; a config
  that still names `"t3"` must drop the key or set it to `"orca"`. The `t3` config block is no
  longer read.
- **Changed: the host-auth notice is host-neutral.** A host that refuses its credentials notifies
  `host auth rejected: <error>` once a day (was the T3 text `t3 token rejected — run baton t3
  login`). Orca raises no auth error, so this path is kept for a future host.
- **Example recipe.** Every stage drops `OMP_T3_DROP_T3_MCP` (it only told `omp-t3-claim` to
  remove T3's MCP extension). The README's T3 sections (login, the `omp-t3-claim` symlink, the loss
  against T3) are gone; Install links only `bin/baton`.
- **Kept, unused on Orca:** the host interface's optional `respond` and `pending`, triage, and
  `baton answer`. Orca reports no structured question, so a triage stage never launches there and
  `baton answer` refuses with rc 2; they stay for a host that can answer.
- Known limits: the claim keys keep their T3-era names (`OMP_T3_SEAT`, `OMP_T3_VIA`), because
  renaming them would break recipes already staged. A staged recipe that still sets
  `OMP_T3_DROP_T3_MCP` passes it to the seat as a plain variable that nothing reads.

## 0.5.0 - 2026-10-27

- **Orca host.** `"host": "orca"` in the config (`"t3"` is the default and stays so; any other
  value fails `arm` and the tick with `config: host must be "t3" or "orca"`) runs workers in Orca
  terminals. `baton tick`, `disarm` (which closes kept threads) and `answer` build the host from
  that key; the `baton t3` subcommands stay. An optional `orca` block gives `cli` (default `orca`
  on `PATH`, else `~/.config/orca/cli/bin/orca`) and `launcher` (default baton's own
  `bin/baton-seat`). A thread is a terminal and its id is the terminal handle. The T3 token-expiry
  notice runs on the T3 host only. The T3 host is unchanged.
- **`bin/baton-seat`**, the launcher an Orca terminal runs: it reads the claim for its working
  directory, then execs `omp-seat <seat> --via <via> <message>` with an argv. It refuses with exit
  78 (one line on stderr, one in `claims/seat.log`) on no claim, a bad claim line, a claim with no
  seat or via, a message file that is missing or 131072 bytes or more, or an `omp-seat` it cannot
  run (the message file stays); it deletes the message file after reading it. No message text
  passes through a shell: only the working directory, state dir, launcher and message-file paths
  do.
- **Orca status** comes from recorded Orca 1.4.238 replies: a terminal not listed is `gone` only
  when `terminal read` confirms it (a terminal-gone error or status `exited`), else host down; an
  agent `working` is `active`; `waiting` or `blocked` is `waiting`; `done` is `completed`, or
  `interrupted` when Orca says so. A missing agent row or any other value is `active`, never
  `completed`. A truncated `terminal list` or `worktree ps` reply, or one that does not cover the
  local host, is host down, not `gone`. Interrupt sends Escape (`terminal send --interrupt` does
  not stop an omp turn).
- **Optional host methods `close`, `screen` and `respond`.** On a host with `close` (Orca), every
  session end closes its terminal before the launch directory is released, except a park (kept until
  `unpark` or `disarm`) and an end after an `interrupted` status (kept until the run ends). Triage,
  driver and molt-parent threads are closed too. The T3 host defines `respond` only: its sessions
  end as in 0.4.0.
- **Blocked park** (only on a host with `screen`). A worker in `waiting` with no structured question
  parks at once and keeps its session and terminal; nothing is interrupted and the claim and
  directory stay. The notice reads `baton <run>/<unit> blocked in <stage> (project <project>): the
  worker waits on a question — answer it in the worker's terminal — screen: <tail>`. The park clears
  itself when the worker moves on. `baton unpark <run> <unit>` clears it by hand and `--to <stage>`
  ends the session and moves the unit. A stop file wins over a blocked park, and `disarm` closes the
  worker. No driver takes it, no stall clock runs on it, and the run summary counts it as "sent to
  you".
- **`baton answer <run> <unit> <label>`** answers the unit's pending question by the option's exact
  label (rc 0 sent, 2 refused, 3 host auth, 4 host down). It answers one question with one option:
  a request with several questions or a multi-select, an unknown label, no pending request or a host
  with no `respond` is refused. The example recipe's triage brief now uses it in place of the raw
  T3 tool, and the triage message carries `{run.id}`.
- **Narrowing.** A T3 request with several questions used to be answerable by triage through the raw
  T3 tool; `baton answer` refuses it, so triage writes a note instead.
- Known limits on Orca: a picker opened between turns reads `done`; an aborted omp turn reads
  `completed`; a worker in an `ask` dialog or with a live async subagent may keep running after
  Escape, and a park keeps its terminal, so it can run until `unpark` or `disarm`; `disarm` leaves
  live (non-parked) workers running, with their terminals and per-launch worktrees; after an Orca
  restart a live worker reads `active` until its next hook event. Orca gives an omp question's
  text but not its options, so an Orca host has no `respond` and triage cannot answer there.

## 0.4.0 - 2026-10-25

- A recipe may carry a top-level `driver` stage. When a unit parks, a driver session reads the
  unit's state file and writes one JSON result: resume (optionally `to` a stage `resume_to` allows,
  with a `cleared` name from `clearing`), escalate, or stop. Baton checks the result's closed shape;
  any refusal, a launch failure or a timeout becomes an escalate. A unit that parks again after one
  driver resume goes to the operator. Events: `driver`, `driver resume`, `driver escalate`,
  `driver stop`, `driver dropped`. Each result appends a ledger line. The driver's `state_file` and
  `result_file` must contain `{run.dir}` or `{run.id}` and `{unit.id}`, `result_file` the launch
  number `{driver.launch}`, and the two must differ:
  baton reads only the result file rendered for that launch, and removes it once a valid result is read.
- With a driver, the escalate is the only unit-park notice
  (`baton <run>/<unit> parked in <stage>: <reason> — <action>`, with the PR suffix of a merge-stage
  park); a driver stop parks the run with its own notice.
- A finished run sends one silent summary line (units, merged PRs, parks, drivers, wall time).
- `unpark` and `disarm` drop a live driver and release its claim.
- `baton unpark` of a `stop` park consumes its stop file, for every recipe: the file is renamed
  `<stop>.consumed-<iso>` and the `unpark` event records `consumed`.
- The ossify-spine example recipe gains a driver and `briefs/driver.md`: it settles flaky-CI
  (`rerun-check`) and dispatch-cap (`remove-file`) parks only.
- A recipe without a `driver` stage sends every park notice as before; the run-end summary and
  the stop-file consumption on `unpark` apply to every recipe.

## 0.3.2 - 2026-10-24

- A merge-stage park by the `red` or `conflict` outcome names its PR. The `park` event carries `pr`
  (the URL), `pr_state` (`red` or `conflict`) and, for red, `failing` (the red checks by name: a check
  run's `name`, a status context's `context`, once each). The notice ends with
  `— red: <checks> — <PR URL>` or `— conflict — <PR URL>`. Every other park is unchanged.

## 0.3.1 - 2026-10-23

- The `notify` argv now also renders `{key}`, the notice's one-line key (for a park,
  `<run>/<unit>/park/<at>`), alongside `{message}`.
- The `park` event now carries `thread` (the parked seat's thread id, when it had a session) and,
  for the `second prompt` and `triage gave no answer` parks, `questions` (the pending request's
  questions, as a JSON string). Both are absent when unknown.

## 0.3.0 - 2026-10-23

- Triage: a seat that waits on a prompt no one will answer (an OMP `/review` picker, a question
  tool) no longer just stalls. The T3 host reports a thread's pending user-input request
  (`ThreadStatus.pending`, from `thread.pendingRequestCount`). The engine pauses that seat's stall
  clock and, when the recipe has a top-level `triage` stage, launches one triage session per
  request id per stage visit. The stage takes the launch fields plus `note_file` and
  `stall_minutes` (default 10); its message may use `{pending.thread}`, `{pending.request}`,
  `{pending.questions}` and `{pending.stage}` (`note_file` may not). `stop_file`, `watch`,
  `before` and `after_launch` are accepted and ignored there; no other stage may then be named
  `triage`.
- New events: `triage`, `triage answered`, `triage relaunch` (the triage left a note, so the seat
  is relaunched and counts toward the two-stall park), `triage dropped`, and `pending` (a request
  seen by a recipe with no triage stage). New parks: `second prompt` (another request after the
  triage) and `triage gave no answer`. A stop file the triage writes parks `stop` as before.
  `baton report` counts `triage`, `triage answered` and `triage relaunch`.
- Example recipe `ossify-spine`: a `triage` stage and `briefs/triage.md`; `common.md` has every
  seat read a `triage-note.md` first, its ledger wording is fixed, and `spine-finish.md` now
  pushes the AI record. The MCP `clientInfo.version` string now reads 0.3.0.
- README: the triage runbook.

## 0.2.1 - 2026-10-23

- Example recipe `ossify-spine`: `spine_review`'s message now puts a space, not a newline,
  after the PR URL. OMP splits a slash command's arguments on spaces and tabs only, so the
  newline joined the URL to the next word, `/review` failed to parse it, and the seat opened its
  interactive Review Mode picker under T3 and stalled (#894). A recipe test pins the URL as
  `/review`'s own argument. The MCP `clientInfo.version` string now reads 0.2.1.

## 0.2.0 - 2026-10-23

- Example recipe `examples/ossify-spine/`: runs an ossify feature spine end to end on T3 — the
  detached run-spine lane, one implementer per work item, gap re-entry, close and correction,
  ordered merges onto the spine branch, the spine PR's review rounds, and the spine close — with
  its briefs (prose; one `common.md` every seat reads first). No engine behaviour change; the MCP `clientInfo.version` string now reads 0.2.0.
- README: the "Example: an ossify spine" section — the arm command and the operator runbook.

## 0.1.0 - 2026-10-22

First release.

- Engine: a recipe (validated, frozen at `arm`) drives units through stages; `baton tick` launches
  sessions when a unit is due, reads closed signals, and merges a pull request only by the
  recipe's rule, with parking, `unpark`, `status` and `report`.
- T3 Code host over the tailnet `/mcp` endpoint, and `baton t3 login` (OAuth with PKCE, token
  file mode 600).
- `omp-t3-claim`, the launcher that applies a claim file before starting `omp-t3`.
- systemd user timer: `baton timer install|remove`, installed by `baton arm` unless `--no-timer`.
