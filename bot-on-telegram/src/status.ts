import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readBotConfig } from "./config.ts";
import { configDir } from "./paths.ts";
import { serviceState } from "./service.ts";
import { listSpool } from "./spool.ts";

function tokenLine(): string {
  try {
    const mode = statSync(join(configDir(), "token")).mode & 0o777;
    return mode === 0o600 ? "token: present, mode 600" : `token: present, mode ${mode.toString(8)} (must be 600)`;
  } catch {
    return "token: MISSING";
  }
}

function chatLine(): string {
  try {
    return `chat_id: ${readBotConfig().chat_id}`;
  } catch {
    return "chat_id: MISSING";
  }
}

// What baton would run for a notice: argv[0] of its `notify`, found as a path or on PATH.
function batonNotifyLine(): string {
  const file = process.env.BATON_CONFIG || join(homedir(), ".config", "baton", "config.json");
  let argv0: unknown;
  try {
    argv0 = (JSON.parse(readFileSync(file, "utf8")) as { notify?: unknown[] }).notify?.[0];
  } catch {
    return "baton notify: unset";
  }
  if (typeof argv0 !== "string" || argv0 === "") return "baton notify: unset";
  const found = argv0.includes("/") ? existsSync(argv0) : Bun.which(argv0) !== null;
  return `baton notify: ${argv0} ${found ? "resolves" : "MISSING"}`;
}

export function statusText(): string {
  return [tokenLine(), chatLine(), `service: ${serviceState()}`, `spool: ${listSpool().length}`, batonNotifyLine(), ""].join("\n");
}
