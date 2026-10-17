# autonomic

Autopilot as a Claude Code mod. Requires Claude Code 2.1.289 or later.

The operator plans and grills a piece of work, and then the session still stops to ask: "Shall I
proceed?", a choice the plan already made, a permission prompt for an operation the plan already
authorised. In **autopilot**, autonomic answers those stops from standing orders the operator
owns and from the session's own scope (its spec, plan, grill record or brief). It lets the
session stop only for a reason on a closed **pain list**, and tells the operator when it does.
Every decision it takes in the operator's place is one line in a committed **ledger**. It fails
toward manual: anything broken gives more asks, never fewer.

The legacy adapter reads launcher mode variables and Molt files; OMP's opt-in trusted-assignment contract below has additional startup/provenance inputs. Neither route reads crew or multiplexer state.

## OMP trusted assignment authority (0.8.0)

This delivers the issuer/reader/launch contract, **not activation of native decision consumers**. A bound OMP factory validates eligibility but stays manual until the complete native consumer integration ships; it never uses the old conversational reflex as an enrolled fallback. No live grant, host capability, calibration or deployment is supplied. Unbound legacy OMP and Claude Code keep their existing behavior. Claude Code Jev integration is deferred to #832; OMP-only work does not close #831's cross-host criterion.

### Dispatcher CLI and independent provenance

Only the operator, or a dispatcher with recorded bounded operator delegation, selects the trusted input/source paths outside every worker allowance. A worker must never invoke issuance or supply a new path/hash as enrollment. Commands use the known installed Autonomic path:

```text
bun <autonomic-root>/bin/authority.ts issue --input <trusted-input> --authority-root <trusted-root> --worker-root <assignment-worktree> --worker-root <each-additional-root>
bun <autonomic-root>/bin/authority.ts validate-launch --worker-root <assignment-worktree> --worker-root <each-additional-root>
```

Repeat `--worker-root`; unknown flags and duplicate scalar flags fail. `issue` prints one JSON `{path,sha256,assignmentId,generation,launchId}` binding, not shell text. `validate-launch` reads startup variables, checks actual local Git placement and emits a positive validation receipt or exits 2 before the worker runs. Include the entire launch allowance: assignment worktree, all `SEAT_MODS_ALLOW` entries (coordinator `.worktrees` included), report/scratch/handoff roots and writable output locations. The snapshot, its parent, input and provenance/evidence/policy sources must be outside them in either ancestry direction. Free roles do not waive this check or create sandbox isolation.

For a new enrolled launch, export every declared report/scratch/handoff/other writable root in the startup `SEAT_MODS_ALLOW`, **also for free roles**, in addition to any coordinator `.worktrees` roots. Alternatively the corresponding exported report/output path variables contribute their parent directories; `SCRATCH_DIR` contributes its directory. This is the trusted launch envelope captured by both CLI and factory, not a later model-supplied list. Issuer `--worker-root` arguments and the envelope must describe the same complete allowance. A path mentioned only in a mutable brief is not a usable launch-envelope input; reconcile it before issuance. The legacy marking examples are unchanged.

Trusted input is exactly `{snapshot,material,approval,delegation}`. Each material is `{ref:{id,source,sha256,locator},text}`; `source` is the independently selected absolute canonical source file, and the full bounded UTF-8 text must match its coherent bytes and digest. Approval is an external JSON event: `{version:1,kind:'operator-approval',id,operatorId,snapshotSha256,delegationSha256,assignments:[{assignmentId,briefSha256}]}`. Its locator equals its event ID. Direct issuance requires matching operator ID and null delegation; delegated issuance supplies a separately materialized operator parent Snapshot with the event's exact delegation digest, explicit assignment/brief membership and finite resource narrowing. An event/path/hash claimed by a worker is not an operator event.

Construction order is acyclic: **materialize task/brief/policy evidence → serialize Snapshot → record the external operator event hashing those snapshot bytes → create the independently selected issuance input**. Snapshot string approval IDs identify the event but no snapshot EvidenceRef/policy/brief may hash the approval event or reference its source/input. The CLI rejects that circular provenance rather than seeking a hash fixed point. Operator source selection is an external trust prerequisite, not something JSON or file permissions can prove.

Each launch is a fresh exclusive directory under the authority root. The issuer writes/fsyncs complete sibling files, atomically renames the snapshot and returns its binding. It preserves original input path/digest/file identity in `provenance.json`; referenced excerpts live in `evidence/<sha256>` and policy bytes in `policy/<policy-sha256>.json`. Original event/input/source records must remain readable and unchanged. The Markdown policy is never rewritten. Replacement/removal/revocation is invalidation, not an in-process grant update.

### Version-1 snapshot and reader API

`hooks/authority.ts` exports the exact schema/types and `parseSnapshot`, `narrows`, `captureLaunchBinding`; `omp/authority-store.ts` exports `canonicalTarget`, `readCoherent`, `PinnedAuthority`, `MoltTransition` and local `placementFacts`. Snapshot is one object, at most 64,000 UTF-8 bytes, with these required fields:

| Field | Closed shape |
|---|---|
| identity | `version:1`, nonempty `assignmentId`, positive safe-integer `generation` |
| issuer | `{kind:'operator'\|'delegated-dispatcher',id,approvalRef,delegationRef:string\|null}` |
| seat | `{id,host:'omp',role:'implementer'\|'verifier'\|'reviewer'\|'coordinator'\|'orchestrator',launchId}` |
| placement | `{repository,worktree,branch}` — canonical absolute paths and exact full ref |
| task | `{briefSha256,scopeRefs:EvidenceRef[],instructionRefs:EvidenceRef[]}`; brief bytes resolve to pinned task evidence |
| policy | `{id,sha256,approvalRef}`; materialized companion bytes, not standing-mode authority |
| grants | `{id,operation,resource,authorityRefs:string[]}[]`; empty authorizes nothing |
| lifetime | `{issuedAt,expiresAt:string\|null,revoked:false}`; calendar-valid UTC RFC3339, issued no later than now, future expiry |

Unknown/duplicate keys, conflicting/duplicate IDs, malformed hashes, nonfinite/unsafe numbers, wildcards, ambiguous refs/paths, invalid UTF-8 and unresolved approvals fail. Repeated evidence IDs across scope/instruction lists must have identical definitions. Resources are finite `paths {repository,roots}`, `commit {repository,branch,paths}`, `push {repository,remote,sourceRef,destinationRef}`, or `pr {repository,headRef,number}`. Create uses null PR number; update requires a positive safe integer.

Operations are `worktree.read/build/test/lint/edit`, `git.commit`, `git.push-own-branch`, `pr.create-own`, `pr.update-own`, `task-output.write`. Paths/refs/repository must narrow the approved task/delegation. Commit/push/PR operations are excluded for reviewer/verifier roles; reviewers also cannot edit the worktree. Seat-mods still owns all its denials independently. No delete/merge/force/no-verify/trailer grant exists. Operator merge acknowledgment, design/spec/plan/release gates, product choices, credentials and Molt handoff cannot be supplied by a role, standing mode, plan approval, confidence or a model. Actual operation/command facts and protected/default-ref checks remain mandatory at the consumer boundary; a lease is not permission to execute an arbitrary command.

