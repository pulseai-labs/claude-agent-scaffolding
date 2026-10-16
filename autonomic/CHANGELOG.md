# Changelog

All notable changes to the `autonomic` plugin.

## Unreleased

- Render the complete validated pain option text on the OMP operator surface. An option is listed as `<n>) <40-character label> (Recommended) — <complete validated instruction text>`, recommended first and never recommending an irreversible option; the notice, the bell, the pain file and the human ledger row all carry the same content. The 40-character label bound applies to the label only, so the instruction a press submits is never cut (Plan Task 7 §9 line 1103).
- Route the OMP turn end through one native five-label classification with complete grounded payloads (`omp/turn-end.ts`, `omp/extension.ts`). `turnEvidence` freezes a bounded opaque state (last reply, identity/epoch, progress, real armed wait facts from the host job snapshot, Molt facts, approved candidates/remaining steps, lease+policy evidence); `onSessionStop` classifies once with the exact `turn_end` question after the stale-event, Molt and loop checks, then `payloadForTurn` returns the exact unique approved candidate or performs one isolated `tools:false` generation, and `validateTurnPayload` refuses anything ungrounded. `covered`/`stalled` may only repeat an approved step's byte-exact text with live grants/evidence (never an invented plan), `waiting` needs a real armed fact, `done` needs approved completion evidence, and `pain` grounds its question/options/credential-location in cited evidence. Reasons must equal the evidence-cited rendering (`evidenceId: excerpt[start..end]`, joined by `; `); forged quotes, unsafe offsets, forged candidate/evidence IDs, a case mismatch, a missing required field or a redaction change all abstain.
- Record the decided turn end before it acts: `covered`/`stalled` keep the existing continuation text inside the loop guard, `waiting` uses the existing `operator` human case with `waiting; no continuation` plus the JSONL outcome `waiting`, `done` keeps its case/notice, and `pain` keeps the full notice/bell/pain-file payload with no continuation. No label outside `covered`/`stalled` injects a continuation, and no answer/next_step can be supplied by model prose.
- Remove the OMP generic `judge('ask'|'turn-end', prompt, parse)` two-attempt conversational classifier, its `MIN_ATTEMPT_MS`/`within` deadline, the `io.ephemeral` classification path, `questionsOf` and the OMP turn digest (`toolEntry`/`pushEntry`/`renderDigest` consumers). An autopilot session with no enrolled decision service is now operator-owned for both consumers (the ask passes and rings; the stop passes with no continuation and no ledger row) instead of being answered by a side turn. Shared Claude Code `askPrompt`/`turnEndPrompt`/`parseAsk`/`parseTurn`/`$.model.fork` are unchanged.

