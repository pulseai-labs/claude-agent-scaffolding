import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readBotConfig } from "./config.ts";
import { agentOf, open } from "./deliveries.ts";
import { serviceState } from "./service.ts";
import { listSpool } from "./spool.ts";

const LIST_TIMEOUT_MS = 30_000;

// Every agent the bridge uses: the default, the per-repo agents, then agents of open records, each
// once. Whether `openbot-cli list` (one call) finds it, by id or by the one agent with that name, case
// ignored, as openbot-cli resolves it; `, open: <keys>` when it has open deliveries. openbot-cli never
// prints the token; nor does this.
function agentLines(): string[] {
  let cfg;
  try {
    cfg = readBotConfig();
  } catch (e) {
    return [`agent: MISSING (${(e as Error).message})`];
  }
  const openKeys = new Map<string, string[]>();
  for (const r of open()) {
    const n = agentOf(r, cfg.agent);
    openKeys.set(n, [...(openKeys.get(n) ?? []), r.key]);
  }
  const names = [...new Set([cfg.agent, ...Object.values(cfg.agents), ...openKeys.keys()])];
  const withOpen = (n: string, s: string): string => `agent: ${n} ${s}` + (openKeys.has(n) ? `, open: ${openKeys.get(n)!.join(", ")}` : "");
  let p: ReturnType<typeof Bun.spawnSync>;
  try {
    p = Bun.spawnSync([...cfg.cli, "list", "--json"], {
      stdout: "pipe", stderr: "ignore", timeout: LIST_TIMEOUT_MS, env: { ...process.env },
    });
  } catch {
    return names.map((n) => withOpen(n, "(openbot-cli could not start)"));
  }
  let agents: unknown;
  try {
    agents = (JSON.parse(p.stdout?.toString() ?? "") as { agents?: unknown }).agents;
  } catch {
    agents = undefined;
  }
  if (p.exitCode !== 0 || !Array.isArray(agents)) {
    return names.map((n) => withOpen(n, `(openbot-cli list failed: exit ${p.exitCode ?? "killed"})`));
  }
  return names.map((n) => {
    const want = n.trim().toLocaleLowerCase();
    const found = agents.filter((a: { id?: unknown; name?: unknown }) =>
      a?.id === n || (typeof a?.name === "string" && a.name.trim().toLocaleLowerCase() === want));
    return withOpen(n, found.length === 1 ? "(openbot-cli list finds it)" : "NOT FOUND by openbot-cli list");
  });
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
    ...agentLines(), `service: ${serviceState()}`, `spool: ${listSpool().length}`, `open deliveries: ${open().length}`,
    batonNotifyLine(), "",
  ].join("\n");
}