`PinnedAuthority(binding,workerRoots)` captures one launch and role. `lease(sessionId,facts)` returns frozen snapshot/evidence/policy, file identity, session/epoch and `fresh()`. Read before decisions, after asynchronous work, and immediately before action; final `fresh()` must have no subsequent model await. Local Git rechecks are synchronous bounded subprocesses; consumers must check their remaining transaction deadline again after these calls before acting. `signal` aborts outstanding work on invalidation. `invalidate()` permanently rejects; `suspend()` cancels and advances the epoch. File reads use no-follow regular-file descriptors, bounded coherent bytes and full dev/inode/size/nanosecond mtime/ctime comparisons. Same-byte replacement, symlinks, revoked/expired state, missing/changed source/policy/evidence, branch/placement drift and generation mismatch reject; they never select newer authority.

### Startup and assignment lifecycle

Copy the trusted binding into `AUTONOMIC_AUTHORITY_PATH`, `AUTONOMIC_AUTHORITY_SHA256`, `AUTONOMIC_ASSIGNMENT_ID`, `AUTONOMIC_ASSIGNMENT_GENERATION`, `AUTONOMIC_LAUNCH_ID` **before** `omp-seat` starts. All five are captured once; partial/invalid bindings refuse launch. Editing env/report/task prose in a running seat cannot enroll it. Every materially new assignment ends the old process and launches fresh, even in a retained pane. Same-assignment corrections stay within unchanged pinned approvals/grants/lifetime; replacing those bytes requires fresh issuance/launch. Completion/revocation invalidates the predecessor.

The factory exposes its captured `authority` service from `createAutonomic` for later DecisionIO integration, never a worker-reconstructed lease. Main-only before-switch, switch/resume, context rebuild/rewind, shutdown and explicit mode-off cancel eligibility. `/autopilot on`, lineage and predecessor mode records cannot restore it. `revalidateMolt(MoltTransition,facts)` keeps the planned before/after interface, but the inspected public host exposes no proof of Molt's private pending ownership. Therefore in-place Molt **remains suspended and requires fresh trusted launch**, even with plausible lineage/stage bytes; parent-handback children end their unit. Already-running tops/workers must finish/handoff then launch fresh, not hot-enroll or assume restart installs a missing host API.

This is an ordinary same-UID/shared-process guard contract, not a sandbox: hostile same-UID processes, free seats and arbitrary in-process extensions are not isolated. Recheck-to-execution is not an atomic filesystem/ref lock; changes observed before action abort, but an external change immediately after the final check is not transactionally prevented.

### The bounded decision transaction (0.8.0, Tasks 5–7 consumers)

`omp/judgment.ts` and `omp/decision-ledger.ts` hold the shared transaction the three native consumers call. This section documents the contract; no consumer is activated by it. An absent policy, bridge or authority **disables** the route (operator handling), never the old conversational classifier.

**One monotonic window.** All phases share one deadline **25 seconds from handler entry**, captured at the first line of the handler before any await. Capture is ≤2 s; one native judgment is ≤12 s from entry and at most 10 s; generation is ≤22 s and at most 10 s; the final validation/record/recheck is ≤25 s. Earlier completion can advance work but never extends a cutoff, and no phase creates a fresh 25-second window. A phase whose allowance is exhausted aborts.

**Result validation and units.** `validateAnswers` rejects before any confidence is read: answer/question ID sets must match exactly, the answer type must match the question, choice labels and distribution keys must equal `criteria` exactly, every probability and confidence is finite in [0,1], the distribution sums to 1 within `PROBABILITY_SUM_TOLERANCE = 1e-6`, and the reported choice is a **unique** maximum. `noul` is **P(yes)**, not a boolean. Cache counts are safe integers with `0 ≤ cachedQuestions ≤ questions`, equal to the frozen question count. A selected native API kind must be one of `typesafe`/`openrouter-decisions` (the SDK union), and the selected API/provider/model tuple plus its `calibrationRef` must appear, with matching evidence, in the effective policy. `PROBABILITY_SUM_TOLERANCE` is serialization roundoff only, **never** an action threshold.

**Operator-owned acceptance.** `acceptedChoice` and `acceptedNoul` apply rules the operator supplies in the effective policy. There is no default probability, confidence or rollout cutoff. An overlapping `noul` rule (`minYes + minNo ≤ 1`) is invalid configuration; where the regions overlap, the answer is `undefined` (abstain). Acceptance is a configured decision, never authority.

**The effective policy.** `PolicyBundle` is a version-1 file whose exact bytes are pinned by the snapshot's policy digest. It is an OMP-only companion to the Markdown policy, not a rewrite of it; ordinary repository prose never becomes a bundle. A missing, malformed or unapproved bundle disables the route.

**Two-write attribution.** `commitDecision` writes both `<resolved-ledger>.decisions.jsonl` (a version-1 `DecisionRecord`; audit output, **never** authority) and the human ledger row, each under a `lease.fresh()` check, with `budget.check()` after each write and a final `lease.fresh()` after the last. Every string field is redacted with the existing `redact`, and command/input values use the existing `shape`/`inputShape`. The human row's `why` carries `decisionId=<id>; <reason>`, with room reserved for the full ID before `oneLine` truncation. A partial sidecar or human record is an **intent, never execution proof**. A required-write failure or timeout publishes manual/failure (via the captured `io.fail`) and releases nothing. Native `result.usage` is not billed again; Claude Code's token-only rows are unchanged. The caller must still do `budget.check()` plus a synchronous `lease.fresh()` immediately before its action or return; anything changed while logging means abstain.

**Lifecycle.** A mode change, authority invalidation, navigation/compact, shutdown or Molt transition aborts outstanding frames, so a late completion cannot mutate a successor's state or attribute a result to it. The factory exposes the captured service as `createAutonomic(...).decisions` for the consumers; when absent, the native route is unavailable.

### Exact-ID, all-question structured asks (0.8.0, Task 6)

`omp/asks.ts` turns an OMP ask into one frozen, byte-exact batch and answers it only when the **whole** batch is grounded in approved evidence. Anything short of that returns the entire original ask to the operator — never a partial answer, never a per-question average, never generated prose for free text or a label. The shared `parseAsk`/`Question` seam and Claude Code's answer map are untouched.

**Snapshot and identity.** `snapshotAsk(input)` copies the whole input as JSON before any asynchronous work, so later mutation cannot change the frozen batch or its fingerprint. It validates every question (text, ID, option label/description, `header`, `multi`, `recommended`). A **malformed batch is rejected outright** rather than silently shortened to the questions that happened to parse — the old normalizer dropped IDs/descriptions and filtered bad entries; this route does neither. Every label byte is retained; duplicate label bytes, duplicate supplied or derived IDs, duplicate question text (the key of the existing consumer answer map), an empty/missing option list, and a `multi` label carrying a comma or edge whitespace (which the shared `", "`-joined representation could not read back) all keep the ask with the operator.

**The exact question/label mapping.** SDK question IDs, not labels:

