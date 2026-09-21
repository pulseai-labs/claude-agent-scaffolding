# Changelog

## v0.7.0 — 2026-09-22

**Breaking:** auto-promotion and deterministic consolidation are withdrawn. Manual `/promote-principle` is unchanged.

### Removed
- **Auto-promotion machinery (`lib/promotion.sh`).** The vote-recurrence (T=4), instinct-signal (N=3), and 30/90-day suppression engine is deleted. It was never wired into a shipped path — no skill step ever called the vote writer — so no candidate could ever surface; the advertised feature could not have worked. `critiquing-spec` no longer runs a candidate check after the rebuttal cycle, and `listing-principles` no longer renders a suppressed-candidates footer.
- **Deterministic consolidator (`lib/consolidator.sh`).** `ac_consolidator_merge` matched challenge text by exact similarity only; consolidation is judgment work and now happens in `critiquing-spec` Step 7 prose (same issue → one challenge, both rationales kept, highest severity wins, cross-confirmed first).
- **Deterministic principle reads (`lib/principles.sh` helpers).** The merge/parse/seed/compose/load functions are gone; `critiquing-spec` Step 2 and `listing-principles` read the source files directly. `lib/principles.sh` now carries only the three path resolvers (`principles_shipped_path`, `principles_user_path`, `principles_project_path`).
- **Dead state writers.** `ac_state_read`, `ac_state_append_declined`, `ac_state_add_suppression`, and `_ac_date_add_days` served only the withdrawn paths.
- **Fresh-state fields.** A new `state.json` no longer seeds `candidate_promotions`, `declined_candidates`, or `auto_promote_suppressions` (the machinery that wrote them is gone).

### Changed
- **User-global principles have one home:** `~/.claude/architect-critic/principles.md` — under `$HOME`, surviving reinstalls. The plugin-data `principles.md` (`$CLAUDE_PLUGIN_DATA/architect-critic/principles.md`) was never actually read by audits; if you edited that file, move its principle lines into the `$HOME` file.
- **Reads no longer write.** `arc state_external_run_list` and `arc state_external_run_get` no longer initialize state: on a missing `state.json` they return `[]` / not-found and create nothing, and a v2 file is read without migrating it. The session-start hook no longer creates `state.json` as a side effect.
- **Session-start hook output drops the stale `v0.3` token.**

### Preserved
- Existing `state.json` files load unchanged: fields earlier versions wrote (including `candidate_promotions`, `declined_candidates`, `auto_promote_suppressions`) survive every write byte-for-byte — writers update only their own keys.
- Manual promotion end-to-end: `promoting-principle`, `arc state_append_promotion`, `principle_promotions[]` dedup.
- Async critique lifecycle: dispatch / status / result / cancel / resume, the shared Steps 7–9 procedure, `external_runs[]`, locking, and `ac_guarded_jq_write`.
- `/critique --principles PATH` remains accepted (currently unused by the skill).

### Tests
- New `tests/integration/test-withdrawn-residue.sh` scans every shipped file for references to the withdrawn machinery (20 fixed + 2 regex needles), pins scope discipline with three fixture trees, and pins the kept dispatcher surface + Step 10 labels.
- New `tests/unit/test-state-upgrade.sh` pins legacy `state.json` preservation (dropped fields survive `jq -S`-canonically through every kept verb), read-verbs-create-nothing with an adjacent writer control, no migration-on-read for v2 files, and the reduced fresh seed.
- `test-principles.sh` rewritten to pin the three path resolvers (including that the user-global path is under `$HOME`, not plugin data). `test-state.sh` drops the deleted-function assertions; T20's jq-failure branch now exercises `state_write_field` with an unparseable `--argjson`. `test-promotion.sh` and `test-consolidator.sh` deleted with their libs.
- `test-migration-smoke.sh` now asserts fresh state does not seed the dropped fields; `test-subagent-pressure.sh` drops the deleted libs from its sourcing check; the OpenCode adapter test matches the versionless session-start output.
- Eval: the `listing-principles` rubric drops its suppressed-candidate criterion (renumbered); fixture `listing-principles/03-with-suppressed-candidate` and its result are removed together. All other committed eval results predate the rubric edit and are unchanged.

## v0.6.1 — 2026-09-19

