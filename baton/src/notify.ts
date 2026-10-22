// Notifications and the config file. A notice is sent at most once per key: it is appended
// to `notify.log` in the state dir and handed to the config's `notify` argv, if any, with
// `{message}` rendered. The argv runs with no shell; its failure never fails the tick.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stateDir } from "./state.ts";

export type Config = { notify?: string[]; slots?: Record<string, number> };

const NOTIFY_TIMEOUT_MS = 30_000;

export function configPath(): string {
  return process.env.BATON_CONFIG || join(homedir(), ".config", "baton", "config.json");
}

/** The config's `notify` and `slots`; a missing file is `{}`, a malformed one throws. */
export function readConfig(): Config {
  const path = configPath();
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> | null;
  const out: Config = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${path}: must be an object`);
  if (raw.notify !== undefined) {
    const n = raw.notify;
    if (!Array.isArray(n) || n.length === 0 || !n.every((x) => typeof x === "string")) {
      throw new Error(`${path}: notify must be a non-empty argv list`);
    }
    out.notify = n as string[];
  }
  if (raw.slots !== undefined) {
    const s = raw.slots as Record<string, unknown>;
    if (s === null || typeof s !== "object" || Array.isArray(s)) throw new Error(`${path}: slots must be an object`);
    for (const [k, v] of Object.entries(s)) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new Error(`${path}: slots.${k} must be a positive integer`);
    }
    out.slots = s as Record<string, number>;
  }
  return out;
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");

export async function notifyOnce(key: string, message: string): Promise<void> {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sent = join(dir, "notify.sent");
  const k = oneLine(key);
  if (existsSync(sent) && readFileSync(sent, "utf8").split("\n").includes(k)) return;
  const msg = oneLine(message);
  appendFileSync(join(dir, "notify.log"), `${new Date().toISOString()} ${k} ${msg}\n`, { mode: 0o600 });
  appendFileSync(sent, k + "\n", { mode: 0o600 });
  let argv: string[] | undefined;
  try {
    argv = readConfig().notify;
  } catch {
    return;
  }
  if (!argv) return;
  try {
    Bun.spawnSync(argv.map((a) => a.replaceAll("{message}", msg)), {
      stdout: "ignore", stderr: "ignore", timeout: NOTIFY_TIMEOUT_MS,
    });
  } catch {
    // a missing notify command is the operator's to fix; notify.log already has the line
  }
}
