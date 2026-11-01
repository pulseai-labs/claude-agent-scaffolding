// The blocked park (design §4.5): a worker in `waiting` with no request the host can read parks
// at once. The park keeps its session, claim and directory, interrupts nothing, counts no stall,
// and sends one notice with the screen's last lines, driver or not.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { liveClaim } from "../src/claims.ts";
import { main } from "../src/cli.ts";
import { tick, type TickReport } from "../src/engine.ts";
import type { Forge } from "../src/forge.ts";
import { HostDownError } from "../src/host.ts";
import { setHostForTest } from "../src/hosts/select.ts";
import { openStore, type RunState } from "../src/state.ts";
import { screenOf } from "./blocked-setup.ts";
import { FakeHost } from "./fake-host.ts";

const T0 = Date.parse("2026-10-26T10:00:00.000Z");
const saved = { state: process.env.BATON_STATE_DIR, config: process.env.BATON_CONFIG, home: process.env.HOME };
let root: string, state: string, clock: number, host: FakeHost;
let notices: { key: string; text: string }[];

const now = () => new Date(clock);
const at = (min: number) => { clock = T0 + min * 60_000; };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "baton-blocked-")));
  state = join(root, "state");
  mkdirSync(join(root, "home"));
  process.env.BATON_STATE_DIR = state;
  process.env.BATON_CONFIG = join(root, "config.json");
  process.env.HOME = join(root, "home");
  clock = T0;
  notices = [];
});
afterEach(() => {
  setHostForTest(null);
  for (const [k, v] of [["BATON_STATE_DIR", saved.state], ["BATON_CONFIG", saved.config], ["HOME", saved.home]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const noForge: Forge = {
  view: async () => { throw new Error("no forge in these tests"); },
  merge: async () => { throw new Error("no forge in these tests"); },
};

const runDir = () => join(state, "runs", "r");
const runState = (): RunState => openStore(state).readRun("r");
const unit = () => runState().units.u1;
const events = () => readFileSync(join(runDir(), "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const count = (kind: string) => events().filter((e) => e.kind === kind).length;
const doTick = (): Promise<TickReport> => tick({
  store: openStore(state), host, forge: noForge, now,
  notify: (key, text) => { notices.push({ key, text }); },
});
const put = (p: string, text = "x") => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const stopFile = () => join(runDir(), "stop", "u1");

function sess(over: Record<string, unknown> = {}) {
  return {
    kind: "session", instance: "inst", model: "mod", project: "proj",
    cwd: "{param.root}/w/{unit.id}", title: "t {unit.id}", message: "go {unit.id}",
    env: { K: "v-{unit.id}" }, handoff: null, stop_file: "{run.dir}/stop/{unit.id}",
    outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "done" }],
    ...over,
  };
}

const DRIVER_STAGE = {
  kind: "driver", instance: "dinst", model: "dmod", project: "proj",
  cwd: "{param.root}/d/{unit.id}", title: "driver {unit.id}",
  message: "settle {unit.id}: {driver.reason} in {driver.stage}",
  env: { DK: "d-{unit.id}" },
  state_file: "{run.dir}/driver/{unit.id}/state.md",
  result_file: "{run.dir}/out/{unit.id}/driver-result-{driver.launch}.json",
  ledger: "{param.root}/ledger.md",
  clearing: ["remove-file"],
  resume_to: { work: ["implement"] },
};

function recipe(extra: Record<string, unknown> = {}) {
  return {
    version: 1, name: "rec", params: ["root"], sources: [], seed: [{ id: "u1", stage: "work" }],
    stages: { work: sess(), implement: sess({ title: "impl {unit.id}" }) },
    ...extra,
  };
}

async function arm(rec: unknown) {
  const file = join(root, "r.recipe.json");
  writeFileSync(file, JSON.stringify(rec));
  mkdirSync(join(root, "w", "u1"), { recursive: true });
  mkdirSync(join(root, "d", "u1"), { recursive: true });
  expect(await main(["arm", file, "--run", "r", "--param", `root=${root}`, "--no-timer"])).toBe(0);
}

const SEAT = { ticks: 1000, end: "completed" as const };

/** Each launch in its own directory, so a release is visible by the directory it names. */
function ownDirs(h: FakeHost): void {
  h.bindDir = (_p, _cwd, nonce) => {
    const d = join(root, "launch", nonce.replaceAll("/", "_"));
    mkdirSync(d, { recursive: true });
    return d;
  };
}

/** Arm, launch thread-1 at minute 0, block it, and tick at minute 1: the blocked park. */
async function blockedAt1(o: { rec?: unknown; withOptional?: boolean; screen?: string } = {}): Promise<void> {
  await arm(o.rec ?? recipe());
  host = new FakeHost({ work: SEAT, implement: SEAT, driver: SEAT }, { withOptional: o.withOptional ?? true });
  ownDirs(host);
  await doTick();
  expect(host.launches.length).toBe(1);
  host.block("thread-1");
  host.screens["thread-1"] = o.screen ?? "line a\n\n   \n  line b  \n";
  at(1);
  await doTick();
}

test("waiting parks blocked at once", async () => {
  await blockedAt1();
  const u = unit();
  expect(u.parked?.reason).toBe("blocked");
  expect(u.parked?.blocked).toEqual({ thread: "thread-1" });
  expect(u.session?.thread_id).toBe("thread-1");
  expect(liveClaim(u.session!.claim_key)).toBe(u.session!.claim_nonce); // the claim stays
  expect(host.interrupts).toEqual([]);
  expect(host.closes).toEqual([]);
  expect(host.releases).toEqual([]);
  expect(u.stalls).toBe(0);
  expect(notices.length).toBe(1);
  expect(notices[0].key).toMatch(/^r\/u1\/park\//);
  expect(notices[0].key).toBe(`r/u1/park/${u.parked!.at}`);
  expect(notices[0].text).toBe(
    "baton r/u1 blocked in work (project proj): the worker waits on a question — answer it in the worker's terminal — screen: line a | line b",
  );
  expect(events().filter((e) => e.kind === "park")).toMatchObject([{ unit: "u1", reason: "blocked", thread: "thread-1" }]);
  // Long past the stall time: a blocked park counts no stall and sends nothing more.
  at(200);
  await doTick();
  expect(unit().stalls).toBe(0);
  expect(unit().parked?.reason).toBe("blocked");
  expect(host.interrupts).toEqual([]);
  expect(notices.length).toBe(1);
});

// The live recipe's triage stage (baton 0.13.0 and earlier), whose message uses {pending.*}: kept as
// the legacy input a run armed before 0.14.0 still carries. It is never launched.
const LEGACY_TRIAGE_STAGE = {
  kind: "triage", role: "triage", project: "proj", cwd: "{param.root}/w/{unit.id}", launch_dir: "worktree",
  title: "triage {unit.id}",
  message: "Stuck thread: {pending.thread}. Stage: {pending.stage}. Request: {pending.request}. Questions: {pending.questions}.",
  env: { TK: "t-{unit.id}" }, stall_minutes: 10, note_file: "{run.dir}/out/{unit.id}/triage-note.md",
};

test("a legacy triage stage in the recipe changes nothing: the waiting seat parks blocked, no triage launches", async () => {
  await blockedAt1({ rec: recipe({ triage: LEGACY_TRIAGE_STAGE }) });
  const u = unit();
  expect(u.parked?.reason).toBe("blocked");
  expect(host.launches.map((l) => l.request.nonce)).toEqual(["r/u1/work/1"]);
  expect(count("triage")).toBe(0);
  expect(count("pending")).toBe(0);
  expect(notices.length).toBe(1);
});

test("worker moves on: the park clears by itself", async () => {
  await blockedAt1();
  const launches = host.launches.length;
  host.unblock("thread-1");
  at(2);
  await doTick();
  const u = unit();
  expect(u.parked).toBeUndefined();
  expect(count("unblocked")).toBe(1);
  expect(host.launches.length).toBe(launches);
  expect(u.session?.thread_id).toBe("thread-1");
  expect(u.session?.last_progress_at).toBe(new Date(T0 + 2 * 60_000).toISOString());
  expect(host.interrupts).toEqual([]);
});

test("a second blocked park in the same visit is allowed", async () => {
  await blockedAt1();
  host.unblock("thread-1");
  at(2);
  await doTick();
  expect(unit().parked).toBeUndefined();
  host.block("thread-1");
  at(3);
  await doTick();
  const u = unit();
  expect(u.parked?.reason).toBe("blocked");
  expect(notices.length).toBe(2);
  expect(notices[0].key).not.toBe(notices[1].key);
  expect(notices.every((n) => /^r\/u1\/park\//.test(n.key))).toBe(true);
  expect(u.stalls).toBe(0);
  expect(host.launches.length).toBe(1);
});

test("stop file during a blocked park", async () => {
  await blockedAt1();
  put(stopFile());
  at(2);
  await doTick();
  const u = unit();
  expect(u.parked?.reason).toBe("stop");
  expect(u.parked?.blocked).toBeUndefined();
  expect(host.interrupts).toEqual([{ threadId: "thread-1", reason: "stop" }]);
  expect(host.closes).toEqual([]);
  expect(u.kept?.map((k) => [k.thread, k.until])).toEqual([["thread-1", "unpark"]]);
  // the stop park names its file (#1018); the earlier blocked park, which was no stop, did not
  const parks = events().filter((e) => e.kind === "park");
  expect(parks.map((e) => [e.reason, e.stop_file])).toEqual([["blocked", undefined], ["stop", stopFile()]]);
});

test("stop file wins over a requested unpark --to", async () => {
  await blockedAt1();
  expect(await main(["unpark", "r", "u1", "--to", "implement"])).toBe(0);
  put(stopFile());
  at(2);
  await doTick();
  const u = unit();
  expect(u.parked?.reason).toBe("stop");
  expect(u.stage).toBe("work");
  expect(host.closes).toEqual([]);
  expect(host.launches.length).toBe(1);
});

test("unpark --to moves a blocked unit", async () => {
  await blockedAt1();
  const old = unit().session!;
  expect(await main(["unpark", "r", "u1", "--to", "implement"])).toBe(0);
  let u = unit();
  expect(u.parked?.blocked).toEqual({ thread: "thread-1", to: "implement" });
  expect(u.session?.thread_id).toBe("thread-1"); // the move waits for the tick
  expect(count("unpark requested")).toBe(1);
  at(2);
  await doTick();
  u = unit();
  expect(host.interrupts).toEqual([{ threadId: "thread-1", reason: "stop" }]);
  expect(host.closes).toEqual(["thread-1"]);
  expect(liveClaim(old.claim_key)).not.toBe(old.claim_nonce);
  expect(host.releases.map((r) => r.dir)).toEqual([old.launch_dir]);
  expect(u.stage).toBe("implement");
  expect(u.parked).toBeUndefined();
  expect(events().filter((e) => e.kind === "unpark").at(-1)).toMatchObject({ unit: "u1", stage: "implement" });
  expect(host.launches.map((l) => l.request.nonce)).toEqual(["r/u1/work/1", "r/u1/implement/1"]);
  expect(u.session?.thread_id).toBe("thread-2");
});

test("unpark in place keeps the session; a worker still waiting parks again", async () => {
  await blockedAt1();
  expect(await main(["unpark", "r", "u1"])).toBe(0);
  let u = unit();
  expect(u.parked).toBeUndefined();
  expect(u.session?.thread_id).toBe("thread-1");
  expect(u.launches.work).toBe(1); // the live launch still counts
  at(2);
  await doTick();
  u = unit();
  expect(u.parked?.reason).toBe("blocked");
  expect(notices.length).toBe(2);
  expect(notices[0].key).not.toBe(notices[1].key);
  expect(host.launches.length).toBe(1);
  expect(host.interrupts).toEqual([]);
});

test("driver does not take a blocked park", async () => {
  await blockedAt1({ rec: recipe({ driver: DRIVER_STAGE }) });
  at(2);
  await doTick();
  const u = unit();
  expect(u.parked?.reason).toBe("blocked");
  expect(u.driver).toBeUndefined();
  expect(host.launches.filter((l) => l.request.nonce.includes("/driver/"))).toEqual([]);
  // The question is the operator's: the notice goes out with a driver in the recipe too.
  expect(notices.length).toBe(1);
  expect(notices[0].text).toContain("blocked in work");
});

test("screen tail is capped", async () => {
  // Ten 299-character lines plus newlines: a 3000-character screen.
  const lines = Array.from({ length: 10 }, (_, i) => `${String(i).padStart(2, "0")}${"x".repeat(297)}`);
  const screen = lines.map((l) => l + "\n").join("");
  expect(screen.length).toBe(3000);
  await blockedAt1({ screen });
  const tail = notices[0].text.split(" — screen: ")[1];
  expect(tail.length).toBeLessThanOrEqual(1500);
  expect(tail.length).toBeGreaterThan(1400);
  expect(tail.endsWith(lines[9])).toBe(true);
});

test("screen tail keeps the last 12 non-empty lines", async () => {
  const lines = Array.from({ length: 15 }, (_, i) => `l${i}`);
  await blockedAt1({ screen: lines.join("\n\n") });
  expect(notices[0].text.split(" — screen: ")[1]).toBe(lines.slice(3).join(" | "));
});

test("screen tail keeps an omp ask picker's question when it scrolled out of the last 12 lines (#930)", async () => {
  const screen = screenOf("terminal-read-omp-ask.json");
  await blockedAt1({ screen });
  const tail = notices[0].text.split(" — screen: ")[1];
  const last12 = screen.split("\n").map((l) => l.trim()).filter((l) => l !== "").slice(-12).join(" | ");
  expect(last12).not.toContain("spike: which colour?"); // the recorded screen's question is out of the plain tail
  expect(tail).toBe(`spike: which colour? | … | ${last12}`);
});

test("control: a picker question already in the tail is not added again", async () => {
  // The live box alone, without the three status lines below it: twelve lines, the question in them.
  const lines = screenOf("terminal-read-omp-ask.json").split("\n");
  const box = lines.slice(lines.findLastIndex((l) => l.startsWith("╭─ Ask")), -3).join("\n");
  await blockedAt1({ screen: box });
  const tail = notices[0].text.split(" — screen: ")[1];
  expect(tail.split("spike: which colour?").length).toBe(2);
  expect(tail.startsWith("╭─ Ask")).toBe(true);
});

test("a host with no screen method keeps the 0.4.0 path: no park, the stall clock runs", async () => {
  await blockedAt1({ withOptional: false });
  expect("screen" in host).toBe(false);
  expect(unit().parked).toBeUndefined();
  expect(notices).toEqual([]);
  at(45);
  await doTick(); // 44 minutes idle since the first status read at minute 1
  expect(unit().stalls).toBe(0);
  expect(host.interrupts).toEqual([]);
  at(46);
  await doTick(); // stall_minutes (45) reached
  const u = unit();
  expect(host.interrupts).toEqual([{ threadId: "thread-1", reason: "stalled" }]);
  expect(u.stalls).toBe(1);
  expect(u.parked).toBeUndefined();
  expect(notices).toEqual([]);
});

for (const [name, screen] of [["empty", ""], ["blank-only", "\n   \n\t\n"]] as const) {
  test(`an ${name} screen reads unavailable`, async () => {
    await blockedAt1({ screen });
    expect(unit().parked?.reason).toBe("blocked");
    expect(notices.map((n) => n.text.split(" — screen: ")[1])).toEqual(["unavailable"]);
  });
}

test("a screen read that fails with a non-host error reads unavailable", async () => {
  await arm(recipe());
  host = new FakeHost({ work: SEAT }, { withOptional: true });
  host.screen = async () => { throw new Error("no such terminal"); };
  await doTick();
  host.block("thread-1");
  at(1);
  await doTick();
  expect(unit().parked?.reason).toBe("blocked");
  expect(notices.map((n) => n.text.split(" — screen: ")[1])).toEqual(["unavailable"]);
});

test("a host error at the screen read marks nothing: the next tick parks and notifies", async () => {
  await arm(recipe());
  host = new FakeHost({ work: SEAT }, { withOptional: true });
  const read = host.screen!;
  let failed = false;
  host.screen = async (id) => {
    if (!failed) { failed = true; throw new HostDownError("at screen"); }
    return read(id);
  };
  host.screens["thread-1"] = "q?";
  await doTick();
  host.block("thread-1");
  at(1);
  expect((await doTick()).host).toBe("down");
  expect(unit().parked).toBeUndefined();
  expect(notices).toEqual([]);
  at(2);
  await doTick();
  expect(unit().parked?.reason).toBe("blocked");
  expect(notices.map((n) => n.text.split(" — screen: ")[1])).toEqual(["q?"]);
});

async function capture(fn: () => Promise<number>): Promise<{ rc: number; err: string }> {
  const write = process.stderr.write.bind(process.stderr);
  let err = "";
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stderr.write;
  try {
    return { rc: await fn(), err };
  } finally {
    process.stderr.write = write;
  }
}

test("disarm closes a blocked park's worker thread, then releases its directory", async () => {
  await blockedAt1();
  const s = unit().session!;
  setHostForTest(host);
  const order: string[] = [];
  const close = host.close!.bind(host);
  host.close = async (id) => { order.push(`close ${id}`); await close(id); };
  const release = host.release.bind(host);
  host.release = async (p, c, d) => { order.push(`release ${d}`); await release(p, c, d); };
  const r = await capture(() => main(["disarm", "r"]));
  expect(r).toEqual({ rc: 0, err: "" });
  expect(order).toEqual(["close thread-1", `release ${s.launch_dir}`]);
  expect(host.releases).toEqual([{ project: "proj", cwd: join(root, "w", "u1"), dir: s.launch_dir }]);
  expect(liveClaim(s.claim_key)).not.toBe(s.claim_nonce);
  const run = runState();
  expect(run.status).toBe("disarmed");
  expect(run.units.u1.session).toBeUndefined();
});

test("disarm: a blocked park's close that fails is reported and the disarm goes on", async () => {
  await blockedAt1();
  setHostForTest(host);
  host.close = async () => { throw new HostDownError("orca unreachable"); };
  const r = await capture(() => main(["disarm", "r"]));
  expect(r).toEqual({ rc: 0, err: "baton disarm: could not close thread-1: orca unreachable\n" });
  expect(host.releases).toEqual([]); // no release of a directory whose terminal may be open
  const run = runState();
  expect(run.status).toBe("disarmed");
  expect(run.units.u1.session?.thread_id).toBe("thread-1"); // left on record, not closed
});