- Answer whole OMP ask batches from bounded native judgments (`omp/asks.ts`, `omp/extension.ts`, `omp/judgment.ts`). An enrolled session snapshots the entire ask (a malformed batch is rejected, never silently shortened), maps each question onto the exact protocol IDs (`cover:<id>`, `select:<id>`, `member:<id>:<option>`, legacy `legacy:<inputSha256>:<ordinal>`), judges the independent questions once, and answers only when the **whole** batch is grounded in approved evidence — otherwise the entire original dialog stays with the operator. Coverage, single selection and per-option multi membership are independent; constraints (`requires`/`excludes`), complete membership, missing/extra IDs and uncovered options are checked deterministically over the assembled set. Every decision is recorded (one `ask` row per question) before the single exact-answer block; any shortfall uses the existing ask-pain path with no partial or generated answer. The shared `parseAsk`/`Question`/Claude Code answer seam is unchanged; the unenrolled legacy ask path is removed with the classifier above.
- Reject an approved question that carries any operator gate (`operatorGate` other than `none`) at policy parse, and refuse two approved questions with one fingerprint. A bundle carrying a gated question is unavailable to the ask **and** the permission consumer, so an operator-owned gate is never answered automatically.
- Abstain from answering a whole ask batch whose frozen content redaction would change — a secret in a question text, option label, description or header — before any frame capture, state build or native call, mirroring the permission path's `redact(shown) !== shown` abstain. The dialog stays operator-owned, no secret byte reaches state, the block reason, the ledger, a notice or the pain file.
- Route bounded OMP permission decisions through native judgment (`hooks/operations.ts`, `omp/extension.ts`). The never-approve floor's pre-existing match still intercepts, but a matched `bash`/`github` call whose effects are fully bounded by live positive grants is decided through the Task 4 transaction and recorded before the original tool runs — unchanged and exactly once. `operationFacts` maps the commands' complete literal effects onto the approved vocabulary (bounded command evidence, commit paths/ref, own-branch push remote/source/destination, own PR identity), and `permissionEligibility` decides in a fixed order: role ceiling and floor impact, red lines and operator gates, per-segment completeness, live matching grants, exact approved evidence, then a native judgment only inside the matched grants. A default/protected destination, force/delete/`--no-verify`/trailer/merge, an unsupported effect or any incomplete fact always stays with the operator; a grant never mints authority and an opaque segment never gains any. Still operator-owned after this change: anything the floor never matched, the red lines above, and any call the session has no grant for. Claude Code's path is unchanged, and this ships no activation — the route is gated until Tasks 6–8 and both releases.
- `executionSegments` reads the whole command in order with the existing bash grammar (quotes and escapes, separators, the literal wrappers `env`/`nice`/`ionice`/`timeout`/`command`, literal `cd` and `git -C`, redirection targets, explicit `git` ref/config effects). It keeps every segment and any uncertainty, decodes masked quotes only for literal argv while rejecting an original masking character, and marks unsupported expansions, substitutions, interpreters, aliases, functions and config writes opaque. The parser is not universal: `eval`, `debug` and interpreter scripts are not read, so autonomy reaches only the commands this grammar can bound.
- Add the bounded OMP decision transaction (`omp/judgment.ts`, `omp/decision-ledger.ts`): one monotonic 25-second window from handler entry (capture ≤2 s, native ≤12 s and ≤10 s, generation ≤22 s and ≤10 s, final ≤25 s), exact SDK result validation before any confidence is read, operator-owned acceptance (no default cutoff), and a native-only judge call bound to the captured host context and the pinned lease. `PolicyBundle` is a version-1 effective-policy file; a missing, malformed or unapproved one disables the route. No class activates with an absent policy, bridge or authority, and no conversational classification fallback is retained.
- Add the two-write decision attribution: `<resolved-ledger>.decisions.jsonl` (audit output, never authority) plus the human ledger row, each written under a freshness check, with redaction of every string field. A partial write is an intent, never execution proof; a required-write failure or timeout publishes manual/failure and releases nothing. Native `result.usage` is never re-billed; Claude Code's token-only human rows are unchanged.
- Capture authority in the OMP factory without activating native decision consumers or an enrolled conversational fallback. The factory exposes the captured `DecisionIO` (`createAutonomic(...).decisions`) for the later consumers, aborts outstanding frames on mode change, authority invalidation, navigation, shutdown and Molt transitions, and records the handler entry moment before any await. Legacy OMP and Claude Code behavior/policy remain unchanged; #832 and #831's cross-host criterion remain open.
- Pin coherent snapshot/input/source/evidence/policy identities outside the complete worker allowance; invalidate on replacement, revocation, expiry or placement drift. Capture startup once; new assignments require fresh processes. Public Molt evidence is insufficient for autonomous reactivation, so transitions remain suspended.

## 0.7.1

- tests: the reader's size check uses a relative time bound (#782). No behaviour change.

## 0.7.0

