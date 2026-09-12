---
name: managing-async-critique
description: Manage background (async) close-depth critique jobs — status, result, cancel, and resume. Triggers on "critique jobs", "resume critique", "resume the async audit", "cancel critique audit", "check critique job", "/critique-jobs". Resume consolidates the finished Codex result with the persisted host self-audit and runs one unified rebuttal; a concluded run resumes inspect-only.
---

# managing-async-critique

You have been invoked to manage **background close-depth critique jobs** created by `/critique --close --async` (#39). Those runs dispatch Codex as an external adversary in the background and record themselves in `state.json` under `external_runs[]`. This skill exposes four verbs: **status**, **result**, **cancel**, **resume**.

**Devin host (`HOST_AGENT=devin`): unsupported.** Devin has no external adversary backend and no background job infrastructure for architect-critic. `--async` is hard-refused at dispatch time (see `critiquing-spec` Step 3), so no `external_runs[]` records are ever created on Devin. If this skill is invoked on Devin, respond immediately: *"Async critique jobs are not supported on Devin. Devin runs host-only audits with no external adversary. There are no background jobs to manage."* Do not list runs, do not query state, and do not attempt any verb. This skill is a no-op on Devin.

Parse the verb (+ optional `<run-id>`) from `$ARCHITECT_CRITIC_ARGS` (the `/critique-jobs` wrapper exports it; env-var bridge per [[feedback_slash_command_dollar_n_bug]]). If no `<run-id>` is given, default to the most recent applicable run (see each verb). If `--neutral` is present on `resume`, force `neutral_mode=true`; otherwise resume inherits `external_runs[].neutral_mode` from the original `/critique --close --async [--neutral]` dispatch. All state/spine calls go through the `arc` dispatcher. Likewise re-derive `walk_mode` from the run record — `external_runs[].walk_mode`, persisted at dispatch: when `true`, the resumed unified rebuttal walks every consolidated challenge; otherwise it runs `critiquing-spec` Step 8.0 triage first (auto-apply predicate-clean dispositions, walk the escalated subset).

List runs for context with:
Resolve the `arc` dispatcher once and hold it in `arc_bin` — it is on `$PATH` on Claude Code and Codex, but **not** on Devin, where `bin/` is never added. Recipe per the plugin's `rules/dispatcher-path.md`: `command -v arc`, else the `source:` path (`--local` installs), else the plugin-cache manifest glob (remote installs). Every `arc` invocation below — and in this skill's references — is `"$arc_bin"`.

```bash
"$arc_bin" state_external_run_list            # all
"$arc_bin" state_external_run_list --status running
```
Each record carries: `run_id, host_agent, adversary, artifact_path, depth, status, started_at, completed_at, result_path, codex_session_id, neutral_mode, walk_mode, resolved_run_request_id`. The `target_root` for spine calls is `arc codex_target_root "<artifact_path>"`.

---

## Verb: status [run-id]

Default `run-id`: the most recent `running` run (else the most recent overall).

1. Read the record: `arc state_external_run_get "<run-id>"` (rc1 → tell the user no such run; list runs).
2. If `status == running`, check once for a fresh disposition (non-blocking and non-mutating — do **not** use the bounded wait loop):
   ```bash
   term="$(arc codex_status "$(arc codex_target_root "<artifact_path>")" "<run-id>")"
   ```
   Update the stored status only if it changed to a terminal token: `arc state_external_run_set_status "<run-id>" "$term"` for `completed|failed|cancelled|stalled|capped`. Never persist `running` or `error`.
3. Report: run id, artifact, depth, status, started/completed timestamps, and — if `resolved_run_request_id` is set — that the run has already been resumed/concluded.

## Verb: result [run-id]

Default `run-id`: the most recent `completed` run.

1. Read the record. If `status == running`, first run the same one-shot refresh as `status`:
   ```bash
   term="$(arc codex_status "$(arc codex_target_root "<artifact_path>")" "<run-id>")"
   ```
   Persist only terminal tokens (`completed|failed|cancelled|stalled|capped`) and continue with the refreshed value. If it is still `running`, report that and stop.
2. Require `status == completed` (else report the current terminal status and stop).
3. Fetch the raw Codex challenges (no rebuttal): `arc codex_result "$(arc codex_target_root "<artifact_path>")" "<run-id>"` → a `{challenges,gaps}` object. If this fails, set the external run to `failed`, report that the stored Codex result is malformed/unparseable, and stop without entering consolidation.
4. Present the challenges read-only. Remind the user that **`resume`** is what folds them into a rebuttal; `result` is inspect-only.

## Verb: cancel [run-id]

Default `run-id`: the most recent `running` run.

1. Read the record; if already terminal, say so and stop.
2. Cancel via the spine and record the returned disposition:
   ```bash
   term="$(arc codex_cancel "$(arc codex_target_root "<artifact_path>")" "<run-id>")"
   ```
   If `term == cancelled`, persist `arc state_external_run_set_status "<run-id>" cancelled`. If `term == completed`, persist completed and tell the user the job completed before cancellation, so `resume` is still available. For `failed|stalled|capped`, persist that terminal token; for `error`, report the error without overwriting state.
3. Confirm the final disposition to the user.

## Verb: resume [run-id]  — the defer-to-resume unified rebuttal (#39)

Default `run-id`: the most recent `completed` (else `running`) run for the current artifact.

1. **Read the record.** `arc state_external_run_get "<run-id>"`.
2. **Idempotency guard.** If `resolved_run_request_id` is already set, this run was concluded — **resume inspect-only**: print the prior conclusion (the `recent_runs` entry whose `request_id` matches) and STOP. Append nothing. (Mechanically: a later `arc state_external_run_finalize_resume` would also return rc1, so never re-append.)
3. **Require terminal `completed`.** If the stored job is still `running`, refresh once with `arc codex_status "$(arc codex_target_root "<artifact_path>")" "<run-id>"` and persist only terminal tokens (`completed|failed|cancelled|stalled|capped`). If the refreshed status is still `running`, report it and stop — do not partially consolidate. If `failed/cancelled/stalled/capped`, report that terminal status and the still-available host self-audit preview, and stop (nothing to consolidate).
4. **Load both adversaries.**
   - `claude_audit` = the persisted turn-1 host self-audit at `$(arc data_dir)/async/<run-id>/claude-audit.json`. If that file is missing or unparseable, do **not** consolidate — report that the turn-1 self-audit was lost, present the Codex result read-only (`result` semantics), and stop without appending; the run stays unresolved so a fresh `/critique --close` can redo it.
   - `codex_audit` = `arc codex_result "$(arc codex_target_root "<artifact_path>")" "<run-id>"`. If this fails, set the external run to `failed`, report that the Codex result is malformed/unparseable, and stop. Do not enter the shared consolidation flow with a missing or invalid Codex audit.
5. **Enter the shared procedure.** Run the **"Consolidate + Rebuttal + Append"** procedure defined in `critiquing-spec` Steps 7–9 with `{claude_audit, codex_audit, artifact: <artifact_path>, depth: close, neutral_mode: <record neutral_mode or --neutral override>, walk_mode: <record external_runs[].walk_mode or --walk override>}`: consolidate (cross-confirmation surfaces first) and run one unified rebuttal cycle with T=4 concession scoring. If `neutral_mode=true`, omit recommended dispositions exactly as `critiquing-spec` Step 3/8 says. Run Step 8.0 disposition triage only when **both** `walk_mode=false` and `neutral_mode=false`; otherwise every consolidated challenge is walked sequentially, exactly as `critiquing-spec` Step 8.0/8 says. Track any deferred challenges as `DEFERRED_COUNT` + `DEFERRED_CHALLENGES_JSON`, and triage counts as `AUTO_APPLIED_COUNT` + `ESCALATED_COUNT` (both `0` when triage was skipped). When Step 9 would append the run, use the atomic async finalizer below instead of direct `arc state_append_run`.
6. **Append + mark resolved atomically.** After the rebuttal concludes, mint the run's `request_id` and finalize with one locked state transaction:
   ```bash
   arc state_external_run_finalize_resume \
     --run-id "<run-id>" \
     --request-id "<request_id-from-step-5>" \
     --depth close \
     --adversaries claude,codex \
     --challenge-count "<challenge_count>" \
     --concessions "<concessions>" \
     --deferred-count "$DEFERRED_COUNT" \
     --deferred-challenges "$DEFERRED_CHALLENGES_JSON" \
     --auto-applied-count "$AUTO_APPLIED_COUNT" \
     --escalated-count "$ESCALATED_COUNT" \
     --skill-invoked critiquing-spec \
     --elapsed-ms "<elapsed_ms>"
   ```
   This appends `recent_runs[]` and sets `resolved_run_request_id` once under the same lock. If it returns rc1, the run was already resolved — do not append a duplicate; switch to inspect-only output.

This skill never dispatches new audits (that is `/critique --async`) and never auto-installs anything.