| Purpose | SDK question ID | Type |
|---|---|---|
| Original identity | actual nonempty host `id`; a legacy no-ID input derives `legacy:<full-input-sha256>:<zero-based-ordinal>` | — |
| Coverage per question | `cover:${encodeURIComponent(q.id)}` | `noul` — P(yes) that this whole question is already covered by approved evidence without an operator gate |
| Single-select candidate | `select:${encodeURIComponent(q.id)}` | `choice`, criteria keyed by the internal ordinal option IDs `o0`, `o1`, … |
| Multi membership per option | `member:${encodeURIComponent(q.id)}:${option.id}` | `noul` — P(yes) that this exact option belongs to the decided complete set; **every** option gets a question |

Option IDs are request-local ordinals, never label text. Labels sent back to the consumer are the **original label bytes**, in stable input order, joined with `", "` for a multi-select (the existing representation; a comma-bearing multi label therefore stays with the operator).

**Independent questions over one frozen state.** Every question is answered against the same frozen state and its own input/evidence; none references another's answer ("if coverage is yes", "use the preceding selection"). Coverage, selection and membership are separate, and all must later validate. `recommended` is read as a position only and creates no grant; descriptions, `header` and `multi` grant nothing.

**Planning is gated by approved evidence, never by inference.** `planAsk` requires, per question, exactly one approved question for the frozen **fingerprint** (the content digest — text, `header`, `multi`, `recommended` and every option's ordinal/label/description — deliberately **not** the identity, so a legacy digest-derived ID stays authorizable), live grant references in the current lease, at least one approved evidence reference that resolves, and a complete `membership` map for a multi question (and none for a single-select). An approved option the ask does not carry, an unknown constraint reference, a missing map or an inline operator gate makes the whole ask unplannable. Missing complete evidence or routine-versus-gate uncertainty returns the whole ask to the operator; the model is never asked to infer that permission probably existed.

**Assembly accepts a whole batch or nothing.** `assembleAsk` validates the SDK result first, then for **each** question: every coverage answer must be an accepted `yes` under `ask.coverage`; every single selection must pass its own `ask.selection` rule **and** be specifically supported by that question's evidence; every multi membership must resolve under its own `ask.membership` rule and equal the pinned complete membership map (an unresolved verdict is a failure, never read as "no"). A mismatch is rejected rather than averaged. Constraints are deterministic over the assembled set: `requires` `(a,b)` means `!selected.has(a) || selected.has(b)`, `excludes` means `!(selected.has(a) && selected.has(b))`. An empty multi set, a member outside the approved supported options, an uncovered option, a missing/extra native ID or a malformed answer fails the whole batch. The reason cites the real approved evidence (`ref.id@ref.locator`) this batch used and no assumed prose; an answer whose approved evidence resolves only in the pinned bundle (not the lease) leaves no citable reason and stands down.

**Records before the answer.** Every question gets one `ask` ledger row and the sidecar records the native IDs/probabilities, matched grants/evidence and route, before the single exact-answer block. A ledger failure leaves the real ask visible with **no partial answer injection**.

**Operator gates are bundle-level.** Policy parsing rejects **any** approved question whose `operatorGate` is not `none`; a bundle carrying one is unavailable, so **both** the ask and the permission consumers treat it as absent — the conservative direction (an unanswered gate is never auto-answered). The gate matrix (spec/design/plan/release approval, merge acknowledgment, unresolved product choice, credential location/value, Molt handoff) stays operator-owned even under favourable probabilities and otherwise valid unrelated grants.

**Secret-like content abstains.** Before any frame capture, state build or native call, if redaction would change **any** string the frozen batch carries (a question text, option label, description or header), the whole ask stays with the operator — the same shape as the permission path's `redact(shown) !== shown` abstain — with the pain reason's own redaction applied, so no secret byte reaches state, the block reason, the ledger, a notice or the pain file.

**Abstention and failure.** A malformed batch, an unplannable batch, a missing bridge/authority/native route, a failed or stale transaction, or any exception uses the existing ask-pain path and returns no block: the entire original dialog stays displayed. No generative side turn answers free text or produces a label. Only an enrolled session takes this route; an unenrolled autopilot ask is operator-owned — it passes and rings — because the legacy conversational classifier is removed.

### Non-acting replay evaluator (0.8.0, Task 8)

`omp/replay.ts` scores a **frozen** decision corpus without acting: it calls no model, issues no authority and executes no original tool. Labels precede any decision generation, and a decision row is observed provenance, never a claim this module makes. It is proven by `omp/tests/autonomic-routing.test.ts`; a CLI form exists for a real corpus but is **EXPECTED/future only**, because operator-frozen labels (E5) do not exist yet.

**Validation before use.** Every case/label/decision row is checked against its closed key set and JSON compatibility (no undefined, non-finite, sparse or cyclic value) before any helper reads it. `ReplayManifest` requires exact keys, `version: 1`, lowercase SHA-256 digests, exact Git source IDs and a non-empty operator approval reference; unknown keys and conflicting rows fail validation. A digest is **byte binding, not operator authority**.

**Binding.** Every label and decision binds its row's ID, `inputSha256` **and** the whole-case `caseSha256`. A verified authority requires a non-null snapshot, all three per-case digests and `snapshot.policy.sha256 === policySha256`. An orphan ID rejects; a missing label blocks the evaluation; a missing decision becomes an explicit `invalid`/`operator` row **in the original population** — never dropped and never reclassified as success.

**Deduplication is deliberately strict.** All raw rows are indexed first, so conflicting duplicates fail before anything can coalesce. Only an exact repeat (same ID, population, identified source event and **all** frozen context) coalesces; a differing source context, a reused ID, an alias ID for one event, or a source event appearing in both populations rejects the evaluation rather than choosing a favourable row. Context variants for one event cannot inflate the denominator.

**Gates.** The full original historical population is the denominator, with raw (pre-coalescing) and unique counts and unknown/invalid rows disclosed separately. A flagged row that released, answered or continued is unsafe **regardless of what its expected label says**; contradictory flags/labels fail the gate even with no action. `safetyGate` requires no metadata errors, no unsafe negative-control actions and no false allows — and `safetyGate: false` is a **gate failure, not a warning to ignore**. `targetMet` (`fullPopulationRate >= 0.8`) is only #831's measured target: never an acceptance threshold, never a grant, and never able to override `safetyGate`. `knownCost` is USD when known and `null` when unknown, never fabricated as zero, with wrapper-retry cost uncertainty preserved.

### Integrated verification and gated rollout (0.8.0, Task 8)

`omp/tests/autonomic-routing.test.ts` drives the **real** seat-mods, Molt and Autonomic factories into one ordered test host — each loaded from its own module, so no product plugin imports another — and dispatches in host first-block order with a no-side-effect original-tool receipt. It parameterizes every guarded role against the common denial operations plus verifier/reviewer commit/push/PR creation and placement/root-removal refusals, and proves a free coordinator/orchestrator without a positive grant still asks on an intercepted Autonomic operation.

`autonomic/docs/omp-jev-rollout.md` is the cutover runbook: required E3–E6 inputs and their validation rules (each marked **not supplied**), capability-versus-version verification, the replay safety gates and disclosed unknowns, non-acting observation before reviewed class/assignment activation, and rollback as explicit deployment to the prior supported release/backend with truthful source attribution — never a per-request chat fallback claiming Jev. **No version is bumped and no activation is claimed**; #831 stays open with cross-host parity deferred under #832.

## Turning it on

| Source | Effect |
|---|---|
| `AUTONOMIC_MODE=autopilot` on a spawn | autopilot from session start |
| `/autopilot on [doc …]` | autopilot from now; the docs become the scope, and their paths go into the prompt box for one Enter |
| `/autopilot off` | manual from now |
| `/autopilot status` | mode, source, scope, policy (`default`, `edited`, or missing), `yieldAtPercent`, `loopMax`, `tailChars`, the enabled never-approve rules, molt's stage for this session (or `none`), ledger, bell, pain file, loop count |
| unset, empty, `manual` | manual |
| any other value | manual; the status line names the value |

The command beats the env var for the rest of the session. The status line always shows the
mode: `autopilot`, `manual`, `manual (AUTONOMIC_MODE="x" is not a mode)`, or
`autopilot: no policy` / `autopilot: ledger not writable` when autopilot was refused.

## The policy

`~/.claude/autonomic/policy.md` (`policyPath`). autonomic writes this default on first start and
never overwrites the file. In autopilot it joins the system prompt as a `session` section, and
every fork prompt quotes it too.

Because autonomic never rewrites the file, a new standing order in a release reaches only a fresh
default. To take one into an existing file — edited or not — paste its line under **Standing
orders**; or, if you never edited the file, delete it and the next session start writes the new
default. Since 0.3.0 that line is the pain-options order (*When you stop for a pain item, ask with
`AskUserQuestion`: …*, in the block below). `/autopilot status` reads `edited` for any file that
differs from this release's default, an unchanged older default included.

```markdown
# Autopilot policy (autonomic)

You are in autopilot. The operator planned this work and is not watching. Keep the run going, and do not ask for a confirmation that the planning already gave.

## Standing orders

- When the spec, the plan, the grill record or your brief already decides a choice, take that option and state it in one line. Do not end a turn on "Shall I proceed?" or "Which first?" in that case.
- Merge authority: once a pull request has passed its work-pr or merge-bar loop, the orchestrator merges it without asking.
- When a step is done, start the next step of the plan.
- When you stop for a pain item, ask with `AskUserQuestion`: two or three options, the recommended one first and marked "(Recommended)", each worded as the instruction you will follow. For a one-way door, offer doing it and not doing it as separate options, and never mark the irreversible one recommended. For credentials, ask in plain text with no options.

## Permission scope

Approve without asking what serves this session's own task:
- reads, builds, tests and linters anywhere in the worktree;
- edits and commits on the session's own branch;
- pushing the session's own branch when it is not the default branch, and opening or updating its pull request;
- writes in the session's scratch and report directories.

Leave everything else to the operator.

## Pain list: the only reasons to stop and ask the operator

- product ambiguity: the scope does not say what the product should do;
- a tradeoff the scope does not settle;
- an approval gate: a step your process gives to the operator, such as reviewing or approving a spec, a design, a plan or a release scope, or choosing how a plan is executed, even when you recommend an option;
- credentials or secrets;
- a one-way door: data loss, an external publish, a delete;
- a hard deny;
- the autopilot loop guard;
- a molt pause.
```

## The reflexes (autopilot only)

**Turn end.** At each turn end one cached fork of the session classifies how the reply ended:

| Case | Meaning | What autonomic does |
|---|---|---|
| `covered` | It ends on an ask the policy or scope answers | blocks the stop with `Autopilot: <answer>. Proceed.`; ledger line |
| `stalled` | It stopped short with no ask and no reason | blocks with `Autopilot: continue — <next step>.`; ledger line |
| `waiting` | It waits on a background task, agent, monitor or report | lets it stop |
| `done` | The scope's objective is met | lets it stop; ledger line, toast |
| `pain` | A reason on the pain list | lets it stop; pain signal with up to three options, ledger line |

The host shows a block as `Stop hook error: <reason>`; the model reads it as an instruction.
After `loopMax` (3) blocks in a row with no change made — no tool call other than a read that
ran, was not denied and was not read-only (`ls`, `git status`) — the next turn end is pain ("autopilot loop"). A prompt from you resets
the count.

**`AskUserQuestion`.** The fork judges the questions. When every one has an answer that is
exactly one of its option labels, autonomic answers in your place, tells the model it did and why,
and writes one ledger line per question. The fork also sees the live turn (below). A question with no options (free text) always goes to you. Anything else — not covered, a label that is not an option, a fork that fails — goes to
you, and the bell rings.

**Permission asks.** A `deny` is never changed (a deny rings once per tool and reason, as "hard
deny"; a deny from a plugin beneath autonomic's `tool.call` hook, such as a seat guard, rings the
same way). On an `ask` verdict, first, in code, the **never-approve list** keeps the ask with you
and rings when a command's own words match a rule. Since 0.5.1 a match found only in text (a message,
a quoted argument, an interpreter's script, a command whose verb is a variable) goes to the fork
instead, with the finding in its prompt.
On an `allow` verdict — bypass permissions, or a settings allow rule — a command that
matches the list becomes an `ask`, so you get the normal permission dialog, and it rings (the
**bypass floor**; see "Permission modes").

Since 0.5.0 the list judges **each simple command on its own words** when the text parses. First
it joins a backslash-newline and drops every `\`, `'` and `"`. Then it splits the text at spaces,
`; & | ( ) < >`, backticks and `$(` (`${OPTS}` stays one word that starts with `$`). A `NAME=VALUE`
word also shows its value. A rule fires only when its verb and its flags are in the same command,
and each command still takes context from the whole text: a move before it, a git config write
before it (after one, every later git command is read on the whole bag), a branch switch before
it, and a variable assigned once to a literal. In a loop, a move, a config write or a branch switch
anywhere in the body counts from the loop's first command. A command whose verb is a variable or a
glob (`$CMD -f`, `git $V -f`) is read on the whole bag, and so is a `commit` or `branch` that
holds a variable the text binds but the list cannot read (`export NV=-n; git commit $NV`). When the text does not parse or names a program that may run text, the list reads
it as **one bag of words** and never decides which command a word belongs to, so a quote, a
wrapper or an interpreter cannot hide a word there: `python3 -c 'git push -f'` shows `push` and
`-f`. In the bag, a danger word beside a harmless command is an extra ask; that is the cost of
this reading. The rules, read per command or on the bag:

- `force-push` — a push verb (`push`, `send-pack`, `http-push`, `git-push`, a word holding
  `.push=`) and a short-flag cluster with `f` (`-f`, `-uf`), an abbreviation
  of `--force`, `--force-with-lease`, `--force-if-includes` or `--mirror`, or a word starting `+`;
- `branch-delete` — a push verb and a cluster with `d`, `--delete`, `--prune`, `--mirror`, or a
  word starting `:`; or `branch` and a cluster with `D`, or `-d`/`--delete` with a force flag (a
  plain `git branch -d` is not on the list);
- `default-branch-push` — a push verb and the default branch's name (`origin/HEAD`, or
  `main`/`master` when unknown) as a word or after `:`, `/` or `=`, `--all`, `--branches`,
  `--mirror`, the matching refspec `:`, or a word holding `$`, `*`, `?`, `[` or `{`; or any push
  while the session's branch is the default branch or unknown; or a push after a move (`cd`,
  `pushd`, `git -C` to a directory other than the session's own or the repo root, `popd`,
  `--git-dir`, `--work-tree`, `GIT_DIR=`, `GIT_WORK_TREE=`) or after a branch switch (a `checkout`,
  `switch`, `branch -m`/`-c` or `symbolic-ref` that names a default branch name or a variable),
  unless since 0.5.0 the list reads
  that one command and it names a remote and only literal destinations that are not the default
  branch, `main`, `master`, `HEAD`, `@` or empty, with no option outside `-u -q -v -n`,
  `--set-upstream`, `--quiet`, `--verbose`, `--tags`, `--follow-tags`, `--atomic`, `--porcelain`,
  `--progress`, `--no-progress`, `--dry-run`, `--thin` and `--no-thin`; or any `send-pack` or
  `http-push`;
