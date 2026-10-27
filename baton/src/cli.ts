import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { removeClaim } from "./claims.ts";
import { exitCode, tick, unparkUnit } from "./engine.ts";
import { GhForge } from "./forge.ts";
import { AnswerRefused, HostAuthError, HostDownError, type Host } from "./host.ts";
import { hostKind, makeHost } from "./hosts/select.ts";
import { notifyOnce } from "./notify.ts";
import { isProtoName, own, PROTO_NAME_ERROR, RUN_ID_RE, validate, type Recipe } from "./recipe.ts";
import { openStore, replaceFileSync, type KeptThread, type RunState, type UnitState } from "./state.ts";
import { installTimer, removeTimer } from "./timer.ts";

const USAGE = [
  "usage: baton validate <recipe.json>",
  "       baton arm <recipe.json> --run <id> [--param k=v]... [--no-timer]",
  "       baton status [<run>]",
  "       baton disarm <run>",
  "       baton unpark <run> [<unit>] [--to <stage>]",
  "       baton answer <run> <unit> <label>",
  "       baton report <run>",
  "       baton tick [--run <id>]",
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
    case "answer": return answerCmd(rest);
    case "report": return reportCmd(rest);
    case "tick": return tickCmd(rest);
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
  // Null prototype, own-property reads: a param named constructor or __proto__ is a param like any other.
  const given: Record<string, string> = Object.create(null);
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
  if (isProtoName(runId)) return fail(`run id "${runId}" ${PROTO_NAME_ERROR}`);
  // A host key the tick would refuse fails here, before a run exists for the timer to tick.
  try {
    hostKind();
  } catch (e) {
    return fail((e as Error).message);
  }

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
  const missing = recipe.params.filter((p) => !Object.prototype.hasOwnProperty.call(given, p));
  const extra = Object.keys(given).filter((p) => !declared.has(p));
  if (missing.length) return fail(`missing param: ${missing.join(", ")}`);
  if (extra.length) return fail(`undeclared param: ${extra.join(", ")}`);

  const rc = await locked(async () => {
    const store = openStore();
    const dir = store.runDir(runId);
    if (existsSync(dir)) return fail(`run "${runId}" already exists`);
    // All or nothing: a failed write leaves no run directory behind to block a retry.
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      replaceFileSync(join(dir, `recipe.json.${process.pid}.tmp`), join(dir, "recipe.json"), bytes);
      const now = new Date().toISOString();
      const units: Record<string, UnitState> = {};
      recipe.seed.forEach((s, index) => {
        units[s.id] = {
          id: s.id, group: 0, order: index, vars: Object.assign(Object.create(null), s.vars), stage: s.stage, launches: {}, stalls: 0,
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
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      return fail(`arm ${runId} failed: ${(e as Error).message.split("\n")[0]}`);
    }
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
      if (u.triage) removeClaim(u.triage.session.claim_key, u.triage.session.claim_nonce);
      if (u.driver) removeClaim(u.driver.session.claim_key, u.driver.session.claim_nonce);
      if (!u.session) continue;
      removeClaim(u.session.claim_key, u.session.claim_nonce);
    }
    await closeKept(run);
    run.status = "disarmed";
    store.writeRun(run);
    store.event(id, { kind: "disarmed" });
    return 0;
  });
}

/**
 * Close every kept thread of the run, and a blocked park's worker thread, then release its
 * directory. A failure is printed and the disarm goes on; an entry that could not be closed stays
 * in `u.kept` (a blocked park's in `u.session`), its directory unreleased.
 */
async function closeKept(run: RunState): Promise<void> {
  let host: Host | undefined;
  let hostErr = "";
  try {
    host = makeHost();
  } catch (e) {
    hostErr = (e as Error).message;
  }
  /** Close, then release; false when the close failed (the directory is then not released). */
  const closeThenRelease = async (k: { thread: string; project: string; cwd: string; dir: string }): Promise<boolean> => {
    try {
      if (!host) throw new Error(hostErr);
      if (!host.close) throw new Error("host cannot close");
      await host.close(k.thread);
    } catch (e) {
      process.stderr.write(`baton disarm: could not close ${k.thread}: ${(e as Error).message}\n`);
      return false;
    }
    try {
      await host.release(k.project, k.cwd, k.dir);
    } catch (e) {
      process.stderr.write(`baton disarm: could not release ${k.dir}: ${(e as Error).message}\n`);
    }
    return true;
  };
  for (const u of Object.values(run.units)) {
    const left: KeptThread[] = [];
    for (const k of u.kept ?? []) if (!(await closeThenRelease(k))) left.push(k);
    if (left.length) u.kept = left;
    else delete u.kept;
    // A blocked park's worker is still open; on a host with `close` it goes as a kept thread does.
    // Its session has project and cwd: blocked parks are newer than sessions without them.
    const s = u.session;
    if (u.parked?.blocked && s?.thread_id && (!host || host.close)) {
      if (await closeThenRelease({ thread: s.thread_id, project: s.project!, cwd: s.cwd!, dir: s.launch_dir })) delete u.session;
    }
  }
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
  if (unitId !== undefined && isProtoName(unitId)) return fail(`unit "${unitId}" ${PROTO_NAME_ERROR}`);
  if (to !== undefined && isProtoName(to)) return fail(`stage "${to}" ${PROTO_NAME_ERROR}`);

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
    const unit = own(run.units, unitId);
    if (!unit) return fail(`no such unit: ${unitId}`);
    // A park always ends the session first. A unit that is not parked and has a session is
    // running: moving or resetting it here would leave that session bound to state it was not
    // launched in. A parked unit is never refused, whatever its record holds.
    if (unit.session && !unit.parked) return fail(`unit ${unitId} is running (live session) and not parked; nothing to unpark`);
    let recipe: Recipe | undefined;
    if (to !== undefined) {
      recipe = loadRecipe(run.dir);
      if (!Object.prototype.hasOwnProperty.call(recipe.stages, to)) return fail(`no such stage: ${to}`);
    } else {
      try {
        recipe = loadRecipe(run.dir); // best-effort: in-place unpark needs it only to consume a stop file
      } catch {
        recipe = undefined;
      }
    }
    if (unit.parked?.blocked) {
      // A blocked park keeps its session. In place, the park goes and the counts stand (the live
      // launch still counts); a worker still waiting parks again next tick. `--to` is left to the
      // tick, which ends the session before the move.
      if (to === undefined) {
        delete unit.parked;
        store.writeRun(run);
        store.event(runId!, { kind: "unpark", unit: unitId, stage: unit.stage });
      } else {
        unit.parked.blocked.to = to;
        store.writeRun(run);
        store.event(runId!, { kind: "unpark requested", unit: unitId, stage: to });
      }
      return 0;
    }
    const { stage, consumed } = unparkUnit(run, recipe, unit, to, new Date().toISOString());
    store.writeRun(run);
    store.event(runId!, { kind: "unpark", unit: unitId, stage, ...(consumed !== undefined ? { consumed } : {}) });
    return 0;
  });
}

