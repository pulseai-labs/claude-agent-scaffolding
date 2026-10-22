import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { removeClaim } from "./claims.ts";
import { exitCode, tick } from "./engine.ts";
import { GhForge } from "./forge.ts";
import { HostAuthError, HostDownError } from "./host.ts";
import { callTool, readToken } from "./hosts/mcp.ts";
import { loadT3Config, T3Host } from "./hosts/t3.ts";
import { notifyOnce } from "./notify.ts";
import { RUN_ID_RE, validate, type Recipe } from "./recipe.ts";
import { openStore, type RunState, type UnitState } from "./state.ts";
import { login } from "./hosts/t3-login.ts";
import { installTimer, removeTimer } from "./timer.ts";

const USAGE = [
  "usage: baton validate <recipe.json>",
  "       baton arm <recipe.json> --run <id> [--param k=v]... [--no-timer]",
  "       baton status [<run>]",
  "       baton disarm <run>",
  "       baton unpark <run> [<unit>] [--to <stage>]",
  "       baton report <run>",
  "       baton tick [--run <id>]",
  "       baton t3 call <tool> <json-object>",
  "       baton t3 token-status",
  "       baton t3 login",
  "       baton timer install|remove",
  "",
].join("\n");

const usage = (): number => {
  process.stderr.write(USAGE);
  return 64;
};
const fail = (msg: string): number => {
  process.stderr.write(msg + "\n");
  return 2;
};

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "validate": return validateCmd(rest);
    case "arm": return armCmd(rest);
    case "status": return statusCmd(rest);
    case "disarm": return disarmCmd(rest);
    case "unpark": return unparkCmd(rest);
    case "report": return reportCmd(rest);
    case "tick": return tickCmd(rest);
    case "t3": return t3Cmd(rest);
    case "timer": return timerCmd(rest);
  }
  return usage();
}

function validateCmd(args: string[]): number {
  if (args.length !== 1) return usage();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(args[0], "utf8"));
  } catch (e) {
    return fail(`${args[0]}: ${(e as Error).message}`);
  }
  const res = validate(raw);
  if (res.ok) return 0;
  return fail(res.errors.join("\n"));
}

/** Run `fn` under the store lock; a busy lock is rc 75 (try again later). */
async function locked(fn: () => Promise<number>): Promise<number> {
  const r = await openStore().withLock(fn);
  if (r === "busy") {
    process.stderr.write("baton: another baton process holds the lock\n");
    return 75;
  }
  return r;
}

function loadRecipe(runDir: string): Recipe {
  return JSON.parse(readFileSync(join(runDir, "recipe.json"), "utf8")) as Recipe;
}

