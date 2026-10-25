// Step 7: a parked unit gets one driver session; its result resumes, escalates, or stops the run.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { claimKey, liveClaim } from "../src/claims.ts";
import { main } from "../src/cli.ts";
import { tick, type TickReport } from "../src/engine.ts";
import type { Forge } from "../src/forge.ts";
import { HostDownError, LaunchError, type LaunchRequest, type ThreadStatus } from "../src/host.ts";
import { notifyOnce } from "../src/notify.ts";
import { openStore, type RunState } from "../src/state.ts";
import { FakeHost, type Behaviour } from "./fake-host.ts";

const T0 = Date.parse("2026-10-25T10:00:00.000Z");
const saved = { state: process.env.BATON_STATE_DIR, config: process.env.BATON_CONFIG, home: process.env.HOME };
let root: string, state: string, clock: number, host: FakeHost;

const now = () => new Date(clock);
const at = (min: number) => { clock = T0 + min * 60_000; };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "baton-driver-engine-")));
  state = join(root, "state");
  mkdirSync(join(root, "home"));
  process.env.BATON_STATE_DIR = state;
  process.env.BATON_CONFIG = join(root, "config.json");
  process.env.HOME = join(root, "home");
  clock = T0;
});
afterEach(() => {
  for (const [k, v] of [["BATON_STATE_DIR", saved.state], ["BATON_CONFIG", saved.config], ["HOME", saved.home]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const noForge: Forge = {
  view: async () => { throw new Error("no forge in these tests"); },
  merge: async () => { throw new Error("no forge in these tests"); },
};

const runDir = () => join(state, "runs", "r1");
const runState = (): RunState => openStore(state).readRun("r1");
const events = () =>
  readFileSync(join(runDir(), "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const count = (kind: string) => events().filter((e) => e.kind === kind).length;
const doTick = (): Promise<TickReport> => tick({ store: openStore(state), host, forge: noForge, notify: notifyOnce, now });
/** notify.log lines, each `<iso> <key> <text>`. */
const notices = (): string[] => {
  const p = join(state, "notify.log");
  return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter((l) => l !== "") : [];
};

const stop = (unit = "a") => join(runDir(), "stop", unit);
const result = (unit = "a") => join(runDir(), "out", unit, "driver-result.json");
const stateFile = (unit = "a") => join(runDir(), "driver", unit, "state.md");
const ledger = () => join(root, "ledger.md");
const put = (p: string, text = "x") => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const seatCwd = (unit = "a") => join(root, "w", unit);
const driverCwd = (unit = "a") => join(root, "d", unit);
const driverLaunches = () => host.launches.filter((l) => l.request.nonce.includes("/driver/"));
const seatLaunches = (stage = "work") => host.launches.filter((l) => l.request.nonce.includes(`/${stage}/`));

const LEDGER = { q: "why parked?", a: "stop file", why: "operator asked", rejected: "escalate" };
const resume = (over: Record<string, unknown> = {}) => JSON.stringify({ result: "resume", cleared: "remove-file", ledger: LEDGER, ...over });
const escalateJson = (action: string) => JSON.stringify({ result: "escalate", action, ledger: LEDGER });
const stopJson = (reason: string) => JSON.stringify({ result: "stop", reason, ledger: LEDGER });

function sess(over: Record<string, unknown> = {}) {
  return {
    kind: "session", instance: "inst", model: "mod", project: "proj",
    cwd: "{param.root}/w/{unit.id}", title: "t {unit.id}", message: "go {unit.id}",
    env: { K: "v-{unit.id}" }, handoff: null, stop_file: "{run.dir}/stop/{unit.id}",
    outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "done" }],
    ...over,
  };
}

function driverStage(over: Record<string, unknown> = {}) {
  return {
    kind: "driver", instance: "dinst", model: "dmod", project: "proj",
    cwd: "{param.root}/d/{unit.id}", title: "driver {unit.id}",
    message: "settle {unit.id}: {driver.reason} in {driver.stage}",
    env: { DK: "d-{unit.id}" },
    state_file: "{run.dir}/driver/{unit.id}/state.md",
    result_file: "{run.dir}/out/{unit.id}/driver-result.json",
    ledger: "{param.root}/ledger.md",
    clearing: ["remove-file", "rerun-check"],
    resume_to: { work: ["fix"] },
    ...over,
  };
}

function recipe(seeds: string[], driver: Record<string, unknown> | null = driverStage(), extra: Record<string, unknown> = {}) {
  return {
    version: 1, name: "rec", params: ["root"], sources: [],
    seed: seeds.map((id) => ({ id, stage: "work" })),
    stages: { work: sess(), fix: sess({ title: "fix {unit.id}" }) },
    ...(driver ? { driver } : {}),
    ...extra,
  };
}

async function arm(rec: unknown) {
  const file = join(root, "r1.recipe.json");
  writeFileSync(file, JSON.stringify(rec));
  for (const s of (rec as { seed: { id: string }[] }).seed) {
    mkdirSync(seatCwd(s.id), { recursive: true });
    mkdirSync(driverCwd(s.id), { recursive: true });
  }
  expect(await main(["arm", file, "--run", "r1", "--param", `root=${root}`, "--no-timer"])).toBe(0);
}

const SEAT: Behaviour = { ticks: 1000, end: "completed" };
/** A driver that writes `content` as its result file on its first step, then completes. */
const driverWrites = (content: string): Behaviour =>
  ({ ticks: 1, end: "completed", writes: [{ path: join(runDir(), "out", "{unit}", "driver-result.json"), content }] });

/**
 * Arm `units` (default `a`), launch their seats at minute 0, put a stop file for `a`, and tick at
 * minute 1: `a` parks `stop` and its driver launches in that same tick.
 */
async function parked(driver: Behaviour, rec: unknown = recipe(["a"]), units = ["a"]) {
  await arm(rec);
  host = new FakeHost({ work: SEAT, fix: SEAT, driver });
  await doTick();
  expect(seatLaunches().length).toBe(units.length);
  put(stop());
  at(1);
  await doTick();
  expect(runState().units.a.parked?.reason).toBe("stop");
}

/** The driver writes its result (one host step), and the next tick reads it (minute 2). */
async function driverEnds() {
  host.advance();
  at(2);
  await doTick();
}

// ---- launch ------------------------------------------------------------------------------

test("park launches one driver, no notice", async () => {
  await parked({ ticks: 100, end: "completed" });
  expect(driverLaunches().length).toBe(1);
  const l = driverLaunches()[0];
  expect(l.request.nonce).toBe("r1/a/driver/1");
  expect(l.request.title).toBe("driver a [baton r1/a/driver/1]");
  expect(l.request.message).toBe("settle a: stop in work");
  expect(l.request.instance).toBe("dinst");
  expect(l.request.model).toBe("dmod");
  expect(l.request.cwd).toBe(driverCwd());
  expect(l.claim).toEqual({ nonce: "r1/a/driver/1", env: { DK: "d-a" } });
  expect(notices()).toEqual([]);
  expect(readFileSync(stateFile(), "utf8")).toContain("## This park");
  const u = runState().units.a;
  expect(u.driver?.key).toBe("work/stop");
  expect(u.driver?.session.thread_id).toBe("thread-2");
  expect(events().filter((e) => e.kind === "driver")).toEqual([
    expect.objectContaining({ unit: "a", nonce: "r1/a/driver/1", key: "work/stop" }),
  ]);
  // Still running: no second driver, still no notice.
  at(2);
  await doTick();
  expect(driverLaunches().length).toBe(1);
  expect(notices()).toEqual([]);
});

test("no driver section: notices as before", async () => {
  await parked({ ticks: 1, end: "completed" }, recipe(["a"], null));
  expect(driverLaunches().length).toBe(0);
  const n = notices();
  expect(n.length).toBe(1);
  expect(n[0]).toContain(" r1/a/park/");
  expect(n[0].endsWith("baton r1/a parked in work: stop")).toBe(true);
  at(2);
  await doTick();
  expect(driverLaunches().length).toBe(0);
});

// ---- results -------------------------------------------------------------------------------

test("resume in place", async () => {
  await parked(driverWrites(resume()));
  await driverEnds();
  const u = runState().units.a;
  expect(u.parked).toBeUndefined();
  expect(u.stage).toBe("work");
  expect(u.driver).toBeUndefined();
  expect(u.drivers).toEqual(["work/stop"]);
  expect(existsSync(stop())).toBe(false);
  expect(readdirSync(dirname(stop())).some((f) => f.startsWith("a.consumed-"))).toBe(true);
  const lines = readFileSync(ledger(), "utf8").trim().split("\n");
  expect(lines.length).toBe(1);
  expect(lines[0]).toContain("a driver | Q: why parked?");
  expect(liveClaim(claimKey(driverCwd()))).toBeNull();
  expect(host.releases.map((r) => r.dir)).toContain(driverCwd());
  expect(events().filter((e) => e.kind === "driver resume")).toEqual([
    expect.objectContaining({ unit: "a", from: "work", to: "work", cleared: "remove-file" }),
  ]);
  expect(notices()).toEqual([]);
  expect(seatLaunches().length).toBe(1);
  at(3);
  await doTick();
  expect(seatLaunches().length).toBe(2);
});

test("resume to an allowed stage", async () => {
  await parked(driverWrites(resume({ to: "fix" })));
  host.advance();
  at(2);
  expect((await doTick()).transitioned).toEqual(["a"]);
  const u = runState().units.a;
  expect(u.parked).toBeUndefined();
  expect(u.stage).toBe("fix");
  expect(events().filter((e) => e.kind === "driver resume")).toEqual([
    expect.objectContaining({ unit: "a", from: "work", to: "fix" }),
  ]);
  at(3);
  await doTick();
  expect(seatLaunches("fix").length).toBe(1);
});

test("refused resume escalates", async () => {
  await parked(driverWrites(resume({ to: "done" })));
  await driverEnds();
  const u = runState().units.a;
  expect(u.parked?.escalated).toBe(true);
  expect(u.stage).toBe("work");
  expect(u.drivers).toBeUndefined();
  const n = notices();
  expect(n.length).toBe(1);
  expect(n[0]).toContain(` r1/a/park/${u.parked!.at} `);
  expect(n[0].endsWith('baton r1/a parked in work: stop — driver gave no valid result (resume to "done" is not allowed from "work")'))
    .toBe(true);
  expect(existsSync(ledger())).toBe(false);
  expect(events().filter((e) => e.kind === "driver escalate")).toEqual([
    expect.objectContaining({ unit: "a", stage: "work", reason: "stop" }),
  ]);
});

test("escalate sends one action", async () => {
  await parked(driverWrites(escalateJson("walk d47")));
  await driverEnds();
  const u = runState().units.a;
  expect(u.parked?.escalated).toBe(true);
  expect(u.driver).toBeUndefined();
  let n = notices();
  expect(n.length).toBe(1);
  expect(n[0].endsWith("baton r1/a parked in work: stop — walk d47")).toBe(true);
  expect(readFileSync(ledger(), "utf8").trim().split("\n").length).toBe(1);
  for (const m of [3, 4, 5]) {
    at(m);
    await doTick();
  }
  expect(driverLaunches().length).toBe(1);
  n = notices();
  expect(n.length).toBe(1);
});

test("stop parks the run", async () => {
  await parked(driverWrites(stopJson("x")));
  await driverEnds();
  const r = runState();
  expect(r.status).toBe("parked");
  expect(r.parked?.reason).toBe("driver stop: x");
  expect(r.units.a.parked?.escalated).toBe(true);
  const n = notices();
  expect(n.length).toBe(1);
  expect(n[0].endsWith("baton r1 parked: driver stop: x")).toBe(true);
  expect(events().filter((e) => e.kind === "driver stop")).toEqual([expect.objectContaining({ unit: "a", reason: "x" })]);
});

test("second park after resume goes to the operator", async () => {
  await parked(driverWrites(resume()));
  await driverEnds();
  at(3);
  await doTick(); // the seat relaunches
  expect(seatLaunches().length).toBe(2);
  put(stop());
  at(4);
  await doTick();
  const u = runState().units.a;
  expect(u.parked?.reason).toBe("stop");
  expect(u.parked?.escalated).toBe(true);
  expect(driverLaunches().length).toBe(1);
  const n = notices();
  expect(n.length).toBe(1);
  expect(n[0].endsWith("baton r1/a parked in work: stop — parked again after a driver resumed it once")).toBe(true);
});

test("driver over its limit escalates", async () => {
  await parked({ ticks: 10_000, end: "completed" });
  at(10); // nine minutes in: under the 10-minute limit
  await doTick();
  expect(runState().units.a.driver).toBeDefined();
  expect(host.interrupts.filter((i) => i.threadId === "thread-2")).toEqual([]);
  at(12);
  await doTick();
  expect(host.interrupts).toContainEqual({ threadId: "thread-2", reason: "stalled" });
  expect(count("driver dropped")).toBe(1);
  const u = runState().units.a;
  expect(u.driver).toBeUndefined();
  expect(u.parked?.escalated).toBe(true);
  const n = notices();
  expect(n.length).toBe(1);
  expect(n[0].endsWith("— driver gave no valid result (no result file)")).toBe(true);
});

test("driver over a recipe's own limit", async () => {
  await parked({ ticks: 10_000, end: "completed" }, recipe(["a"], driverStage({ stall_minutes: 30 })));
  at(12);
  await doTick();
  expect(runState().units.a.driver).toBeDefined();
  at(32);
  await doTick();
  expect(runState().units.a.parked?.escalated).toBe(true);
});

// ---- launch failures -----------------------------------------------------------------------

test("driver launch refused escalates", async () => {
  await arm(recipe(["a"]));
  host = new FakeHost({ work: SEAT, driver: SEAT });
  await doTick();
  const orig = host.launch.bind(host);
  host.launch = async (r: LaunchRequest) => {
    if (r.nonce.includes("/driver/")) throw new LaunchError("refused");
    return orig(r);
  };
  put(stop());
  at(1);
  await doTick();
  const u = runState().units.a;
  expect(u.driver).toBeUndefined();
  expect(u.parked?.escalated).toBe(true);
  expect(liveClaim(claimKey(driverCwd()))).toBeNull();
  expect(host.releases.map((r) => r.dir)).toContain(driverCwd());
  const n = notices();
  expect(n.length).toBe(1);
  expect(n[0].endsWith("baton r1/a parked in work: stop — driver could not launch: refused")).toBe(true);
  at(2);
  await doTick();
  expect(notices().length).toBe(1);
});

test("driver bind refused escalates", async () => {
  await arm(recipe(["a"]));
  host = new FakeHost({ work: SEAT, driver: SEAT });
  await doTick();
  host.bindDir = (_p, cwd, nonce) => {
    if (nonce.includes("/driver/")) throw new Error("no such project");
    return cwd;
  };
  put(stop());
  at(1);
  await doTick();
  expect(runState().units.a.parked?.escalated).toBe(true);
  expect(notices()[0].endsWith("— driver could not launch: bind: no such project")).toBe(true);
});

test("a driver field that cannot render escalates", async () => {
  await parked(SEAT, recipe(["a"], driverStage({ message: "{unit.vars.missing}" })));
  expect(driverLaunches().length).toBe(0);
  const u = runState().units.a;
  expect(u.parked?.reason).toBe("stop");
  expect(u.parked?.escalated).toBe(true);
  expect(u.seq?.driver).toBeUndefined();
  expect(notices()[0].endsWith('— driver could not launch: unknown unit var "missing"')).toBe(true);
});

test("host down during driver launch marks nothing", async () => {
  await arm(recipe(["a"]));
  host = new FakeHost({ work: SEAT, driver: SEAT });
  await doTick();
  let failed = false;
  host.bindDir = (_p, cwd, nonce) => {
    if (nonce.includes("/driver/") && !failed) {
      failed = true;
      throw new HostDownError("at bind");
    }
    return cwd;
  };
  put(stop());
  at(1);
  expect((await doTick()).host).toBe("down");
  let u = runState().units.a;
  expect(u.parked?.reason).toBe("stop");
  expect(u.parked?.escalated).toBeUndefined();
  expect(u.driver).toBeUndefined();
  expect(u.seq?.driver).toBeUndefined();
  expect(notices()).toEqual([]);
  at(2);
  await doTick();
  u = runState().units.a;
  expect(driverLaunches().map((l) => l.request.nonce)).toEqual(["r1/a/driver/1"]);
  expect(u.driver?.session.thread_id).toBeDefined();
});

test("lost driver launch is adopted", async () => {
  await parked({ ...SEAT, loseResponse: true });
  expect(runState().units.a.driver?.session.thread_id).toBeUndefined();
  at(2);
  await doTick();
  const u = runState().units.a;
  expect(u.driver?.session.thread_id).toBe("thread-2");
  expect(events().filter((e) => e.kind === "adopted")).toEqual([
    expect.objectContaining({ unit: "a", nonce: "r1/a/driver/1", thread: "thread-2" }),
  ]);
  expect(driverLaunches().length).toBe(1);
  expect(u.parked?.escalated).toBeUndefined();
});

test("lost driver launch never found escalates", async () => {
  await parked({ ...SEAT, loseResponse: true });
  host.findByNonce = async () => [];
  at(2);
  await doTick(); // inside the orphan window: still looking
  expect(runState().units.a.parked?.escalated).toBeUndefined();
  at(4);
  await doTick();
  const u = runState().units.a;
  expect(count("orphan")).toBe(1);
  expect(u.driver).toBeUndefined();
  expect(u.parked?.escalated).toBe(true);
  expect(notices()[0].endsWith("— driver gave no valid result (no result file)")).toBe(true);
});

// ---- review focus ---------------------------------------------------------------------------

test("stale result file is not read", async () => {
  await arm(recipe(["a"]));
  host = new FakeHost({ work: SEAT, driver: { ticks: 3, end: "completed", writes: [{ path: result(), content: resume() }] } });
  await doTick();
  put(result(), escalateJson("stale"));
  put(stop());
  at(1);
  await doTick();
  expect(driverLaunches().length).toBe(1);
  expect(existsSync(result())).toBe(false);
  host.finish("thread-2", "completed"); // ended before writing anything
  at(2);
  await doTick();
  const u = runState().units.a;
  expect(u.parked?.escalated).toBe(true);
  expect(notices()[0].endsWith("— driver gave no valid result (no result file)")).toBe(true);
  expect(notices()[0]).not.toContain("stale");
});

test("result after operator unpark is ignored", async () => {
  await parked(driverWrites(resume({ to: "fix" })));
  expect(await main(["unpark", "r1", "a"])).toBe(0);
  expect(runState().units.a.driver).toBeUndefined();
  host.advance(); // the driver writes its result after the unpark
  expect(existsSync(result())).toBe(true);
  at(2);
  await doTick();
  const u = runState().units.a;
  expect(u.stage).toBe("work");
  expect(u.parked).toBeUndefined();
  expect(u.drivers).toBeUndefined();
  expect(existsSync(ledger())).toBe(false);
  expect(count("driver resume")).toBe(0);
  expect(notices()).toEqual([]);
});

test("two parked units get two drivers", async () => {
  await arm(recipe(["a", "b"], driverStage(), { slots: { session: 1 } }));
  host = new FakeHost({ work: SEAT, driver: SEAT });
  await doTick();
  put(stop("a"));
  put(stop("b"));
  at(1);
  await doTick();
  expect(driverLaunches().map((l) => l.request.nonce).sort()).toEqual(["r1/a/driver/1", "r1/b/driver/1"]);
  expect(notices()).toEqual([]);
});

test("no driver while the run is parked", async () => {
  await arm(recipe(["a", "b"]));
  host = new FakeHost({ work: SEAT, driver: driverWrites(stopJson("x")) });
  await doTick();
  put(stop("a"));
  at(1);
  await doTick();
  expect(driverLaunches().length).toBe(1);
  host.advance();
  put(stop("b")); // b parks in the tick a's driver stops the run
  at(2);
  await doTick();
  expect(runState().status).toBe("parked");
  expect(runState().units.b.parked?.reason).toBe("stop");
  for (const m of [3, 4]) {
    at(m);
    await doTick();
  }
  expect(driverLaunches().length).toBe(1);
  expect(runState().units.b.driver).toBeUndefined();
  expect(notices().length).toBe(1);
});

test("guard key with a slash in the reason", async () => {
  await arm(recipe(["a"]));
  host = new FakeHost({ work: SEAT, driver: driverWrites(resume()) });
  const boom = new Set<string>();
  const orig = host.status.bind(host);
  host.status = async (id: string): Promise<ThreadStatus> => {
    if (boom.has(id)) throw new Error("a/b");
    return orig(id);
  };
  await doTick();
  boom.add("thread-1");
  at(1);
  await doTick();
  expect(runState().units.a.parked?.reason).toBe("error: a/b");
  expect(driverLaunches()[0].request.message).toBe("settle a: error: a/b in work");
  await driverEnds();
  expect(runState().units.a.drivers).toEqual(["work/error: a/b"]);
  at(3);
  await doTick();
  expect(seatLaunches().length).toBe(2);
  boom.add("thread-3");
  at(4);
  await doTick();
  const u = runState().units.a;
  expect(u.parked?.reason).toBe("error: a/b");
  expect(u.parked?.escalated).toBe(true);
  expect(driverLaunches().length).toBe(1);
  expect(notices().length).toBe(1);
  expect(notices()[0].endsWith("— parked again after a driver resumed it once")).toBe(true);
});

test("a driver stop keeps the unit with the operator after the run is unparked", async () => {
  await parked(driverWrites(stopJson("x")));
  await driverEnds();
  expect(await main(["unpark", "r1"])).toBe(0);
  for (const m of [3, 4]) {
    at(m);
    await doTick();
  }
  expect(runState().status).toBe("armed");
  expect(driverLaunches().length).toBe(1);
  expect(notices().length).toBe(1);
});

test("a ledger that cannot be written escalates", async () => {
  await parked(driverWrites(resume()));
  mkdirSync(ledger(), { recursive: true }); // a directory where the ledger file goes
  await driverEnds();
  const u = runState().units.a;
  expect(u.parked?.escalated).toBe(true);
  expect(u.drivers).toBeUndefined();
  expect(u.driver).toBeUndefined();
  expect(notices().length).toBe(1);
  expect(notices()[0]).toContain("— driver failed: ");
});

test("a driver nonce that finds two threads escalates and keeps the directory", async () => {
  await parked({ ...SEAT, loseResponse: true });
  host.findByNonce = async (_p: string, nonce: string) => (nonce.includes("/driver/") ? ["thread-2", "thread-9"] : []);
  at(2); // inside the orphan window
  await doTick();
  const u = runState().units.a;
  expect(count("ambiguous nonce")).toBe(1);
  expect(u.driver).toBeUndefined();
  expect(u.parked?.escalated).toBe(true);
  expect(liveClaim(claimKey(driverCwd()))).toBeNull();
  expect(host.releases.map((r) => r.dir)).not.toContain(driverCwd());
  expect(notices()[0].endsWith("— driver could not launch: ambiguous nonce")).toBe(true);
});
