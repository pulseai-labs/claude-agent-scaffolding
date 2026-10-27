import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readBotConfig } from "./config.ts";
import { open } from "./deliveries.ts";
import { serviceState } from "./service.ts";
import { listSpool } from "./spool.ts";

const LIST_TIMEOUT_MS = 30_000;

// The configured agent, and whether `openbot-cli list` finds it (by id, or the one agent with that
// name, case ignored, as openbot-cli resolves it). openbot-cli never prints the token; nor does this.
function agentLine(): string {
  let cfg;
  try {
    cfg = readBotConfig();
  } catch (e) {
    return `agent: MISSING (${(e as Error).message})`;
  }
  let p: ReturnType<typeof Bun.spawnSync>;
  try {
    p = Bun.spawnSync([...cfg.cli, "list", "--json"], {
      stdout: "pipe", stderr: "ignore", timeout: LIST_TIMEOUT_MS, env: { ...process.env },
    });
  } catch {
    return `agent: ${cfg.agent} (openbot-cli could not start)`;
  }
  let agents: unknown;
  try {
    agents = (JSON.parse(p.stdout?.toString() ?? "") as { agents?: unknown }).agents;
  } catch {
    agents = undefined;
  }
  if (p.exitCode !== 0 || !Array.isArray(agents)) return `agent: ${cfg.agent} (openbot-cli list failed: exit ${p.exitCode ?? "killed"})`;
  const want = cfg.agent.trim().toLocaleLowerCase();
  const found = agents.filter((a: { id?: unknown; name?: unknown }) =>
    a?.id === cfg.agent || (typeof a?.name === "string" && a.name.trim().toLocaleLowerCase() === want));
  return found.length === 1 ? `agent: ${cfg.agent} (openbot-cli list finds it)` : `agent: ${cfg.agent} NOT FOUND by openbot-cli list`;
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
  return [
    agentLine(), `service: ${serviceState()}`, `spool: ${listSpool().length}`, `open deliveries: ${open().length}`,
    batonNotifyLine(), "",
  ].join("\n");
}