async function armCmd(args: string[]): Promise<number> {
  let file: string | undefined;
  let runId: string | undefined;
  let noTimer = false;
  const given: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--run") runId = args[++i];
    else if (a === "--param") {
      const kv = args[++i];
      const eq = kv === undefined ? -1 : kv.indexOf("=");
      if (eq < 1) return usage();
      given[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a === "--no-timer") noTimer = true;
    else if (a.startsWith("--") || file !== undefined) return usage();
    else file = a;
  }
  if (file === undefined || runId === undefined) return usage();
  if (!RUN_ID_RE.test(runId)) return fail(`run id "${runId}" must match ^[a-z0-9_-]+$`);

  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (e) {
    return fail(`${file}: ${(e as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return fail(`${file}: ${(e as Error).message}`);
  }
  const res = validate(raw);
  if (!res.ok) return fail(res.errors.join("\n"));
  const recipe = res.recipe;

  const declared = new Set(recipe.params);
  const missing = recipe.params.filter((p) => !(p in given));
  const extra = Object.keys(given).filter((p) => !declared.has(p));
  if (missing.length) return fail(`missing param: ${missing.join(", ")}`);
  if (extra.length) return fail(`undeclared param: ${extra.join(", ")}`);

  const rc = await locked(async () => {
    const store = openStore();
    const dir = store.runDir(runId);
    if (existsSync(dir)) return fail(`run "${runId}" already exists`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "recipe.json"), bytes, { mode: 0o600 });
    const now = new Date().toISOString();
    const units: Record<string, UnitState> = {};
    recipe.seed.forEach((s, index) => {
      units[s.id] = {
        id: s.id, group: 0, order: index, vars: s.vars ?? {}, stage: s.stage, launches: {}, stalls: 0,
      };
    });
    const run: RunState = {
      id: runId,
      dir,
      recipe_sha256: createHash("sha256").update(bytes).digest("hex"),
      params: given,
      armed_at: now,
      status: "armed",
      units,
    };
    store.writeRun(run);
    store.event(runId, { kind: "armed", recipe: recipe.name });
    return 0;
  });
  if (rc !== 0) return rc;
  if (!noTimer) {
    try {
      await installTimer(runId);
    } catch (e) {
      return fail(`armed ${runId}, but the timer was not installed: ${(e as Error).message}`);
    }
  }
  return 0;
}

function statusCmd(args: string[]): number {
  if (args.length > 1) return usage();
  const store = openStore();
  const ids = args.length ? [args[0]] : store.listRuns();
  for (const id of ids) {
    let run: RunState;
    try {
      run = store.readRun(id);
    } catch {
      return fail(`no such run: ${id}`);
    }
    for (const u of Object.values(run.units)) {
      const launches = Object.values(u.launches).reduce((a, b) => a + b, 0);
      process.stdout.write(
        `${u.id} ${u.stage} ${launches} ${u.stalls} ${u.parked?.reason ?? "-"} ${u.session?.thread_id ?? "-"}\n`,
      );
    }
  }
  return 0;
}

async function disarmCmd(args: string[]): Promise<number> {
  if (args.length !== 1) return usage();
  const id = args[0];
  return locked(async () => {
    const store = openStore();
    let run: RunState;
    try {
      run = store.readRun(id);
    } catch {
      return fail(`no such run: ${id}`);
    }
    for (const u of Object.values(run.units)) {
      if (!u.session) continue;
      removeClaim(u.session.claim_key, u.session.claim_nonce);
    }
    run.status = "disarmed";
    store.writeRun(run);
    store.event(id, { kind: "disarmed" });
    return 0;
  });
}

async function unparkCmd(args: string[]): Promise<number> {
  let runId: string | undefined;
  let unitId: string | undefined;
  let to: string | undefined;
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--to") to = args[++i];
    else if (args[i].startsWith("--")) return usage();
    else pos.push(args[i]);
  }
  if (pos.length < 1 || pos.length > 2) return usage();
  [runId, unitId] = pos;
  if (to === undefined && args.includes("--to")) return usage();
  if (to !== undefined && unitId === undefined) return usage();

  return locked(async () => {
    const store = openStore();
    let run: RunState;
    try {
      run = store.readRun(runId!);
    } catch {
      return fail(`no such run: ${runId}`);
    }
    if (unitId === undefined) {
      delete run.parked;
      if (run.status === "parked") run.status = "armed";
      store.writeRun(run);
      store.event(runId!, { kind: "unpark" });
      return 0;
    }
    const unit = run.units[unitId];
    if (!unit) return fail(`no such unit: ${unitId}`);
    if (to !== undefined) {
      const recipe = loadRecipe(run.dir);
      if (!Object.prototype.hasOwnProperty.call(recipe.stages, to)) return fail(`no such stage: ${to}`);
    }
    delete unit.parked;
    unit.stalls = 0;
    delete unit.merge_failures;
    unit.launches[unit.stage] = 0;
    if (to !== undefined) unit.stage = to;
    store.writeRun(run);
    store.event(runId!, { kind: "unpark", unit: unitId, stage: unit.stage });
    return 0;
  });
}

function reportCmd(args: string[]): number {
  if (args.length !== 1) return usage();
  const id = args[0];
  const store = openStore();
  const path = join(store.runDir(id), "events.jsonl");
  if (!existsSync(path)) return fail(`no such run: ${id}`);
  const counts: Record<string, number> = { launched: 0, successor: 0, stall: 0, park: 0, unpark: 0, merged: 0 };
  let armed: number | undefined;
  let last: number | undefined;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let ev: { kind?: string; at?: string };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const kind = ev.kind ?? "";
    if (Object.prototype.hasOwnProperty.call(counts, kind)) counts[kind]++;
    const t = ev.at ? Date.parse(ev.at) : NaN;
    if (Number.isNaN(t)) continue;
    if (kind === "armed" && armed === undefined) armed = t;
    if (kind === "merged" || kind === "done") last = t;
  }
  const out = Object.entries(counts).map(([k, v]) => `${k} ${v}`);
  const wall = armed !== undefined && last !== undefined ? String(Math.round((last - armed) / 1000)) : "-";
  out.push(`wall_seconds ${wall}`);
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}

// ---- tick -----------------------------------------------------------------------------
// rc 0 done (a busy lock included), 3 host auth, 4 host down, 1 anything else.

const DAY_MS = 86_400_000;

async function tickCmd(args: string[]): Promise<number> {
  let runId: string | undefined;
  if (args.length === 2 && args[0] === "--run" && RUN_ID_RE.test(args[1])) runId = args[1];
  else if (args.length !== 0) return usage();
  try {
    const cfg = loadT3Config();
    // Only `expires_at` is read from the token here; the token itself stays inside the host.
    let expiresAt: number | undefined;
    try {
      expiresAt = readToken(cfg.tokenFile).expires_at;
    } catch { /* a missing or unreadable token surfaces as a host auth error when used */ }
    if (expiresAt !== undefined && expiresAt * 1000 - Date.now() < 3 * DAY_MS) {
      const day = new Date().toISOString().slice(0, 10);
      await notifyOnce(`token/${day}`, `t3 token expires ${new Date(expiresAt * 1000).toISOString()} — run baton t3 login`);
    }
    const r = await tick({
      store: openStore(), host: new T3Host(cfg), forge: new GhForge(), notify: notifyOnce, now: () => new Date(), runId,
    });
    for (const e of r.errors) process.stderr.write(`baton tick: ${e}\n`);
    return exitCode(r);
  } catch (e) {
    process.stderr.write(`baton tick: ${(e as Error).message}\n`);
    return 1;
  }
}

// ---- t3 -------------------------------------------------------------------------------
// rc 0 ok; 1 the tool returned an error (printed as JSON); 2 bad config or token file;
// 3 token expired or rejected; 4 host unreachable. The token itself is never printed.

async function t3Cmd(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "token-status" && rest.length === 0) return t3TokenStatus();
  if (sub === "call" && rest.length === 2) return t3Call(rest[0], rest[1]);
  if (sub === "login" && rest.length === 0) return t3Login();
  return usage();
}

async function t3Login(): Promise<number> {
  try {
    const cfg = loadT3Config();
    await login({ base: cfg.base, tokenFile: cfg.tokenFile, out: (l) => process.stdout.write(l + "\n") });
    return 0;
  } catch (e) {
    return fail(`baton t3 login: ${(e as Error).message}`);
  }
}

async function timerCmd(args: string[]): Promise<number> {
  if (args.length !== 1 || (args[0] !== "install" && args[0] !== "remove")) return usage();
  try {
    if (args[0] === "install") await installTimer("");
    else await removeTimer();
    return 0;
  } catch (e) {
    return fail(`baton timer: ${(e as Error).message}`);
  }
}

function t3TokenStatus(): number {
  let tokenFile: string;
  try {
    tokenFile = loadT3Config().tokenFile;
  } catch (e) {
    return fail(`baton config: ${(e as Error).message}`);
  }
  let t: ReturnType<typeof readToken>;
  try {
    t = readToken(tokenFile);
  } catch (e) {
    return fail((e as Error).message);
  }
  const days = Math.floor((t.expires_at * 1000 - Date.now()) / 86_400_000);
  process.stdout.write(`scope: ${t.scope ?? "-"}\n`);
  if (t.expires_at * 1000 <= Date.now()) {
    process.stdout.write("expired\n");
    return 3;
  }
  process.stdout.write(`days_left: ${days}\n`);
  return 0;
}

async function t3Call(tool: string, json: string): Promise<number> {
  let callArgs: unknown;
  try {
    callArgs = JSON.parse(json);
  } catch {
    return usage();
  }
  if (callArgs === null || typeof callArgs !== "object" || Array.isArray(callArgs)) return usage();
  try {
    const { base, tokenFile } = loadT3Config();
    const t = readToken(tokenFile);
    if (t.expires_at * 1000 <= Date.now()) {
      process.stderr.write("token expired\n");
      return 3;
    }
    const r = await callTool(base, t.access_token, tool, callArgs as Record<string, unknown>);
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    const isError = r !== null && typeof r === "object" && "error" in r && Object.keys(r).length === 1;
    return isError ? 1 : 0;
  } catch (e) {
    process.stderr.write(`baton t3: ${(e as Error).message}\n`);
    if (e instanceof HostAuthError) return /^token (rejected|expired)$/.test((e as Error).message) ? 3 : 2;
    if (e instanceof HostDownError) return 4;
    return 2;
  }
}