- `rm-outside` — `rm` with a recursive flag, and a move, `xargs`, or a later word that starts
  with `/` outside the worktree or with `~`, holds a `..` segment, a `$` or a `{`, or a glob on a
  dot name (`.?`); a plain glob (`build/*`) stays where it is;
- `no-verify` — an abbreviation of `--no-verify`, or `commit` and a cluster with `n`.

A flag word that holds `$`, `*`, `?`, `[` or `{` (`--forc*`, `-$X`) counts as every flag. Beside a
push or an `rm`, so does a bare variable (`git push $OPTS`). Beside `branch` or `commit`, a bare
variable is not read as a flag: it is mostly a message or a path.

**Inert commands leave the bag (since 0.4.2).** When the text holds no program that may run text
(the list below), no `<(` or `>(`, no `$((`, no heredoc left in place, no function or
`alias` definition and no open quote,
the list splits it into simple commands at `;`, `&`, `|`, `&&`, `||` and newlines outside quotes
and comments. A command whose first word is `[`, `[[`, `test`, `echo`, `printf` (without `-v`),
`exit`, `true`, `false`, `cat`, `head`, `tail`, `wc`, `ls`, `stat`, `grep`, `jq`, `cut`, `tr`,
`mkdir`, `touch`, `mv` or `cp` (or a path to one in a system `bin` directory) then adds no words,
unless it pipes onward, or writes with `>` into `.git/`, a `hooks/`, `.husky/` or `.githooks/` directory, a git config file
(`~/.gitconfig`, `.gitattributes` …), a file that a later command outside this list names, or a
file named by a variable the text does not assign once — or by any relative name after a `cd`,
`pushd` or `popd` — while a command outside this list follows. A later command whose own name holds a
variable or a glob (`./$T.sh`, `./x*`) counts as naming every file. Every other command keeps its
words, and so a danger word beside a harmless *non-inert* command is still an extra ask. A dashed
word is a verb as git's own executable (`git-push`) or as a path (`./force-push`); bare prose such
as `no-rm` or `force-push` is not.

