# Changelog

All notable changes to the `baton` plugin.

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
