// The orchestrator pointer and the notifier that reads it. A baton run has no crew run, so the
// project's orchestrator session registers itself in `<state>/runs/<run>/orchestrator` as
// `{handle, incarnation}` (crew's identity record, layers/orca.md "Identity"). `baton
// notify-orchestrator <key> <message>` is the config's `notify` argv: a run-scoped notice is written
// to a file and the orchestrator's terminal is sent one tagged line that names it. Every failure
// ends in `fallback_notify`, if the config has one; notify.log already holds the line.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadOrcaConfig } from "./orca.ts";
import { runOrca } from "./orca-cli.ts";
import { readConfig, renderNotifyArgv } from "../notify.ts";
import { isProtoName, RUN_ID_RE } from "../recipe.ts";
import { replaceFileSync, stateDir } from "../state.ts";

/** notify.ts's whole bound is 30 s; the notifier keeps inside it. */
const BUDGET_MS = 28_000;
const STATUS_MS = 4_000;
const SEND_MS = 12_000;
const WAIT_SUBMIT_S = "5";

export type Pointer = { handle: string; incarnation: string };

const pointerPath = (run: string) => join(stateDir(), "runs", run, "orchestrator");

/** The host-wide keys (`auth/<day>`, `down/<day>`) name no run. */
const HOST_WIDE_KEY = /^(auth|down)\/\d{4}-\d{2}-\d{2}$/;

/** The run a key names, or undefined for a host-wide key, a key of no run on this host, or a malformed one. */
export function runOfKey(key: string): string | undefined {
  if (HOST_WIDE_KEY.test(key)) return undefined;
  const parts = key.split("/");
  const run = parts[0];
  if (parts.length < 2 || !RUN_ID_RE.test(run) || isProtoName(run)) return undefined;
  return existsSync(join(stateDir(), "runs", run, "run.json")) ? run : undefined;
}

/** A key as one file name: every character outside `A-Za-z0-9._-` becomes `_`. */
export const noticeFileName = (key: string): string => key.replace(/[^A-Za-z0-9._-]/g, "_") + ".md";

export function readPointer(run: string): Pointer | undefined {
  try {
    const p = JSON.parse(readFileSync(pointerPath(run), "utf8"));
    if (p !== null && typeof p === "object" && typeof p.handle === "string" && p.handle !== "" && typeof p.incarnation === "string" && p.incarnation !== "") {
      return { handle: p.handle, incarnation: p.incarnation };
    }
  } catch {
    // missing or malformed: no pointer
  }
  return undefined;
}

export function writePointer(run: string, p: Pointer): void {
  const path = pointerPath(run);
  replaceFileSync(`${path}.${process.pid}.tmp`, path, JSON.stringify(p) + "\n");
}

export function clearPointer(run: string): void {
  rmSync(pointerPath(run), { force: true });
}

function writeNotice(run: string, key: string, message: string): string {
  const dir = join(stateDir(), "runs", run, "notices");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, noticeFileName(key));
  writeFileSync(file, message + "\n", { mode: 0o600 });
  chmodSync(file, 0o600); // an existing file keeps its old mode through writeFileSync
  return file;
}

/** The one line the orchestrator is sent. It names a file and carries no seat-written text. */
export const noticeLine = (key: string, file: string): string =>
  `[crew message baton] baton notice ${key}: read ${file} and follow running-a-spine-on-baton §Notices.`;

/** True when the terminal accepted the line, queued behind a running turn included. */
function sendToOrchestrator(cli: string, p: Pointer, text: string, deadline: number): boolean {
  try {
    // The runtime id is Orca's incarnation: ORCA_RUNTIME_SOURCE_INCARNATION is `orca status`'s
    // runtime.runtimeId. A different one means Orca restarted and the handle is stale. A status
    // that cannot be read decides nothing: the send's own `terminal_handle_stale` does.
    try {
      const st = runOrca(cli, ["status"], Math.min(STATUS_MS, Math.max(1, deadline - Date.now())));
      const id = st.ok ? st.result?.runtime?.runtimeId : undefined;
      if (typeof id === "string" && id !== p.incarnation) return false;
    } catch {
      // Orca unreachable: the send below fails the same way
    }
    const left = deadline - Date.now();
    if (left < 1_000) return false;
    const r = runOrca(cli, ["terminal", "send", "--terminal", p.handle, "--enter", "--wait-submit", WAIT_SUBMIT_S, "--text", text], Math.min(SEND_MS, left));
    return r.ok && r.result?.send?.accepted !== false;
  } catch {
    return false;
  }
}

function runFallback(key: string, message: string, deadline: number): void {
  let argv: string[] | undefined;
  try {
    argv = readConfig().fallback_notify;
  } catch {
    return;
  }
  if (!argv) return;
  try {
    Bun.spawnSync(renderNotifyArgv(argv, key, message), {
      stdout: "ignore", stderr: "ignore", timeout: Math.max(1_000, deadline - Date.now()),
    });
  } catch {
    // a missing fallback command is the operator's to fix; notify.log already has the line
  }
}

/** `baton notify-orchestrator <key> <message>`: always rc 0, since notify.ts ignores the exit code. */
export function notifyOrchestrator(key: string, message: string): number {
  const deadline = Date.now() + BUDGET_MS;
  const run = runOfKey(key);
  let sent = false;
  if (run !== undefined) {
    try {
      const file = writeNotice(run, key, message);
      const p = readPointer(run);
      if (p) sent = sendToOrchestrator(loadOrcaConfig().cli, p, noticeLine(key, file), deadline);
    } catch {
      // an unwritable notice or an unreadable config: the fallback below
    }
  }
  if (!sent) runFallback(key, message, deadline);
  return 0;
}

/** `baton orchestrator <run> [--clear]`: the error text, or undefined when it worked. */
export function setOrchestrator(run: string, clear: boolean): string | undefined {
  if (clear) {
    clearPointer(run);
    return undefined;
  }
  const handle = process.env.ORCA_TERMINAL_HANDLE;
  const incarnation = process.env.ORCA_RUNTIME_SOURCE_INCARNATION;
  if (!handle || !incarnation) {
    return "baton orchestrator: ORCA_TERMINAL_HANDLE and ORCA_RUNTIME_SOURCE_INCARNATION must both be set: run it from the orchestrator's own Orca terminal";
  }
  writePointer(run, { handle, incarnation });
  return undefined;
}