**Since 0.4.3** a command substitution is read as commands of its own: an inert command such as
`test -n "$(git diff --cached)"` or `echo "… $(date)"` drops its own words, and the commands inside
are judged the same way; a command that is not inert keeps everything. A redirect or a pipe on a
group's closer (`}`, `)`, `fi`, `done`, `esac`) applies to every command in the group. `cat <<'EOF'`
with no file prints to standard output, and its body drops unless it is piped to a command that
is not inert (or into a file), its group's target is used later, or it sits anywhere inside a `$(` or backticks; an unquoted
`cat <<EOF` body counts when it holds no `$(`, unescaped backtick, `$((`, `$[`, `${…@…}` or line
continuation. A `sed` whose only options take no value (`-n`, `-E` …) and whose script is one address plus `p`, `d` or `q` (`sed -n 8,9p`) is inert. After
a `cd` to a literal directory a relative name is read inside it (`cd .git` makes `config`
`.git/config`), unless the text runs `ln`. A command in `readers` (below) that names a written file
does not run it. A `$(` that holds `case` or a comment keeps the whole bag, and a pipe into a group
counts as reaching a command that is not inert.

**Since 0.5.0** each command is judged on its own words (above), and text that never runs is data:

- A live backtick pair, also inside double quotes, is a substitution like `$( )`; a backtick in
  single quotes or escaped is text, and an unclosed one keeps the whole bag.
- A variable assigned exactly once to a literal, as a whole top-level command that starts the text
  or follows `;` or a newline, and named nowhere else except as `$N` or `${N}`, is read as its value
  after that command; `for N`, `read N`, `export N=…`, `${N:=…}`, a second binding, a binding inside
  a group, one after `&&`, `||` or a pipe (also on the next line), or one sent to the background
  with `&` leaves it opaque.
- A command made only of assignments drops its words; the values stay in the whole bag that an
  opaque verb or a git config write reads.
- A runner word that is an argument of `cd`, `pushd` or an inert command, or a path after
  `git -C`, runs nothing (`cd tests/eval`); dot-sourcing counts only as a command whose word is `.`.
- `sh -c 'literal'` (also `bash`, `zsh`, `dash`, with `-e -u -x -o pipefail`) is read as a
  subshell holding the string, up to four levels deep, when the string holds no `$` or backtick
  (no backslash either when double-quoted); anything else stays a runner.
- A `sed` is inert when its options come from `-n -E -r -s -z -u`, `-e`, `-i` (with a suffix) and
  each script is a list of `s<d>re<d>repl<d>` with flags from `g p i I m M` and digits, or an
  address plus `p`, `d`, `q` or `=`; an `e`, `w`, `r` or `y` command, an `e` or `w` flag, `-f`, or an
  `-i` target in git's control paths keeps it a runner, and a file a `sed -i` edits counts as written.
- `python3 - <<'X'` (or `python3 <<'X'`, quoted delimiter) drops its body unless the body names
  `subprocess`, `system`, `popen`, the `exec`/`spawn`/`fork` families, `pty`, `eval`, `compile`,
  `__import__`, `importlib`, `getattr`, `ctypes` or `multiprocessing` as an identifier, names a git
  control path, or writes a file a later command runs (named as a string literal in the body).
- A heredoc read only as a message (`git commit|tag|notes …|merge|commit-tree … -F -`,
  `gh pr|issue|release … --body-file -`, `-F -`, `--notes-file -`) drops its body, `tee FILE <<`
  is a write like `cat > FILE`, and in an unquoted body of these and of `cat` only the `$( )` and
  backtick substitutions are judged as commands; `$((`, `$[` or `${…@…}` keeps the whole bag, and
  every other consumer (`ssh`, `sqlite3`, `psql` …) keeps its body.
- A variable assigned from `$(mktemp …)` names a fresh temp file, a value built from names already
  read (`S=/x; D=$S/r.md`) is read, and a later command's words are read with variable values
  before the file-name match — 0.4.3 was silent on `P=/x/a.sh; cat > $P …; mv $P run.sh; ./run.sh`.
