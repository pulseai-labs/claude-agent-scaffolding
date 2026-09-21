#!/usr/bin/env node
// Fake codex-companion for architect-critic tests (#39). Emits env-driven
// canned JSON matching the real codex-plugin-cc `setup|task|status|result|cancel
// --json` output shapes. NO real Codex, NO network, NO node-codex. Argv recorded
// to $CODEX_SHIM_LOG (one space-joined line per call) so tests can assert which
// flags the helpers passed (--background / --prompt-file / cancel …).
//
// Env contract (all optional — defaults are the happy path):
//   CODEX_SHIM_LOG               append argv here, one line per invocation
//   CODEX_SHIM_JOBID             job id echoed by `task` + reported by status/result
//   CODEX_SHIM_SETUP             raw JSON string for `setup --json` (overrides default)
//   CODEX_SHIM_STATUS            .job.status for `status --json` (default "completed")
//   CODEX_SHIM_STATUS_RAW        emit this raw (possibly non-JSON) string for `status` verbatim
//   CODEX_SHIM_CANCEL_STATUS     .job.status for `cancel --json` (default "cancelled")
//   CODEX_SHIM_CANCEL_RAW        emit this raw (possibly non-JSON) string for `cancel` verbatim
//   CODEX_SHIM_LOGFILE           .job.logFile for `status --json` (stall heuristic target)
//   CODEX_SHIM_RESULT_RAWOUTPUT  .storedJob.result.rawOutput for `result --json`
//   CODEX_SHIM_FAIL              subcommand name that should exit non-zero (e.g. task / status)
//   CODEX_SHIM_NO_JOBID          when set, `task` emits a launch payload with NO jobId
import fs from "node:fs";

const argv = process.argv.slice(2);
const sub = argv[0] || "";
if (process.env.CODEX_SHIM_LOG) {
  fs.appendFileSync(process.env.CODEX_SHIM_LOG, argv.join(" ") + "\n");
}
if (process.env.CODEX_SHIM_FAIL && process.env.CODEX_SHIM_FAIL === sub) {
  process.stderr.write(`codex-shim: forced failure on ${sub}\n`);
  process.exit(1);
}
const out = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
const jobId = process.env.CODEX_SHIM_JOBID || "task-shim001";

switch (sub) {
  case "setup": {
    if (process.env.CODEX_SHIM_SETUP !== undefined) {
      process.stdout.write(process.env.CODEX_SHIM_SETUP + "\n");
      break;
    }
    out({ ready: true, node: { available: true }, codex: { available: true }, auth: { loggedIn: true }, nextSteps: [] });
    break;
  }
  case "task": {
    if (process.env.CODEX_SHIM_NO_JOBID) {
      out({ title: "shim task" });
      break;
    }
    out({ jobId, title: "shim task" });
    break;
  }
  case "status": {
    if (process.env.CODEX_SHIM_STATUS_RAW !== undefined) {
      process.stdout.write(process.env.CODEX_SHIM_STATUS_RAW + "\n");
      break;
    }
    out({
      job: {
        id: jobId,
        status: process.env.CODEX_SHIM_STATUS || "completed",
        logFile: process.env.CODEX_SHIM_LOGFILE || ""
      }
    });
    break;
  }
  case "result": {
    // #39: the default return is ADVERSARY-shaped ({challenges, gaps}), the
    // exact shape _ac_codex_validate_json accepts and Step 7 consolidates.
    const raw =
      process.env.CODEX_SHIM_RESULT_RAWOUTPUT ??
      'Adversarial audit complete.\n\n```json\n{"challenges":[{"text":"Codex challenge A","severity":"premise","rationale":"why it matters"}],"gaps":[]}\n```\n';
    out({ job: { id: jobId, status: "completed" }, storedJob: { result: { rawOutput: raw } } });
    break;
  }
  case "cancel": {
    if (process.env.CODEX_SHIM_CANCEL_RAW !== undefined) {
      process.stdout.write(process.env.CODEX_SHIM_CANCEL_RAW + "\n");
      break;
    }
    out({ job: { id: jobId, status: process.env.CODEX_SHIM_CANCEL_STATUS || "cancelled" }, cancelledAt: "2026-01-01T00:00:00Z" });
    break;
  }
  default: {
    process.stderr.write(`codex-shim: unknown subcommand: ${sub}\n`);
    process.exit(2);
  }
}