// ---- answer ---------------------------------------------------------------------------
// The one answer path for a worker's pending question. rc 0 sent, 2 refused, 3 host auth, 4 host down.
// It answers one question with one option, by the option's exact label (byte for byte); anything
// else is left to whoever can read the screen.

async function answerCmd(args: string[]): Promise<number> {
  if (args.length !== 3) return usage();
  const [runId, unitId, label] = args;
  return locked(async () => {
    const store = openStore();
    let run: RunState;
    try {
      run = store.readRun(runId);
    } catch {
      return fail(`no such run: ${runId}`);
    }
    const unit = own(run.units, unitId);
    if (!unit) return fail(`no such unit: ${unitId}`);
    const thread = unit.session?.thread_id;
    if (!thread) return fail("no live session");
    try {
      const host = makeHost();
      if (!host.respond) return fail("host cannot answer");
      const pending = (await host.status(thread)).pending;
      if (!pending || pending.questions.length === 0) return fail("no pending request");
      if (pending.questions.length > 1) return fail("several questions");
      const q = pending.questions[0];
      if (q.multiSelect === true) return fail("multi-select");
      if (!q.options.some((o) => o.label === label)) return fail(`no option labelled "${label}"`);
      await host.respond(thread, pending.id, { [q.id]: label });
      store.event(runId, { kind: "answered", unit: unitId, request: pending.id, label });
      return 0;
    } catch (e) {
      process.stderr.write(`baton answer: ${(e as Error).message}\n`);
      if (e instanceof AnswerRefused) return 2;
      if (e instanceof HostAuthError) return 3;
      if (e instanceof HostDownError) return 4;
      return 2;
    }
  });
}

function reportCmd(args: string[]): number {
  if (args.length !== 1) return usage();
  const id = args[0];
  const store = openStore();
  const path = join(store.runDir(id), "events.jsonl");
  if (!existsSync(path)) return fail(`no such run: ${id}`);
  const counts: Record<string, number> = {
    launched: 0, successor: 0, stall: 0, park: 0, unpark: 0, merged: 0,
    triage: 0, "triage answered": 0, "triage relaunch": 0,
  };
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

async function tickCmd(args: string[]): Promise<number> {
  let runId: string | undefined;
  if (args.length === 2 && args[0] === "--run" && RUN_ID_RE.test(args[1]) && !isProtoName(args[1])) runId = args[1];
  else if (args.length !== 0) return usage();
  try {
    const host = makeHost();
    const r = await tick({
      store: openStore(), host, forge: new GhForge(), notify: notifyOnce, now: () => new Date(), runId,
    });
    for (const e of r.errors) process.stderr.write(`baton tick: ${e}\n`);
    return exitCode(r);
  } catch (e) {
    process.stderr.write(`baton tick: ${(e as Error).message}\n`);
    return 1;
  }
}

// ---- timer ----------------------------------------------------------------------------

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