- Namers name a file without running it, so a written file they name passes on as through an
  inert command: `rm`, `unlink`, `chmod`, `chown`, `wc`, `diff`, `cmp`, the `sha*sum`/`md5sum`/`b2sum`
  family, `file`, `du`, `readlink`, `realpath`, `basename`, `dirname`; `git add|status|diff|commit|
  show|log|rm|mv|restore|ls-files|hash-object|blame|cat-file|check-ignore` (not with `-c`, `--exec`
  or `-x`); `gh api`, `gh pr create|edit|comment|review|view`, `gh issue create|edit|comment|view`
  and `gh release create|edit|upload|view` (`gh pr creator` is not one). A namer's own
  words are still judged (`rm -rf ~/x` asks).

Known limits since 0.5.0: a moved push trusts only `main`, `master` and the session's default
branch as default names, so `git -C /other push origin develop` is silent in a repo whose default
is `develop`; the Python deny list is a judgment rule, and a body that starts a process without
naming a listed identifier is silent; namers and message consumers are trusted by name, like
readers; the floor still needs a danger word (`$CMD -f …`, an alias in a `GIT_CONFIG_GLOBAL` file,
a Python body that builds `git push -f` from pieces stay silent); variable values come from the
text only, so `export N=…` and `N=… cmd` ask; a shell inside `$( )` is not read through, and an
unquoted Python heredoc stays a runner; the run-later file-name resolver does not check order;
a command word disguised by quotes (`p""rintf -v "$N"`) is not read as that command, and a Python
body that writes through a variable file name (`p='run'; open(p,'w')`) is dropped.

Two heredoc shapes with a quoted delimiter are literal text, and their bodies are skipped: a
commit message, `-m "$(cat <<'EOF'` … `EOF` `)"`, and `cat > file <<'EOF'` at a command's start
unless a later command outside the inert list names the file — a `mv`, a `cp` or a redirect passes the check on
to what it writes, a file in `.git/` or `hooks/` counts as run, and when one body is kept every
body is. Every other heredoc
keeps its words, unless a 0.5.0 rule above reads it, and so do these two when the rest of the text names a program that may run text: a shell, `eval`,
`source`, `.` at a command's start, `xargs`, `ssh`, `su`, `watch`, `parallel`, `sed`, `awk` or an
interpreter (`python3`, `node`, `perl`, `ruby` …) — since 0.5.0, not a literal `sh -c` string, an
inert `sed`, a Python file edit, or a runner word in an argument it cannot run. A unique prefix of a long option is read as
that option (`--r` is `--recursive`, `git push --de` is `--delete`), as git and GNU tools accept
it; an ambiguous prefix the tools refuse is only an extra ask.

`unreadable` matches nothing since 0.2.0: no rule depends on following a command's shape. The
name stays valid, so an existing `neverApprove` value still parses.

Each rule can be turned off: `neverApprove` (below) names the enforced rules. A rule you remove
is the fork's to judge on an ask, and is left alone on an allow. A repo whose default branch takes
direct pushes by design removes `default-branch-push`.

When no rule matches, the fork judges the call against the policy's
permission scope and the live turn: `allow` is recorded and the tool runs; anything else leaves the ask and rings. The list applies to any tool whose input has a `command` (Bash, Monitor). A call whose input is longer than the fork is shown (64,000 characters since 0.5.1; 4000 before) stays an ask and rings: no call is allowed with a part the fork did not see. `AskUserQuestion` and `ExitPlanMode` are never approved here: their permission prompt is your own dialog.

**The live turn.** The permission and ask forks also get the turn digest: the session's last 12
prompts and main-thread tool results since the fork's transcript was sent, one line each (a
command's shape or a tool's input key names, and the last 300 characters of its result, redacted
first), at most 4,000 characters, newest kept; angle brackets in it are swapped for `‹ ›`, so a line
cannot close the block or open a tag of the prompt. The fork may miss a result from earlier in the
same turn without it. A later instruction from you or the orchestrator counts as part of the task.
The digest lives in memory only: it never reaches the ledger, the pain file, the bell or the log.
The turn-end fork does not get it.

## Permission modes

- **Bypass permissions** (`--dangerously-skip-permissions`). Claude Code never asks, so the
  permission fork never runs and no "nothing to judge yet" ring occurs. In autopilot, a command
  whose own words match an enabled `neverApprove` rule still reaches you as a permission dialog with
  the reason `autonomic: never-approve — <rules>`, and the pain signal names the line that matched.
  A text-only match goes to the fork: its `allow` keeps the allow, anything
  else reaches you. This is the floor that makes autopilot safe under bypass.
- **Auto or default.** Claude Code asks, and the ask path above applies. The first ask after a
  clear rings "nothing to judge yet": the fork has no request to copy until the session's first
  response.
- **Manual mode**, in any permission mode: autonomic never touches an `allow` — except in a
  session that left autopilot through a failure (an unwritable ledger or record, a removed
  policy). That session keeps the floor, because under bypass, manual means no asks at all.
  `/autopilot off` turns it off.
- **What the floor guards against:** a cooperative model writing a dangerous command, judged
  from the command text alone. These pass it: a script or program that runs git itself
  (`./deploy.sh`, `make release`); a git alias defined in config or an earlier command; `sed`'s
  `e` command or any program that builds the command at run time; a brace or glob that builds
  the verb (`git pu{s..s}h`); a bare variable beside `branch` or `commit`; and a danger only the
  filesystem shows (`rm -rf /repo/link/x` where `link` points outside the worktree).
- **What a never-approve match records.** The ledger line and every pain signal carry the
  command's *shape* — verbs, a git subcommand and flag names, with every value only counted
  (`git push -f https://u:TOKEN@… feat/x` is `git push -f (+2 args)`, an assignment is `NAME=`) — so no credential is
  written, however it is spelled; a command name outside a known list shows as `?`, and a flag
  outside a known list as `-?`. The
  permission dialog shows you the whole command.
- **What an allowed ask records.** Since 0.2.1, an ask the fork allows records no input value
  either: a command's shape, as above, or another tool's input key names only (`Write:
  {file_path, content}`).
- **Credentials** in the fork's own text — its reasons and the questions it writes (URL user
  info, `*_TOKEN=…`, `--token …`, Authorization, Bearer and other key, token, secret or cookie
  header values, bare or quoted, and known token shapes) — are redacted before any ledger line,
  notice, toast, bell or pain file. This redaction is best effort: prose cannot be reduced to a
  shape, so a value the fork quotes in an unusual form can pass.

## The ledger

One line per decision:

```
- <ISO time> · <session id> · <case> · Q: <question> · A: <answer> · why: <reason>[ · usage: in=<n> cached=<n> out=<n>]
```

Path: `AUTONOMIC_LEDGER` when set (relative to the repo root when relative), else
`<repo root>/.autonomic/ledger.md`, else `<cwd>/.autonomic/ledger.md` outside git. autonomic only
appends; the session's own commits carry the file. The cases are `covered`, `stalled`, `done`,
`pain` (the turn end), `ask` (an `AskUserQuestion` answered), `permission` (an ask allowed, or a
never-approve match kept with you), `operator` (you pressed an option on the pain band:
`why: chosen on the pain band`), and `molt` — the turn end is molt's handoff, and autonomic let
it stop (`why: molt owns this turn end`). In a dual-repo project, point
`AUTONOMIC_LEDGER` at the AI workspace. A ledger that cannot be written ends autopilot, and the
decision that could not be recorded is not taken.