- **A live mode route for OMP launchers** (#769). At extension load, `AUTONOMIC_MODE_FILE` names an absolute
  per-process file under autonomic's state folder; only the first load per process removes any reused-pid file,
  so task child factory rebinds preserve the live mode. Every mode publish
  atomically replaces it with `autopilot` or `manual`; shutdown removes it. A failed update removes the file
  so a launcher reads manual, or warns not to trust it when removal also fails. `AUTONOMIC_EFFECTIVE_MODE`
  stays unchanged for Claude Code and in-process readers. OMP bash children keep the environment from
  session start, so OMP launchers read `cat "$AUTONOMIC_MODE_FILE"` and mark autopilot only on that exact value.

- **OMP limit:** A process that dies without `session_shutdown` (SIGKILL, crash, shutdown budget) leaves `mode/<pid>`; nothing sweeps these files; a reused pid clears its own at first load, and only children of the dead process could read it.

## 0.6.1

- **The bell is not awaited on the pain path** (#718). `pain()` awaited `ring` with no `timeoutMs`, so a hung bell held the
  turn-end hook for the engine's 30 s bound while the operator waited. `BELL_TIMEOUT_MS` and `ring` are now molt's own,
  byte for byte (including its comment block), and `ring` is called as `void ring(…)`: it still rings with the pain text,
  and a non-zero exit and a rejection are each logged once. `tests/test-mod-shell-parity.sh` gained a second pair over the
  two files — `molt/hooks/register.tsx` as the source, `autonomic/hooks/register.tsx` as the copy — so a copy that drifts
  fails CI. No other behaviour changes.

## 0.6.0

**autonomic on OMP** (omp 18.8.9).

- `omp/extension.ts` ports the turn-end reflex, the `ask` reflex and the never-approve floor over the same `hooks/` modules (policy,
  pain list, ledger, verdict parsing); loaded only by `omp-seat` (`omp-roles`) with `-e`, never ambient.
- OMP seats run `--approval-mode yolo`, so there is no permission fork: a never-approve match in autopilot blocks the `bash` call,
  writes a `permission` ledger line and raises a pain signal. The floor reads `bash` (the command, judged in the call's own `cwd`) and `github` `pr_push` with `forceWithLease`.
- The `ask` reflex judges inside one 25 s deadline that no longer depends on omp honouring the abort signal: each attempt races the
  deadline, so a hung side turn is a failed attempt and the ask passes to the operator with a pain signal and a `pain` ledger line.
- No band on OMP: a turn-end pain lists its options, numbered, in the notice, the bell and the pain file.
- Settings come from `~/.omp/agent/autonomic.json` (same keys as `userConfig`). The policy joins the system prompt on every turn, as a block
  of its own after omp's blocks (omp 18.8.9 hands `before_agent_start` the prompt as a list of blocks).
- The floor judges a `bash` call in the call's own `cwd` (resolved as omp resolves it) and treats `github` `pr_push` with `forceWithLease`
  as a force push of the branch the call names.
- Known limits: the floor does not read `eval`, `debug` or scripts, and a subagent's calls are covered by seat-mods' child rails; omp's
  `bash` tool children keep the `AUTONOMIC_EFFECTIVE_MODE` value from session start (a stale `manual` is safe; a stale `autopilot` after
  `/autopilot off` or a fall to manual is not, so do not drive herdr-crew launches from an OMP top until PR 4); the `ask` tool exists in
  `rpc-ui` and the TUI only; an ask is answered only from what the session has read. The Claude Code mod is unchanged.

## 0.5.1

**The floor asks only on what a command does** (#758: 53 asks in five hours on 2026-10-12, 16 of them
false positives, 17 inputs never judged).

- **Two levels of finding** (`floorFindings`, `never.ts`). A rule that matches a parsed command's
  own words — its arguments as Bash passes them, with whitespace inside quotes kept in one word —
  asks you, as before. A rule that matches only in text the floor cannot read command by command
  (the whole-text read, words inside a quoted argument, a command read over all words) goes to the
  fork, with the finding in its prompt. The floor never approves. `neverRules` returns both levels.
- **Long inputs are judged.** The fork now sees an input whole up to 64,000 characters (was 4000),
  SubagentHandbacks included; a longer input still asks, so no call is allowed with a part the fork
  did not see.
- **Smaller fixes.** A sed script keeps a backslash inside single quotes (`'s/a\/b/c/'` is a safe sed);
  the pain band shows the command that matched.
- **Known limits.** A push from a detached or `main` checkout still asks `default-branch-push`, even to
  a named feature branch (#758 cause 1): every way to read the real destination from the text alone
  met a new route around it in review (another remote, inline or earlier config, `HOME`). It is #766.
  Every branch delete still asks, an already-merged one included: #758's decision
  to send merged deletes to the fork is #764 (proving a branch merged before the call runs kept
  meeting new shapes in review). A session's first call still asks: there is nothing to fork yet. A
  literal variable that holds spaces, used inside double quotes (`F='push -f'; curl -d "$F" …`), is
  re-split when the floor reads its value, so it can ask where Bash passes one data argument. `rm` of
  a path that starts with a variable the text does not assign (`rm "$T/x"`) still asks: unquoted, the
  variable may hold flags.

## 0.5.0

**The never-approve list judges each command on its own words** (a replay of three days of
transcripts: prompts in other projects fall from 386 to 266, none newly asked).

- **Each simple command is judged alone** when the text parses (`never.ts`): a rule fires only
  when its verb and its flags are in the same command. Moves, git config writes and an opaque verb
  (`$CMD -f`, `git $V -f`) still take context from the whole text, and unparsed text and runners
  keep the whole bag. A variable assigned once to a literal, at the top level and before its use,
  is read as its value; a command of assignments only drops its words.
- **A runner word that cannot run** (an argument of `cd`, `pushd` or an inert command, or the
  value after `git -C`) no longer keeps the whole bag, and dot-sourcing is found per command.
- **A moved push that names its destination** (a remote and only literal refspecs that are not the
  default branch, `main`, `master`, `HEAD` or `@`, with no option outside a short safe list) no
  longer asks `default-branch-push`.
- **A variable in a push** (`B=spine/x; git push origin "$B"`) reads as its value; one assigned
  from a substitution stays opaque.
- **Backticks are substitutions**: a live pair, also inside double quotes, is judged as commands;
  a quoted or escaped backtick is text.
- **`sh -c 'literal'`** (bash, zsh, dash) is read as a subshell holding the string, up to four
  levels; a `$`, a backtick, `-l` or `-i` keeps it a runner.
- **A wider safe `sed`**: `s///` with any delimiter, address prints, `=` and `-i` edits are inert;
  `e`, `w`, `r`, `y`, `-f` and an `-i` target in git's control paths keep it a runner, and an
  edited file a later command runs keeps the words.
- **Python file-edit heredocs** (`python3 - <<'X'`) drop a body that names no process call
  (`subprocess`, `system`, `exec…`, `getattr`, `importlib` …) and no git control path.
- **Heredoc bodies are data unless something can run them**: `git commit -F -`, `gh … --body-file -`
  and `tee` bodies drop; an unquoted body's `$( )` and backticks are judged as commands, and
  `$((`, `$[` or `${…@…}` keeps the whole bag.
- **File names**: a `$(mktemp)` variable names a fresh temp file, and built names (`D=$S/r.md`)
  are read. **Fixed a 0.4.3 defect:** a later command's words are read with variable values before
  the file-name match, so `P=/x/a.sh; cat > $P …; mv $P run.sh; ./run.sh` asks again.
- **Namers** (`rm`, `chmod`, `wc`, `diff`, `git add|commit|status …`, `gh api`, `gh pr|issue view` …)
  name a written file without running it.
- **Context the per-command reading keeps** (whole-branch review): a branch switch that names a
  default branch name (`git checkout main && git merge … && git push`) makes later pushes read as
  moved; a move, config write or switch anywhere in a loop body counts from the loop's start; a
  `commit` or `branch` holding a variable the text binds but cannot read is judged on the whole
  bag; an assignment after `&&`, `||` or a pipe on the next line, or sent to the background, is
  not read; a message consumer never reaches past `;`, `&&` or `|`; `.husky/` and `.githooks/` are
  git control paths; the Python deny words also match after `_` (`create_subprocess_shell`); and a
  script of many redirects is read in well under a second (0.4.3 took over a minute at 2,000 lines).
- **Known limits:** a moved push trusts only `main`, `master` and the session's default branch as
  default names; the Python deny list is a judgment rule; namers and message consumers are trusted
  by name; the floor still needs a danger word; variable values come from the text only
  (`export N=…` asks); a shell inside `$( )` is not read through; the run-later resolver does not
  check order; a quote-disguised command word (`p""rintf -v`) and a Python write through a variable
  file name (`open(p,'w')`) are not seen (PR #735 review round 3).

## 0.4.3

**The never-approve list stops holding dispatch briefs and item closes** (the 0.4.2 live replay:
the PulseTrader top's two holds, the seat-mods briefs, the pulsebase item closes).

- **Command substitutions are read as commands** (`never.ts`): `test -n "$(git diff --cached …)"`
  no longer lends `-n` to the next `git commit`, and a `$(date)` in a ruling line no longer keeps
  every word.
- **Groups carry their redirects and pipes**: `{ … } > brief.md` drops the brief's prose when the
  brief is only read; `{ echo …; } > x.sh; ./x.sh` asks (a 0.4.2 Known limit, closed).
- **Heredocs that print to standard output drop their bodies**, quoted or with plain `$VAR`s only.
- **A narrow `sed` (`sed -n 8,9p f`) is inert.** Any other `sed` stays a runner.
- **A redirect target is never a command word**, a pipe counts only when its output reaches a
  command that is not inert or a file, and a `cd` to a literal directory resolves relative names.
- **`readers`** (new setting): commands that name a file without running it; default the gh
  `--body-file` commands. Add `herdr agent prompt` for herdr dispatches.
- **Known limits:** a reader is trusted by name; a reader's own words still pool (#693 case E);
  `sed -n '/x/p'` and multi-command scripts stay runners; a word `bash` anywhere (`bash --version`)
  keeps the whole bag.

## 0.4.2

**The never-approve list stops holding commands that only name a danger** (#693: ten false holds
across six seats in one PulseTrader run, one of which stalled a top for about 45 minutes).

- **Inert commands leave the bag** (`never.ts`). A simple command led by `[`, `test`, `echo`,
  `printf` (without `-v`), `exit`, `cat`, `wc`, `jq`, `mv`, `cp` and a few more adds no words, so
  `[ -n "$staged" ] || exit 1` no longer lends `-n` to a later `git commit`. It keeps them when it
  pipes onward, or when it writes into a file that is run later, into a git control or config
  file, or into a file named by a variable the text does not resolve (or by a relative name after
  a `cd`). A function or alias defined in the text keeps the whole bag, since it may shadow an
  inert name. Only a system `bin` path
  (`/bin/echo`) counts as an inert name; `./echo` and `/repo/echo` do not. The full bag stays whenever the text holds a runner, `$(`, `<(`, `>(`, a backtick,
  a heredoc left in place or an open quote. Comments are skipped, so a quote in a comment hides
  nothing.
- **A heredoc body stays dropped when its file is only moved or read.** A later command outside
  the inert list that names the file keeps the body, and so does one whose own name is a variable
  or a glob; `mv`, `cp` and redirects pass the name on; a file in `.git/` or `hooks/` counts as
  run; once one body is kept, every body is.
- **A bare dashed word is no longer a verb**: `no-rm` and `force-push` in prose no longer read as
  `rm` and `push`. Git's executable (`git-push`) and a dashed path (`./force-push`) still do.
- **Known limits:** prose quoted in one argument of a non-inert command still pools
  (`herdr agent prompt "…"`); a non-inert reader of a written file (`dagr check run.json.tmp`)
  keeps the writer's words; an inert name shadowed by an alias or function defined in an earlier
  call hides words; a written file run without being named (`make` reading a `Makefile`), or
  named only through a variable passed as an argument (`nohup "$F"`), is not tracked; run
  locations other than `.git/` and `hooks/` (rc files, crontabs) are not tracked; an inert name
  resolved through a changed `PATH`, git config moved by `GIT_CONFIG_*` or `GIT_DIR`, a write
  through a descriptor opened earlier (`>&3`) and a redirect on a `{ }` group are not handled.

## 0.4.1

**A credential no longer takes the options from the other decisions in a pain** (a PulseTrader
pain on 2026-10-08 asked about a prod freeze and an agent token together, and showed no buttons).

- **The turn-end fork prompt** (`prompts.ts`): a credential or secret the operator must supply or
  issue is never an option. The fork gives `"credential"`, one line asking for it in plain text,
  and the other decisions in the same pain keep their options. In 0.3.0–0.4.0 the rule was "for
  credentials, give no options", which dropped the options for the whole pain.
- **The verdict** (`verdict.ts`): a pain keeps a non-empty `credential` string; any other value is
  dropped and the pain and its options stand. Only a pain carries one.
- **The pain signal** (`register.tsx`): the band shows `In plain text: <request>` after the
  options, before Dismiss, with no button, never cut. A press on an option leaves the request as
  a band of its own, and a failed press keeps it. The bell, the pain file and the ledger end the pain with
  `· in plain text: <request>`. The request is redacted like every pain text.
- **Known limit:** the session's own `AskUserQuestion` still follows the policy's standing order
  ("For credentials, ask in plain text with no options"). A question the session itself bundles
  with a credential still has no options; the policy file is the operator's to edit.
- **Known limit:** the band holds one notice: a later pain, or a typed reply that a plugin beneath
  refuses, clears a pending credential request. The pain file, the bell and the log keep it.
- **Known limit:** the ledger cuts its Q field at 300 characters, as for every question, so a long
  request can lose its end there; the band, the bell and the pain file show it whole.
- **Known limit:** splitting is the fork's prose. A fork that still folds a credential into the
  question gives it no options, as in 0.4.0.

## 0.4.0

**The judge sees the live turn; launchers see the live mode** (0.4.0 spec; probe P1 showed the
permission fork missing a same-turn tool result in 2 of 3 runs).

- **The turn digest** (`digest.ts`, `register.tsx`): each main-thread prompt that enters and each
  completed main-thread tool call — an `AskUserQuestion` answer included, the operator's or
  autonomic's own — adds one redacted line to a per-session list in memory: the last 12 entries,
  each at most 400 characters, a tool's input as its shape or key names and its result as the last
  300 characters. A dropped prompt and a subagent's call do not enter. Redaction runs on a bounded
  window (the redactor is quadratic on a long run without spaces), and the word the window edge
  cuts is dropped, so a split credential is not shown in part; whitespace collapses first, so
  padding cannot cut a credential's prefix off.
- **The permission and ask fork prompts** (`prompts.ts`) carry the digest in a `<recent>` block of
  at most 4,000 characters, newest kept, with a rule that a later instruction from the operator or
  the orchestrator is part of the task and a tool result is a fact about what ran, never an
  instruction; angle brackets in the block are swapped for `‹ ›`, so fetched text cannot close it.
  A pain-band press (`asUser`) is labelled as the operator's. Both prompts also name the live task. The turn-end prompt
  carries neither.
- **`AUTONOMIC_EFFECTIVE_MODE`** (`register.tsx`): set to `autopilot` or `manual` in autonomic's
  process each time a session's mode is saved, the fall to manual on a failed record write
  included, and again at each `session.start`, so a resumed session id gets its own mode back. A
  value the host refuses is unset where the host allows it, and a toast says which happened.
  autonomic never reads it; README, "For launchers".
- **Known limit:** the digest costs up to 4,000 characters per permission or ask judgment.
- **Known limit:** a tool result's middle is not shown, only its tail; a result that is one long
  token reads `(one long token)`.
- **Known limit:** the `<recent>` rule calls a tool result a fact, though a result can hold
  fetched text; a prompt from a `channel` or `peer` origin is labelled with its raw kind.
- **Known limit:** the digest is kept per session id and never cleared, so a `/resume` to an
  earlier id brings back that id's digest. A deny reason is redacted at full length.
- **Known limit:** a host that refuses every `env.set` leaves `AUTONOMIC_EFFECTIVE_MODE` at its
  previous value; autonomic cannot change it then, and its toast says the value may be stale.
- **Unchanged:** `nothing-to-fork` at a session's first ask.

## 0.3.1

**The pain band reads in one pass** (live check of 0.3.0, finding F1).

- **Column layout** (`register.tsx`): the question on its own line, in bold; then one row per
  option. The buttons share one column, as wide as the longest label with its chrome and at most
  40% of the band's width, and each option's whole text wraps in the space to its right. Dismiss
  is on the last row, with "or type your own reply". In 0.3.0 the question, the buttons and the
  texts shared one row, so every text wrapped into a narrow column.
- **The recommended option is the primary button** (accent style). No option has a hotkey: a bare
  digit in an empty prompt presses a band button, and a reply you type may start with one.
- A pain with no options keeps its one line: the question and Dismiss.
- **Known limit:** the button column is capped at 40% of the band, so a long label wraps inside
  its button: a 40-character recommended label (54 with its suffix) wraps in a band under about
  155 columns. Its text still wraps beside it, whole. Width counts characters, not terminal
  cells, so a label in wide characters (CJK) can wrap in its button sooner.

## 0.3.0

**Pain options: one press resumes autopilot.**

- **The turn-end fork offers options** (`prompts.ts`, `verdict.ts`): a `pain` verdict may carry
  `options`, up to three `{ label, text, recommended }`, with three rules in the fork prompt (at
  most one recommended; never the irreversible side of a one-way door; none for credentials).
  `parseTurn` drops every option on any invalid shape — not a list, more than three, an empty
  label or text, a text over 300 characters, a non-boolean `recommended`, two recommended — and the
  pain stands without them.
- **The band shows them** (`register.tsx`): one button per option, the recommended one first as
  `<label> (Recommended)`, each beside the whole text it submits, then Dismiss. A press clears the
  band, appends an `operator` ledger line (`why: chosen on the pain band`), and only then submits
  the option's text, never cut, with `$.prompt.submit({ asUser: true })`. A ledger that cannot be
  written submits nothing; a prompt that does not enter is an `option not sent` pain signal; one
  band takes one press. Labels and texts pass through the redactor first.
- **The bell and the pain file list the options** as `· options: 1) <label> (Recommended) 2) …`
  on the pain line. They stay text there.
- **The default policy gains a standing order**: stop for a pain item with `AskUserQuestion` and
  two or three options. An existing policy file is never rewritten: paste the line in (README,
  "The policy").
- **Known limit:** a policy file left at the 0.2.x default now reads `edited` in
  `/autopilot status`, and lacks the new order until the operator adds it.
- **Known limit:** the options are the fork's prose. A wrong or weak option is a wording issue the
  operator sees before pressing; nothing runs without the press.

## 0.2.1

**An allowed ask records no input value** (#683).

- **The allowed-ask ledger line** (`register.tsx`, `shape.ts` `inputShape`): an ask the permission
  fork allows now records the command's shape (as the never-approve path does since 0.1.1), or,
  for a tool with no command, its input key names only. Before, it recorded the raw input as
  JSON behind the best-effort redactor, which missed a JSON-escaped quoted value
  (`GITHUB_TOKEN=\"…\"`) and a backslash-escaped space (`TOKEN=a\ b`).
- **Known limit:** the fork's own prose — its reason and a turn-end question — still passes only
  through the redactor; it can quote a value in a form the redactor does not model.

## 0.2.0

**A token floor in place of the bash reader** (#684, direction 2′).

- **The never-approve list reads the command text as one bag of words** (`never.ts`). It joins
  a backslash-newline, drops `\`, `'` and `"`, splits at spaces, operators, backticks and `$(`,
  and shows each `NAME=VALUE` word's value. A rule fires when a verb and a danger word
  appear anywhere in the text; the list never decides which command a word belongs to. Quotes,
  wrappers, interpreters and substitutions no longer hide a push (`python3 -c 'git push -f'`).
- **Caught now** (the #684 gaps): a quoted `)` inside `$( )`, dashed executables (`git-push`),
  a glob or brace that builds a flag (`--forc*`), a backslash-newline in a word, `git push --
  <remote>` on the default branch, `-c remote.<name>.push=`, `+:dst` (also `branch-delete`), and
  `git send-pack` with no refspec (`default-branch-push`).
- **`unreadable` matches nothing.** No rule depends on following a command's shape, so the
  live check's stalls on valid bash (`python3 -c … && git commit`, a heredoc, a `for` loop) are
  gone. The name stays valid in `neverApprove`.
- **Extra asks, accepted:** a danger word beside a harmless command (`git commit -m "do not git
  push -f"`), any push after a `cd` or `git -C` to another directory whatever its refspec, `rm -r`
  of a path with a `..` segment, and a short cluster that holds the letter (`git push -ofoo`). Two
  quoted heredoc shapes are text and skipped — a `-m "$(cat <<'EOF' … EOF)"` commit message and
  `cat > file <<'EOF'` whose file is not named again — unless the rest of the text names a
  program that may run text (a shell, an interpreter, `ssh`, `sed`, `awk` …).
- **Known limits:** a script or program that runs git itself, a git alias from config, `sed`'s
  `e` command, a brace or glob that builds the verb, a bare variable beside `branch` or `commit`,
  and a danger only the filesystem shows.
- **Removed:** the per-command reader, and autonomic's copy of seat-mods' shell reader
  (`hooks/shell.ts`) with its arm in `tests/test-mod-shell-parity.sh`. seat-mods is unchanged.

## 0.1.1

**The pilot patch** (#677). Built on the live pilot of 0.1.0, run under bypass permissions.

- **molt's stage file** (F12; `floor.ts`, `records.ts`): the turn end is molt's when
  `~/.claude/state/molt/stage/<id>` says `command`, `block` or `fallback`; `yieldAtPercent` is
  only the fallback when no stage file exists, and a stage of `off` turns the fallback off. A
  live fill at or above the file's `command` yields too, whatever the hook order.
- **The bypass floor** (`register.tsx`): in autopilot, an `allow` for a command that matches an
  enabled never-approve rule becomes an `ask`, so the operator gets the dialog under bypass
  permissions too (probe P14). Manual mode never touches an allow; a deny is never changed.
  A failure inside the floor keeps the call with the operator. The reader now lists an
  interpreter, a git global it cannot skip, or an inline git alias as unreadable when the
  command names a danger, and reads an abbreviated long option as the option it abbreviates;
  an escaped, quote-split or brace word is unreadable, an `rm -r` path with a brace or a dot
  glob is outside, `--repo` names the remote, and `@` is `HEAD`; a wildcard destination may be
  the default branch, refspecs after `--` are checked, and `git -C` into another directory
  reads the branch as unknown, as does a `cd` below the root; wrappers such as `setsid` are
  runners, a short-flag cluster splits up to its value, and `send-pack`/`http-push` are
  unreadable. A session that leaves autopilot through a failure keeps the floor until
  `/autopilot off`. Path-qualified wrappers, unquoted heredoc substitutions, `rm` operands after
  `--` and the matching refspec `:` are read too. Credentials — bare or quoted values, credential
  headers and known token shapes — are redacted from the ledger and every pain signal, and a
  never-approve match records only the command's shape (`shape.ts`): verbs, a git subcommand and
  flag names, never a value.
- **`neverApprove`** (`config.ts`, `enforce.ts`): a `/config` setting naming the enforced rules,
  all six by default; empty means none; an unknown name is reported and ignored.
- **A deny beneath rings** (F7): a deny from a plugin beneath autonomic's `tool.call` hook rings
  "hard deny" once per session, tool and reason — except molt's own gate deny past its block
  stage.
- **Texts** (F2, F4, F5, F8, F9, F10, F13): `/autopilot status` drops the doubled prefix and lists
  policy `default`/`edited`, the settings, the enabled rules and molt's stage; one log line per
  fork; no doubled period before "Proceed."; the pain text leads with the line that matched; the
  `molt` ledger reason reads `molt owns this turn end`.
- **Docs** (F1, F3, F6, F11): no `/plugin configure` step is needed; the record's `source`
  values; a "Permission modes" section, bypass first.

## 0.1.0

**Autopilot as a mod** (#660). A session in autopilot keeps going without asks the planning already answered.

- **Mode** (`mode.ts`, `records.ts`): `AUTONOMIC_MODE=autopilot` per spawn or `/autopilot on [docs…]`; fails to manual; carried across a molt by molt's lineage file; a crew child takes its scope from its brief.
- **Policy** (`policy.ts`): `~/.claude/autonomic/policy.md`, written once, injected as a `session` system-prompt section.
- **Reflexes** (`register.tsx`): a cached fork at each turn end (covered, stalled, waiting, done, pain), at each `AskUserQuestion`, and at each permission ask; the never-approve list (`never.ts`) is code, before any fork; no deny is ever changed.
- **molt floor** (`floor.ts`): a `MOLT-HANDOFF:` line, a child's `handoff required`/`handed-off` status line, or a block beneath lets the turn end stand.
- **Ledger** (`ledger.ts`): one committed line per decision, with the fork's token usage; an unwritable ledger ends autopilot.
- **Pain**: band, toast, optional bell, optional `AUTONOMIC_PAIN_PATH` file.
- **Hard floors** (final review): `AskUserQuestion` and `ExitPlanMode` are never approved by the permission reflex; the never-approve list reads short-flag clusters, a lone `&`, block keywords, `-o` values, and lists any command it cannot follow when that command names a danger; it applies to every tool with a `command` input; a call too long to show the fork stays an ask; past `yieldAtPercent` (65) every turn end is molt's whatever the hook order; read-only Bash is no change for the loop guard; a free-text question and a failed ledger ring.