**Fix:** a state write can never empty state.json (#451).

### Fixed
- **Missing-fingerprint promote emptied state.json (#451).** `ac_promotion_promote`'s jq program binds `($cands[] | select(.fingerprint == $fp)) as $cand`; a fingerprint absent from `candidate_promotions[]` produces zero outputs, and `ac_guarded_jq_write` treated jq's exit 0 as sufficient — `mv`-ing a 0-byte temp file over `state.json`. Once emptied, every later guarded write kept it empty and `ac_state_init` would not repair it. Promote now refuses an unknown fingerprint up front with an error naming it, and `ac_state_init` re-seeds a 0-byte `state.json` with a warning so the emptied aftermath is recoverable.
- **The write funnel no longer trusts jq's exit status alone (#451).** `ac_guarded_jq_write` now refuses any replacement that is not exactly one JSON object — an empty stream or a multi-document stream — leaving the target byte-identical, removing the temp file, and returning non-zero. All twelve state.json writers funnel through it; promote's generator-shaped program was the only one that could emit zero output, and the guard now covers the class for any future caller.
- **`ac_state_init` refuses a non-empty unparseable state.json** (previously a silent no-op returning 0): re-seeding it could destroy data, so it now exits non-zero and leaves the file byte-identical.
- **Promote mis-handled instinct-recurrence fingerprints (#483 R1/N2).** The unknown-fingerprint precheck only consulted `candidate_promotions[]` and `principle_promotions[]`, so instinct candidates — surfaced from `recent_runs[].instinct_observations[]` by `ac_promotion_instinct_signal` — were refused with a misleading "no candidate" error. The precheck now classifies all three promotable sources in one read: a fingerprint found in a text-bearing source (`candidate_promotions[]`, or an existing `principle_promotions[]` for idempotent re-promote) promotes with `texts[0]` via `first(...)`, with an `error()` backstop so the program can never emit a non-object on a miss. An instinct-only fingerprint is now refused rather than written — the observation stores a bare fingerprint string and carries no principle text, so promoting it would record a hash as the principle; making instinct promotion actually work is tracked separately. The same precheck no longer conflates "fingerprint absent" (jq exit 1) with "state.json missing, unreadable, or corrupt" (exit ≥ 2): the latter preserves jq's stderr and reports a state problem.
- **A funnel refusal could leak `state.lock` — lock release is now owned, gated, and trap-backed (#483 C1/N1).** Under `bin/arc`'s `set -euo pipefail`, a caller that invoked `ac_guarded_jq_write` as a bare command aborted before reaching its own `ac_lock_release`, leaving `state.lock` behind and stalling every later write on the 5s acquire timeout; and releasing unconditionally risked deleting another process's freshly acquired lock in the gap. `ac_lock_acquire` now stamps the lock file with a per-acquire owner token and installs an `EXIT` trap (chaining any prior trap) that releases a still-held lock whenever the owning process exits — covering a funnel refusal, any other errexit inside the locked region, and normal return alike across all twelve locked callers. `ac_lock_release` removes the file only while it is still ours — path matches what we hold and content matches our token — so a second release is a no-op and a lock planted by another owner always survives.

### Tests
- New `tests/unit/test-guarded-write.sh` pins the funnel contract (empty and multi-document output refused byte-identically; a valid single-object write still lands). `test-promotion.sh` gains a dispatched-interface regression (`bin/arc promotion_promote` on a missing fingerprint). `test-state.sh` gains the 0-byte re-seed plus adjacent controls: a non-empty valid file stays byte-identical, a non-empty unparseable file is refused byte-identical.
- `test-promotion.sh` additionally pins, through `bin/arc`: an instinct-only fingerprint refused with a message naming it and the reason (observations carry no principle text); the dual-source, candidate, idempotent, and arbitrary-basis promotion paths; missing and corrupt `state.json` diagnosed as a state problem rather than a fingerprint miss; and duplicate-fingerprint candidates promoting once. `test-state.sh` pins both funnel-refusal branches under the lock (no `state.lock` remains; the next write succeeds without the acquire stall), ownership-gated release (a foreign lock planted between a refusal and the caller's release survives, and a second release is a no-op), and the EXIT-trap path (an errexit inside a locked region that is not a funnel refusal still releases the lock).

## v0.6.0 — 2026-07-10

### Added
- **`critiquing-spec` Step 8.0 disposition triage (pulse360#15).** Predicate-clean challenges auto-applied with a ⚡ Auto-applied digest, sequential rebuttal now walks the escalated subset; `walk_mode` (`--walk`); Step 10 summary + `state.json` gain `auto_applied_count`/`escalated_count` (`state_append_run` flags); async resume preserves walk mode; recommendation-policy copy updated.

## v0.5.1 — 2026-07-02

**Fix:** `critiquing-spec` rebuttal scoring is now agent-inline; the deterministic scorer is removed (#96).

### Fixed
- **Phantom `arc scorer_score` command (#96 F1).** `critiquing-spec` Step 8 prescribed `arc scorer_score "$CHALLENGE_TEXT" "$REBUTTAL_TEXT"`, which resolved to a nonexistent `ac_scorer_score` and failed (`Unknown function`, exit 2) for any user who rebutted a challenge. `bin/arc`'s header advertised the same phantom. The invocation is gone — the agent scores the rebuttal 1–5 inline using the existing rubric.

### Removed
- **Deterministic rebuttal scorer (`lib/scorer.sh`, #96 F2/F3).** `ac_scorer_score_rebuttal` was a lexical heuristic gate that under-scored genuinely strong rebuttals (it returned `3` for material-new-info in the #93 dogfood) — the exact "deterministic semantic-quality judgment" that promoted principle `pp-e72993dfb626c518` assigns to an agent reviewer. Scoring a rebuttal 1–5 is a semantic call, and Step 8 already states the agent makes every judgment call, so the helper (and the unused `ac_scorer_decide`, whose `restate`/`concede` vocabulary diverged from the SKILL's `stands`/`concede` rubric) is dropped along with its unit tests. A repro guard in `tests/integration/test-bug-repros.sh` now asserts the SKILL prescribes no `arc scorer_score*` command and `arc --list` advertises no such function.

## v0.5.0 — 2026-06-30

**Feature:** `critiquing-spec` adopts the recommend-by-default decision policy (#93).

### Changed
- **Recommended disposition per challenge (#93).** Each surfaced challenge now carries a firm, CORE-toned **recommended disposition** (`accept` / `rebut` / `defer`) plus a one-line rationale grounded in the artifact + principles and cited where possible — the user no longer adjudicates each challenge cold. The rebuttal-cycle disposition triple is reframed `accept | rebut | dismiss` → **`accept | rebut | defer`** (`defer` = challenge valid/unresolved but tracked for later, e.g. filed as an issue; it absorbs the old `dismiss`). The 1–5 concession scorer (`lib/scorer.sh`, T=4 threshold) is unchanged — it still scores rebuttals only. `--neutral` (or "no recommendations") suppresses the recommended-disposition line per invocation. The shared policy is the marketplace convention `docs/conventions/recommendation-policy.md`, shipped as a byte-identical copy at `templates/recommendation-policy.md` and guarded by the repo-root parity test `tests/test-recommendation-policy-parity.sh`. Adopts the convention owned by ai-mentor v2.2.0; pairs with scaffold-dev v0.15.0.

## v0.4.0 — 2026-06-25

**Feature:** `critiquing-spec` now opens with an orientation preamble (#88).

### Added
- **Orientation preamble in `critiquing-spec` (#88).** Before surfacing adversary status and running the host self-audit (Step 4, after the artifact is resolved in Step 1), the agent emits a compact **"📍 You are here"** block — Topic (the artifact under audit) / Where-it-sits + strategic weight / Why — so the user is globally anchored on resume or context-switch. Derived from the artifact + any referenced issue/PR + memory-bank + recent handoffs; asks for a one-line reminder when context is thin rather than fabricating. One insertion covers both the synchronous and `--async` close-depth paths (they share Steps 1–5; async shows it once at dispatch). Re-surfaceable on demand ("where am I?"). Agent-driven prose — no deterministic helper, no templating, no hook. Adopts the convention owned by ai-mentor v2.1.0.

## v0.3.0 — 2026-06-18

**Feature:** the close-depth external adversary can now run as a managed **background (async)** job (#39). The existing synchronous path is unchanged and remains the default.

### Added
- **Async close-depth adversary.** `/critique --close --async` dispatches Codex via the `codex-plugin-cc` companion's `task --background` (reusing the proven SS-5/SS-5.1 `lib/codex.sh` spine, ported to `ac_` prefix), records the run, and returns a job handle. **Defer-to-resume (unified) model:** turn 1 shows a read-only host self-audit preview + persists it + dispatches; `resume` later consolidates *both* adversaries (cross-confirmation preserved) and runs one unified rebuttal. The adversary runs **read-only** (no `--write`).
- **Job manager.** New `managing-async-critique` skill + `/critique-jobs <status|result|cancel|resume> [run-id]`. `resume` re-enters the shared "Consolidate + Rebuttal + Append" procedure (critiquing-spec Steps 7–9); a concluded run resumes **inspect-only** (re-resume idempotency guard via `resolved_run_request_id`).
- **Readiness doctor.** New `checking-adversary-readiness` skill + `/critique-doctor` (`ac_codex_doctor`): fail-soft probe of codex/claude binaries, companion resolution, and codex auth/schema readiness, with actionable (user-driven) remediation.
- **Size-aware guidance.** `ac_codex_size_hint` recommends foreground vs background at dispatch (threshold `ARCHITECT_CRITIC_ASYNC_HINT_LINES`, default 400).
- **state.json schema v2 → v3:** new `external_runs[]` durable job memory (idempotent `ac_state_migrate`; lazily applied to a v2 file by `ac_state_init`). `reviewing-critique-history` now also lists in-flight/recent background audits; the session-start hook surfaces a read-only in-flight count.
- **CI:** architect-critic now ships a `run-tests.sh` runner and runs in the repo's GitHub Actions suite (previously absent).

### Fixed
- **macOS-only suppression-expiry bug (pre-existing).** `ac_state_add_suppression` computed `expires_at` with a BSD `date` form where `-v+Nd` followed the positional input — BSD getopt stops at the first positional, so the adjustment was silently ignored (expiry == suppressed_at). The suppression tests used the identical broken command to compute their expected value, so the equality checks were circular false-greens that masked it. New portable `_ac_date_add_days` (BSD `-v` before `-f`; GNU `date -d` fallback; each branch validated against a strict ISO-8601 regex) fixes both macOS and Linux; an independent guard breaks the circular check.

### Notes
- **Dual-publish constraint:** async = Claude-host → Codex-adversary only (the proven companion backend). Codex-host → Claude-adversary keeps the synchronous path. Skills/commands ship on both surfaces.
- **Migration:** existing v2 state files upgrade to v3 in place on next use (adds an empty `external_runs[]`); all v2 fields preserved.

## v0.2.2 — 2026-05-28

### Fixed
- **Issue #11 — Codex structured output schema strictness:** `templates/output-schema.json` now marks every object schema with `additionalProperties: false`, requires all declared properties, and uses nullable fields where optional semantics are needed for Codex structured outputs.
- **Issue #12 — helper invocation compatibility:** `arc state_append_run` now accepts the original positional signature plus flag form (`--request-id`, `--depth`, `--adversaries`, `--challenge-count`, `--concessions`, `--skill-invoked`, `--elapsed-ms`). `--adversaries` accepts either a JSON array or CSV.
- **Issue #12 — state lock hardening:** failed JSON validation or `jq` mutation no longer leaves the state lock behind.
- Documented exact `state_append_run`, `consolidator_merge`, and `promotion_check_candidates` helper signatures in `critiquing-spec/SKILL.md`.

## v0.2.1 — 2026-05-26

Shell-portability patch (v0.x.1 bundle). See `docs/HANDOFF-shell-portability-v0x1.md` in the marketplace repo.

### Fixed
- **Shell portability (zsh compatibility):** Claude Code's Bash tool runs zsh by default on macOS; skill bodies used `bash -c 'source "${CLAUDE_PLUGIN_ROOT}/lib/X.sh" && ac_fn'` to force a bash subshell, but `$CLAUDE_PLUGIN_ROOT` isn't exported to Bash tool subprocesses (anthropics/claude-code#48230) so the source path resolved to `/lib/X.sh` and failed silently. Added `bin/arc` dispatcher with `#!/usr/bin/env bash` shebang (named `arc` not `ac` because `/usr/sbin/ac` is macOS's login-accounting utility — `ac` would shadow or be shadowed depending on PATH order). All 8 source-call sites across the 3 active skills refactored to invoke `arc <fn-suffix>` instead of `bash -c 'source && fn'` (`promoting-principle`, `listing-principles`, `critiquing-spec`). `arc --list` enumerates dispatchable functions. The dispatcher is auto-discoverable via `$PATH` (Claude Code adds each plugin's `bin/` to PATH automatically).

### Naming notes
- **The shell command is `arc`** (not the originally-planned `ac` from the handoff doc) because `ac` collides with macOS's `/usr/sbin/ac` system utility. Function-name prefix `ac_` in lib code is unchanged — only the dispatcher binary name differs.

## v0.2.0 — 2026-05-24 (BREAKING)

**Architecture:** ground-up retrofit to skill-first. 4 skills (gerund-named) replace the v0.1.3 bash-orchestrates-Claude approach. Slash commands become thin `$ARGUMENTS` wrappers. File-IPC inbox/outbox protocol removed.

### Breaking changes

- **Inbox/outbox file-IPC protocol removed.** Consumer plugins must invoke skills in-conversation. `scaffold-onboard v0.2+` required for in-conversation handoff (v0.1.x scaffold-onboard will not work with architect-critic v0.2).
- **state.json schema v1 → v2**: drop `in_flight` array (no async); drop `cost_usd` from `recent_runs[]`; add `concessions`, `skill_invoked`, `auto_promote_suppressions[]`. First-run migration auto-renames the v0.1.x file to `state.json.v0.1.3.bak` (timestamped on collision).
- **`cost_usd` reporting removed entirely.** Field gone from schema; `lib/cost.sh` deleted; per-audit cost line no longer surfaced.
- **`--depth` flag renamed to `--close`** (semantic clarity: depth is binary shallow/close, not an enum).
- **Codex CLI 0.125+ required** for adversarial fresh-frame audit (uses `--json --output-schema --output-last-message --ignore-rules`). v0.1.3 prose-parsing fallback removed.

### Added

- **4 skills (gerund-named):** `critiquing-spec`, `reviewing-critique-history`, `listing-principles`, `promoting-principle`. Each lives in `skills/<name>/SKILL.md` as markdown Claude reads + acts on.
- **Ghost notes principle** (Wald survivor-bias insight — look for what is *absent*) + **CORE protocol** (Curiosity / Objectivity / Reassurance / Empathy — rebuttal tone) as shipped-default principles in `templates/principles.md`. Auto-prepended to existing user principles on first-run migration.
- **Full auto-promotion machinery** (was design-intent in v0.1.3): vote-recurrence with T=4 threshold + supplementary instinct-style consecutive-runs signal (N=3 default) + suppression windows (30-day for score-4 declines, 90-day for score-5).
- **LLM-as-judge eval harness** (`tests/eval/`): 4 skills × 5 fixtures × 2 Agent dispatches per full run. Runs from a Claude Code session via `tests/eval/RUNBOOK.md`. No API wrapper.
- **SessionStart fail-open ambient status hook** (~50 tokens; never blocks).
- **`lib/migration.sh`** — first-run v0.1.x → v0.2 migration: state backup, inbox/outbox moved to `legacy-v0.1.x/`, shipped defaults prepended to principles.md preserving user content.

### Fixed (GitHub issue #1 — all 8 bugs)

- **#1** `$N` substitution corrupting slash-command args — all commands now use `$ARGUMENTS` env-var bridge exclusively (per `[[feedback_slash_command_dollar_n_bug]]`); none of the 4 commands use bare `$1`/`$2` positionals.
- **#2** silent no-op claude-self-audit — audit logic moved into skill body (`skills/critiquing-spec/SKILL.md` Step 5); Claude executes the audit in-conversation, not via `bash -c` wrapper.
- **#3** hard-fail without MASTER-SPEC.md — discovery order: explicit arg → manifest `well_known_paths.master_spec` → restricted `SPEC*`/`PLAN*` glob (never `*.md`) → `AskUserQuestion` fallback.
- **#4** rebuttal cycle silently skipped non-TTY — rebuttals handled via Claude's native turn flow; no `bash read`.
- **#5** codex availability not surfaced to user — skill body explicitly checks `command -v codex` and reports status ("Codex detected", "Codex not installed", "Codex available but depth=shallow") before audit runs.
- **#6** `cost_usd` always zero — field removed entirely from schema + state.sh + UI.
- **#7** README missing standalone-use guidance — added Standalone Use section.
- **#8** `project_class=unknown` consequence undocumented — documented in `skills/critiquing-spec/SKILL.md` + `README.md`.

### Removed

- `lib/inbox.sh`, `lib/outbox.sh`, `lib/cost.sh` and their tests.
- `tests/test-commands.sh`, `tests/test-e2e.sh` (v0.1.3 file-IPC test scaffolding; superseded by `tests/integration/`).
- Inbox/outbox runtime directories (handled by migration).

### Internal

- Test layout restructured: `tests/unit/` (~197 assertions), `tests/integration/` (bug repros, migration smoke, subagent pressure, consumer-plugin SKIP-with-TODO tests), `tests/eval/` (LLM-as-judge harness).

### Eval baseline (16/20 fixtures pass — meets ≥16/20 release gate)

First end-to-end eval run on the v0.2.0 release candidate. Per-skill: `critiquing-spec` 5/5, `reviewing-critique-history` 5/5, `listing-principles` 5/5, `promoting-principle` 1/5. The 4 promoting-principle failures surfaced 3 issues deferred to v0.2.1 (none block functionality; baseline JSONs in `tests/eval/results/` for re-run diffing):

- **promoting-principle SKILL vs rubric annotation-format mismatch** (fixtures 01, 04): SKILL uses HTML comment on a separate line (`<!-- source: user-promoted, promoted_at: ..., principle_id: ... -->` followed by the bullet); rubric expects inline `[promoted DATE source:manual]`. Both formats are defensible — needs design call.
- **promoting-principle Jaccard threshold gap** (fixture 02): "Look for what is absent" (5 tokens) vs the full ghost-notes shipped line (11 tokens) scores 0.45 Jaccard, below the 0.85 duplicate-rejection threshold. A user typing a short paraphrase of an existing principle would not get the duplicate warning. Either lower the threshold or add a substring-containment fallback.
- **listing-principles rubric path bug** (fixture 03, fixed mid-release): rubric for `--scope project` originally expected `.claude/memory-bank/03-code-patterns.md` (a scaffold-onboard namespace) but SPEC §5.4 + SKILL use `.claude/architect-critic/principles.md`. Fixed in the rubric; re-eval green.

## [0.1.3] — 2026-05-16

### Fixed
- **G5 user-owned guarantee:** runtime re-seed of principles.md no longer silently restores the 7 commented example principles when the user has deleted the file. The full template (with examples) is now install-time only; runtime re-seed writes a minimal placeholder (preamble + empty `## Your principles` section). New function `ac_principles_seed_minimal()` in `lib/principles.sh`; `ac_principles_load_user_global` switched to use it on missing-file path. Adds 3 regression tests in `test-principles.sh` covering both runtime-minimal and install-full paths. (Issue #1 surfaced by a v0.1.2 self-audit of SPEC §11 vs §3 G5.)

### Added
- **Rate-card staleness signal in cost line (OQ-3 polish):** `lib/cost.sh` now tracks `AC_COST_RATE_CARD_UPDATED` (default `2026-05-01`) + `AC_COST_STALENESS_DAYS` (default 180). When the rate-card is older than the threshold, `ac_cost_print` appends ` (rates from YYYY-MM-DD — may be stale; see lib/cost.sh)` to the cost line. Constants are no longer `readonly` so tests can override; production code treats them as immutable by convention. Portable across BSD (macOS) and GNU (Linux) date parsing. Adds 2 regression tests in `test-consolidator.sh`. (Issue #2 surfaced by the same self-audit.)

### Deferred to v0.2
- **Q4 rubric — distinct outcomes for score 4 vs score 5.** Currently both ≥4 collapse to `concede`; v0.1.0–v0.1.3 honor scaffold-onboard's inherited Q4 ("single threshold, not adaptive"). Score 5 ("premise invalidated") is a stronger signal — the *critic itself* was wrong, not just that the user added new info — and arguably warrants a distinct outcome (e.g., mark challenge as `critic_invalid`, longer suppression than the 30-day decline window). Requires Q4 amendment in `docs/SPEC-scaffold-onboard.md` §9 (cross-plugin coordination) + brainstorm session. See SPEC-architect-critic.md §15 for v0.2 candidates.

## [0.1.2] — 2026-05-16

### Fixed
- **Critical: slash command argument parsing was broken in v0.1.0/0.1.1.** Claude Code substitutes `$N` positional variables at slash-command template-render time, BEFORE bash sees the script. Our v0.1.0 command bodies used `case "$1" in ... --spec) SPEC_ARG="$2"` patterns where bash's runtime `$1`/`$2` were intended — but Claude Code substituted them at render time with the user's args, baking a fixed string into the source. Manual `/critique --spec PATH` therefore always missed the flag and fell back to `./MASTER-SPEC.md`. Same bug in `/critique-list --limit N` and `/promote-principle "<text>" --scope X`.
- **Fix:** all three commands now bridge `$ARGUMENTS` (the raw arg string Claude Code DOES substitute correctly) into bash via env var (`RAW_ARGS_FROM_CLAUDE`), then extract individual flags via `sed -nE "s|.*--flag[= ]+([^ ]+).*|\\1|p"` patterns that never reference bash positionals. `/critique` also strips a leading `@` from `--spec` values (Claude Code's file-reference syntax).
- **Companion fix:** `/promote-principle` validation no longer uses `*$'\n'*` ANSI-C newline check (the `'` characters terminated the outer `bash -c '...'` single-quoting); now uses `wc -l` instead.
- **Tests:** `test-commands.sh` `run_command` helper updated to simulate Claude Code's `$ARGUMENTS` substitution by rendering the full bash block + replacing `$ARGUMENTS` before exec. 244/244 tests green.

## [0.1.1] — 2026-05-16

### Added
- `argument-hint:` frontmatter on all 4 commands so the slash-command picker shows expected flags (`/critique [--phase N] [--depth ...] [--spec PATH]`, `/critique-list [--limit N]`, `/promote-principle "<text>" [--scope user|project]`). Polish on top of v0.1.0; no behavioral change.

## [0.1.0] — 2026-05-16

Initial release. **244 tests passing across 10 bash suites** (full regression < 30s); scaffold-onboard's 163 contract tests remain green (regression check per HANDOFF §7).

Built on branch `implementation-architect-critic` over Phases A–H per `docs/PLAN-architect-critic.md`. The build was subagent-driven for logic-bearing phases (B → D) and main-session-inline for scaffold/integration phases (A, E → H) after agent runtime instability surfaced in mid-flight. See `docs/SPEC-architect-critic.md` and the brainstorm transcript in `.superpowers/brainstorm/56102-1778732670/` for the design.

### Added (Phases A → G — see [Unreleased] notes below for the per-phase breakdown)

### Added
- **Phase A — plugin scaffold:** plugin.json manifest, LICENSE (MIT), README skeleton, CHANGELOG, 4 command stubs (`/critique`, `/critique-list`, `/promote-principle`, `/principles-list`), SessionStart hook stub, `lib/_helpers.sh` (logging + jq-then-mv guard + lock-file pattern), 9 empty lib stubs ready for Phase B–E, `templates/principles.md` seed (D3 stub-with-examples per SPEC §6.4), test infrastructure (`tests/_helpers.sh` with assert_*, setup_tmp_repo, setup_mock_codex), mock-codex PATH-override fixture + 3 canned codex payloads + tiny MASTER-SPEC fixture.
- **Phase B — state + principles + inbox (78 tests):**
  - `lib/state.sh` (35 tests): all 9 `ac_state_*` functions; lock-protected writes via `ac_guarded_jq_write`; recent_runs cap-20 trimming; full state.json schema per SPEC §6.3.
  - `lib/principles.sh` (22 tests): comment-strip handles both headers AND example comments per SPEC §6.4; trailing `[promoted ...]` annotation strip; 4-source compose with absent-source graceful degradation; BSD awk `sub()` chains for portability.
  - `lib/inbox.sh` (21 tests): all 8 ordered ERROR validation rules per SPEC §6.1; warning paths for missing principles file + null project_class; rule 6 correctly bypassed for `master-spec-full` target type.
- **Phase C — slash command bodies (103 tests cumulative):**
  - `/critique` (commands/critique.md): envelope synthesis from defaults (manual mode) + inbox-read (programmatic mode) + arg overrides (`--phase`, `--depth`, `--spec`) + validation via `ac_inbox_validate`. Audit pipeline stubbed pending Phase D.
  - `/critique-list`: jq-sliced LIMIT enforcement (no `tac`, no subshell trap); renders 7 columns including cost_usd; separate in_flight section.
  - `/promote-principle`: validates ≤200-char single-line text; `--scope user|project` routing; uses `ac_guarded_jq_write` for state.json writes; ERROR exit when scope=project and no memory-bank.
  - `/principles-list`: delegates to `ac_principles_compose`; renders 4-section composition; "(empty)" surface when principles.md absent.
  - `test-commands.sh` (25 assertions across 12 PLAN scenarios): extract-bash-from-markdown approach exercises actual command bodies, not lib internals.
- **Phase D — audit pipeline core (184 tests cumulative):**
  - `lib/codex.sh` (16 tests): `ac_codex_available` + `ac_codex_audit` with portable bash-only timeout (background subshell + kill — no GNU `timeout(1)` dependency), 180s default + `ARCHITECT_CRITIC_CODEX_TIMEOUT` env override, strict JSON parse with jq, all 4 failure paths (absent / timeout / non-zero / malformed JSON) fall back to return 1 + claude-only. Extended mock-codex fixture with `MOCK_CODEX_SLEEP` + `MOCK_CODEX_EXIT_CODE` env vars.
  - `lib/consolidator.sh` (29 tests): `ac_consolidator_merge` implements SPEC §7.1 — concat + source-tag + exact-match dedup with `agreed_by_both` marker + heuristic divergence detection + gap concat; `adversaries_used` derived from inputs. Single jq invocation; jq 1.7 BINDING-syntax workarounds applied.
  - `lib/scorer.sh` (14 tests): T=4 firm rubric per Q4 — heuristic check (bare contradiction → 1, cite-self substring → 2, material new info → ≥4), `ARCHITECT_CRITIC_SCORER_MOCK` env override for the claude-reasoning fallback path, 500-char rebuttal truncation. `ac_scorer_decide` returns concede ≥4 else restate.
  - `lib/outbox.sh` (19 tests): `ac_outbox_write` assembles full SPEC §6.2 envelope (7 fields), uses `ac_guarded_jq_write` for atomic write, `cost_usd` preserved as JSON number via `--argjson`, mkdir-p safety, idempotent overwrite.
  - `lib/cost.sh` (2 tests in test-consolidator): `ac_cost_compute` with static rate-card (`AC_COST_CODEX_IN_PER_1K=0.005`, `AC_COST_CODEX_OUT_PER_1K=0.015`; "as of 2026-05" doc comment), bc-or-bash-only fallback. `ac_cost_print` formats per SPEC OQ-3 line.
  - `commands/critique.md` (no new tests; full pipeline wired): Steps 3–11 of SPEC §5.1 in place — record in_flight → claude-self-audit (with `ARCHITECT_CRITIC_CLAUDE_AUDIT_MOCK` test hook) → codex audit if depth=close → consolidator merge → outbox write → cost line → state completion. Phase E rebuttal-cycle + promotion-offer steps stubbed.
- **Phase E — auto-promotion FULL + rebuttal cycle (216 tests cumulative):**
  - `lib/promotion.sh` (29 tests via test-promotion.sh): full SPEC §7.2 algorithm — `ac_promotion_topic` (lowercase + stemmed first word + sorted refs), `ac_promotion_within_run_candidates` (cluster by topic, emit groups ≥2), `ac_promotion_cross_run_candidates` (scan state.json recent_runs[0..19], emit when total ≥3), `ac_promotion_synthesize` (claude-reasoning prompt builder + `ARCHITECT_CRITIC_PROMOTION_MOCK` env override), `ac_promotion_filter_suppressed` (30-day decline window), `ac_promotion_record_candidates` + `ac_promotion_record_decline`.
  - `/critique` rebuttal cycle: iterates consolidator's challenges, prompts user for `accept`/`edit`/`note`/`<rebuttal>`, scores rebuttals via `ac_scorer_score_rebuttal`, concedes at ≥4 else restates. TTY-gated (or `ARCHITECT_CRITIC_REBUT_INPUT` env override for tests). Uses process substitution `< <(printf …)` so inner `read -r` doesn't conflict with outer challenge iteration.
  - `/critique` auto-promotion offer: composes within-run + cross-run candidates, filters via 30-day suppression, records to state.json's `candidate_promotions`. Interactive `[y]es/[n]o/[e]dit` per candidate, TTY-gated. y → `ac_state_append_promotion` + appends to principles.md with `[promoted YYYY-MM-DD source:auto]` annotation; n → `ac_promotion_record_decline` (30-day suppression); e → opens `$EDITOR` (or `true` as safe default).
  - `lib/principles.sh` (25 tests via test-principles.sh): `ac_principles_load_user_global` re-seeds from template if file missing (SPEC §11 edge case).
- **Phase F — hooks + scaffold-onboard delta (OQ-2) (219 tests cumulative + scaffold-onboard 163 regression-green):**
  - `hooks-handlers/session-start.sh` (2 tests in test-state.sh): housekeeping clears `state.json.in_flight` entries with `started_at < now − 24h`. Source-aware: only fires on `startup`/`clear` per `hooks/hooks.json` matcher. Lock-protected write.
  - `lib/state.sh` schema-migration tolerance (3 tests): `ac_state_init` logs info + preserves on-disk schema_version > 1 (forward-compatibility).
  - `/critique-list` cost column (1 test in test-commands.sh): renders `cost_usd` from `recent_runs[]` per OQ-3 minimal cost UX.
  - **OQ-2 scaffold-onboard delta:** `scaffold-onboard/commands/onboard.md` frontmatter now includes `SlashCommand` in `allowed-tools`. The per-phase critic dispatch already lives in the protocol prose (Phase 5/7 recap + MASTER-SPEC close steps invoke `/critique`); adding `SlashCommand` to the allowed-tools makes that invocation possible from inside `/onboard`. scaffold-onboard's 163 regression tests stay green. **TF.3 mock /critique handler** marked N/A: scaffold-onboard's `test-e2e.sh` exercises lib functions directly (not the slash command body), so there's no `/critique` invocation to mock.
- **Phase G — E2E + polish (244 tests cumulative):**
  - `tests/test-e2e.sh` (22 tests): three end-to-end scenarios per SPEC §12 — TG.1 manual /critique in empty repo with mock-codex (close depth, 3 challenges merged), TG.2 onboarded repo with /critique --phase 5 premise-audit (claude-only), TG.3 full audit cycle exercising consolidator + within-run candidate detection + promotion accept-path + decline-path + scorer concede/restate transitions + OQ-3 cost line. Uses mock-codex via PATH override + `ARCHITECT_CRITIC_CLAUDE_AUDIT_MOCK` env hook for hermetic execution.
  - `README.md` polish: worked example walking through manual `/critique` (rebuttal cycle + promotion offer), cost section with sample line, composition section (standalone vs scaffold-onboard), see-also pointers to SPEC + PLAN + scaffold-onboard §8.3.
  - Hardening sweep: `ac_guarded_jq_write` confirmed as the write path for every state.json mutation; `ac_lock_acquire`/`ac_lock_release` paired with explicit release before each `return` (Adaptation 3); `bash -n` syntax check passes on all lib + hook handlers + command body extracts.