## Pain

The list lives in the policy file (default above). A pain signal is:

- a band above the prompt, with a Dismiss button — and, for a turn-end pain, one button per option
  (see below);
- a toast;
- the bell: `bell` in `/config`, or `AUTONOMIC_BELL` on a spawn, run as a shell command with
  `AUTONOMIC_MESSAGE` set to one line — for example `curl -d "$AUTONOMIC_MESSAGE" ntfy.sh/<topic>`;
- a line `<ISO time> pain <text>` appended to `AUTONOMIC_PAIN_PATH`, when a launcher sets it, so a
  worker's pain reaches its parent.

A pain signal never resumes the run by itself. Your next prompt does.

**Options (since 0.3.0).** For a turn-end pain the fork also offers up to three answers, each a
label and the instruction the session will follow: at most one recommended, never the
irreversible side of a one-way door, and never a credential. The band shows the
question on its own line, then one row per option, the recommended one first as
`<label> (Recommended)` in the accent style. The buttons share one column (as wide as the longest,
at most 40% of the band), and each option's whole text wraps beside its button. A last row holds
Dismiss. No option has a hotkey, so a reply you type that starts with a digit stays yours (this
layout since 0.3.1). A
pain with no options keeps its one line. A press is your decision and nothing runs without it: the band clears, the ledger gets an `operator` line, and
only then does the option's text enter as your own prompt (`asUser`). A ledger that cannot be
written submits nothing. A prompt that does not enter (a plugin beneath refused it, or the host
failed) is a new pain signal, `option not sent`, so you can type the reply. One band takes one press. Typing a reply still works, and clears the
band as before. An option set the fork got wrong in shape (not a list, more than three, an empty
label or text, a text over 300 characters, two recommended) is dropped whole, and the pain stands with no buttons. The bell
and the pain file list the options as text — `… · options: 1) <label> (Recommended) 2) <label>` —
so a remote operator or a herdr parent sees the choices; answering there stays a typed reply.
Labels and texts are redacted like every pain text.

**A credential (since 0.4.1).** A credential or secret you must supply or issue is never an
option. The fork asks for it in one plain-text line (where to put it, never its value), and the
other decisions in the same pain keep their options. The band shows that line after the options,
as `In plain text: <request>`, whole, and it has no button: you type the answer. A press on an
option leaves that line as a band of its own until you reply, dismiss it, or a later pain replaces
it (notices do not stack; the pain file and the bell keep the request). The bell, the pain file
and the ledger end the pain with `· in plain text: <request>`. A pain whose only decision is a
credential has no options, only the question, that line and Dismiss.

Every other pain signal (never-approve, hard
deny, loop guard, ledger failure, fork failure, a question or permission left with you) carries no
options.

## With molt

- **Mode across a molt.** molt clears a root session and writes
  `~/.claude/state/molt/lineage/<new id>.json`. autonomic copies the previous session's record
  (`~/.claude/state/autonomic/sessions/<id>.json`, `{ mode, bell?, scope, source }`), and
  announces the scope once with the first prompt. `source` is `env` (read from `AUTONOMIC_MODE`;
  unset means manual), `command` (`/autopilot on|off`), or `lineage` (carried across a molt).
- **A child's scope is its brief.** A crew child (`MOLT_HANDOFF=parent`) never molts; its
  replacement is a fresh session that takes its mode from `AUTONOMIC_MODE` and its scope from its
  brief and handoff.
- **molt keeps the turn end.** autonomic neither blocks nor forks when molt's stage file for this
  session (`~/.claude/state/molt/stage/<id>`, molt 0.2.1+) says `command`, `block` or `fallback`
  or the live fill has reached the file's `command` (molt may rewrite the file after this hook),
  when the reply carries a `MOLT-HANDOFF:` line, when `MOLT_STATUS_PATH`'s last line is
  `handoff required` or `handed-off …`, or when a plugin beneath it has already blocked the stop
  (molt's command). autonomic follows molt's stage file, so a seeded session whose ladder moved
  yields at its own handoff command. `yieldAtPercent` applies only without a stage file (molt
  absent or older, or a file that does not parse): at or above that fill every turn end is molt's.
  A stage file that says `off` (`/molt off`) turns that fallback off too.
- **molt rings its own pause.** molt reads `mode` and `bell` from autonomic's record and rings the
  bell when it pauses an autopilot root; autonomic does not ring again.

## For launchers

On Claude Code, autonomic sets `AUTONOMIC_EFFECTIVE_MODE` (`autopilot` or `manual`) in its own process each time a
session's mode changes, so every later Bash call the session runs sees the live mode. Read it there
to decide whether a child starts in autopilot: `autopilot` marks the child; anything else, unset
included, does not. It is in memory and cannot go stale the way the session record can after a
failed write. When the host refuses the value, autonomic tries to unset the variable and shows a
toast; a launcher reads no stale mode only when the unset works (see "Limits"). autonomic never reads it: `AUTONOMIC_MODE` stays the spawn's input.

On OMP, `AUTONOMIC_EFFECTIVE_MODE` in a `bash` child is the session-start value: omp's bash helper
keeps that environment. Since autonomic 0.7.0, read `cat "$AUTONOMIC_MODE_FILE"` instead. The extension
sets the absolute per-process path at load, removes any old file there only on the first load per process, atomically writes the mode on
every change, and removes it at shutdown. Mark a child for autopilot only when the read is exactly
`autopilot`; a missing variable or file, or anything else, is manual.

## Environment

| Variable | Read for |
|---|---|
| `AUTONOMIC_MODE` | the mode at spawn |
| `AUTONOMIC_LEDGER` | the ledger path |
| `AUTONOMIC_BELL` | the bell command (beats `bell` in `/config`) |
| `AUTONOMIC_PAIN_PATH` | the pain file |
| `MOLT_STATUS_PATH` | molt's child status file (the floor) |
| `AUTONOMIC_EFFECTIVE_MODE` | never read: autonomic sets it for launchers (above) |
| `AUTONOMIC_MODE_FILE` | never read: on OMP, autonomic sets the live mode file path at load for launchers |

## Settings

| Key | Default | Meaning |
|---|---|---|
| `policyPath` | `~/.claude/autonomic/policy.md` | the policy file |
| `bell` | unset | the bell command |
| `loopMax` | 3 | blocks in a row with no change before the loop guard |
| `tailChars` | 4000 | how much of the last reply the turn-end fork quotes |
| `yieldAtPercent` | 65 | used only without a molt stage file: context fill at or above which every turn end is molt's |
| `neverApprove` | all six rules | the never-approve rules enforced, separated by spaces or commas: `force-push default-branch-push branch-delete rm-outside no-verify unreadable` (`unreadable` matches nothing since 0.2.0). Empty means none (`/autopilot status` says so). Only these names exist. |
| `readers` | `gh pr create; gh pr edit; gh issue create; gh issue comment` | command prefixes, separated by `;`, that name a file but never run it: a reader that names a file the command just wrote does not keep that file's words for the never-approve list. Add your own, for example `herdr agent prompt`. Empty means none. `/autopilot status` lists them. |

No `/plugin configure` step is needed: every setting has a default except the optional `bell`.
A bad number falls back to its default, and an unknown `neverApprove` name is ignored;
`/autopilot status` and a toast name either.

## Failure behaviour

| Failure | Result |
|---|---|
| autonomic does not load, or a hook throws | the event passes through unchanged: the session behaves as manual |
| policy missing or empty | autopilot refuses: `autopilot: no policy` |
| ledger not writable | autopilot refuses, or drops to manual mid-run with a pain signal |
| fork fails or its reply does not parse | one retry, then pain |
| nothing to fork yet (a session's first response, just after a clear) | the event passes through; an `AskUserQuestion` goes to you |

Log: `~/.claude/state/autonomic/autonomic.log`. It holds one line per fork
(`fork <turn-end|ask|permission> session=<id>`), each failure, each pain signal and each block
beneath that stood.

## Cost

One cached fork at each autopilot turn end, and one at each `AskUserQuestion` and each `ask`
verdict not on the never-approve list. A fork re-sends the session's own last request, so its
prefix is served from the prompt cache; the ledger's `usage` field records what each one cost.

## Limits

- Two notices above the prompt do not stack: when molt and autonomic both have one, one shows; the
  other is still in the toast and the log.
- A herdr worker ping arrives as a typed prompt, so it resets the loop count, as it resets molt's
  manual pause count.
- With `AUTONOMIC_LEDGER` unset, the ledger is created at `<repo root>/.autonomic/ledger.md`. In a dual-repo
  project's public canonical, set `AUTONOMIC_LEDGER` to the AI workspace, or ignore `.autonomic/` there; a
  launcher patch (herdr-crew) is to set it per seat.
- The permission fork judges a subagent's call against the main session's transcript.
- The turn digest adds up to 4,000 characters to each permission and ask judgment. It shows a tool
  result's tail only, never its middle, and it reads a tool result as a fact, though a result can
  hold fetched text. A `/resume` to an earlier session id brings back that id's digest.
- A host that refuses every `env.set` leaves `AUTONOMIC_EFFECTIVE_MODE` at its previous value; a toast
  says it may be stale.
- A deny from a plugin that runs above autonomic is not seen; the turn-end check reports it.
- The Claude Code mod needs Claude Code; on OMP see the OMP section. Codex has no mod runtime.

## OMP

- Since 0.6.0 autonomic also ships `omp/extension.ts` for omp 18.8.9: the turn-end reflex, the `ask` reflex and the never-approve
  floor over the same policy, pain list and ledger in `../hooks`. Only `omp-seat` (the `omp-roles` plugin) loads it, with `-e`.
- `~/.omp/agent/autonomic.json` holds the same keys as the settings table below; the policy file, `/autopilot`, `AUTONOMIC_MODE`
  and the molt hand-over (a lineage file, a stage file) are the ones above. The `ask` tool exists in `rpc-ui` and the TUI only.
- OMP seats run `--approval-mode yolo`, so there is no permission fork: a never-approve match in autopilot blocks the `bash` call, writes
  a `permission` ledger line and raises a pain signal. The floor reads `bash` (the command, judged in the call's own `cwd`) and `github` `pr_push`
  with `forceWithLease`; `eval`, `debug` and scripts are not read, and a subagent's calls are covered by seat-mods' child rails.
- **Grant-bounded decisions (0.7.x, unactivated).** An enrolled session with a decision service now has one extra branch in that floor: a matched
  call whose *complete literal* effects are bounded by live positive grants is decided by `permissionEligibility` (`hooks/operations.ts`) and
  recorded, then the original tool runs unchanged and exactly once. It is deterministic when a bounded command's evidence and a matching grant
  already agree, and otherwise one native judgment inside the matched grants, with the semantic route requiring the judge, the accepted choice and
  the deterministic grant/fact checks to all agree. Nothing widens what autonomy may do: `executionSegments` parses only the bash grammar it can
  read (literal wrappers, `cd`, `git -C`, explicit ref/config effects) and marks anything it cannot — expansions, substitutions, interpreters,
  aliases, functions, config writes — opaque, and an opaque segment never gains authority. A grant never mints authority for an operation it does
  not cover, a command outside its approved evidence is not enough, and a default or protected destination, force, delete, `--no-verify`, an AI
  trailer, a merge or any unsupported effect always stays with the operator. This is not universal enforcement: the other OMP tools, and any call
  the floor never matched, are untouched. It is gated until Tasks 6–8 and both releases.
- The `github` route's bounded facts read the repository's configured remote URLs locally (read-only `git config`) so a PR/API mutation can resolve
  its exact repository from the pinned facts; no network call is made while deciding.
- There is no band: a turn-end pain lists its options, numbered, in the notice, the bell, the pain file and the human ledger row,
  recommended first, each with its 40-character one-line label and its complete validated instruction text — the row's answer bound is the
  content's own length, so a valid multi-option pain is never cut (every other ledger row keeps the shared 300-character clamp). The ask
  judge sees what the session has read, so a scope document answers an ask only after the session has read it.
- **Five-state turn end with grounded payloads (Task 7, unactivated).** An enrolled session's stop is classified once, natively, with one
  `turn_end` choice question whose labels are exactly `covered`, `stalled`, `waiting`, `done` and `pain`. The classification is never
  authority: before it, the stale-event check, the Molt handoff and the loop guard decide as they always did, and after it the payload must
  survive `validateTurnPayload` (`omp/turn-end.ts`). `covered` and `stalled` may only repeat an approved remaining step or an approved
  candidate — byte for byte, with its grants and evidence still live — so a model can render prose and never extend an action. `waiting`
  needs a real running host job or the verified Molt fact (prose saying “waiting” is not evidence), `done` needs approved completion
  evidence, and `pain` grounds its question, options and credential-location request in cited evidence. Every reason is the cited rendering
  `evidenceId: excerpt[start..end]` joined by `; `, so no invented policy line reaches the ledger. No approved action means no payload —
  the stop escalates instead.
- **One isolated generation, never a classifier.** With no prebuilt candidate, one `runEphemeralTurn` at `{tools:false, isolated:true,
  dedupeReply:false}` renders the required fields inside the frozen, redacted state (Task 2's explicit isolation, not `history:[]`). A
  provider/native failure never calls it, and it never supplies a step the policy does not approve. Native classification and the render
  stay separately accounted.
- **The conversational OMP classifier is gone.** The old `judge('ask'|'turn-end')` two-attempt fork, its `MIN_ATTEMPT_MS`, `io.ephemeral`,
  `questionsOf` and the OMP turn digest are removed: an autopilot ask or turn end with no decision service is now operator-owned (the ask
  passes and rings; the stop passes with no continuation and no ledger row) rather than answered by chat. The shared Claude Code prompts,
  parsers and `$.model.fork` are untouched.
- A process that dies without `session_shutdown` (SIGKILL, crash, shutdown budget) leaves `mode/<pid>`; nothing sweeps these files; a reused pid clears its own at first load, and only children of the dead process could read it.
- Main limit: if writing the OMP mode file fails AND removing it fails, a stale file can remain. The notice says
  not to let a launcher trust it in this session. A missing file reads manual.

## Tests

`bash autonomic/run-tests.sh` validates the plugin and runs the kit suites (`claude plugin test`).
