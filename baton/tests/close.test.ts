// The keep-open rule (design §4.7): on a host that defines `close`, a session end closes the
// thread's terminal before its directory is released; a park, or an end after `interrupted`,
// keeps both until unpark or run end.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { tick, type Notify, type TickReport } from "../src/engine.ts";
import type { Forge } from "../src/forge.ts";
import { HostDownError } from "../src/host.ts";
import { setHostForTest } from "../src/hosts/select.ts";
import { notifyOnce } from "../src/notify.ts";
import { openStore, type RunState } from "../src/state.ts";
import { FakeHost } from "./fake-host.ts";

const T0 = Date.parse("2026-10-22T10:00:00.000Z");
const saved = { state: process.env.BATON_STATE_DIR, config: process.env.BATON_CONFIG, home: process.env.HOME };
let root: string, state: string, clock: number, host: FakeHost;

const now = () => new Date(clock);
const at = (min: number) => { clock = T0 + min * 60_000; };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "baton-close-")));
  state = join(root, "state");
  mkdirSync(join(root, "home"));
  process.env.BATON_STATE_DIR = state;
  process.env.BATON_CONFIG = join(root, "config.json");
  process.env.HOME = join(root, "home");
  clock = T0;
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

const runDir = (id = "r1") => join(state, "runs", id);
const runState = (id = "r1"): RunState => openStore(state).readRun(id);
const claimFiles = () => {
  const d = join(state, "claims");
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".env")) : [];
};

function sess(over: Record<string, unknown> = {}) {
  return {
    kind: "session", instance: "inst", model: "mod", project: "proj",
    cwd: "{param.root}/w/{unit.id}", title: "t {unit.id}", message: "go {unit.id}",
    env: { K: "v-{unit.id}" }, handoff: null,
    outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "done" }],
    ...over,
  };
}

function recipe(stages: Record<string, unknown>, seeds: string[]) {
  const first = Object.keys(stages)[0];
  return { version: 1, name: "rec", params: ["root"], sources: [], seed: seeds.map((id) => ({ id, stage: first })), stages };
}

async function arm(rec: unknown, id = "r1") {
  const file = join(root, `${id}.recipe.json`);
  writeFileSync(file, JSON.stringify(rec));
  for (const s of (rec as { seed: { id: string }[] }).seed) mkdirSync(join(root, "w", s.id), { recursive: true });
  expect(await main(["arm", file, "--run", id, "--param", `root=${root}`, "--no-timer"])).toBe(0);
}

const doTick = (notify: Notify = notifyOnce): Promise<TickReport> =>
  tick({ store: openStore(state), host, forge: noForge, notify, now });

const DONE_WRITE = () => ({ path: join(runDir(), "out", "{unit}.done"), content: "ok" });

/** Each launch gets its own directory, so a release is visible by the directory it names. */
function ownDirs(h: FakeHost): void {
  h.bindDir = (_p, _cwd, nonce) => {
    const d = join(root, "launch", nonce.replaceAll("/", "_"));
    mkdirSync(d, { recursive: true });
    return d;
  };
}

/** One shared log of close and release calls, in the order the engine made them. */
function recordOrder(h: FakeHost): string[] {
  const order: string[] = [];
  const close = h.close!.bind(h);
  h.close = async (id) => { order.push(`close ${id}`); await close(id); };
  const release = h.release.bind(h);
  h.release = async (p, c, d) => { order.push(`release ${d}`); await release(p, c, d); };
  return order;
}

/** Two stalls: the first ends thread-1 normally, the second parks thread-2 `stalled`. */
async function stallTwice(): Promise<void> {
  await doTick(); // launch thread-1
  at(1);
  await doTick(); // first status
  at(2);
  await doTick(); // stall 1: a normal end
  at(3);
  await doTick(); // relaunch: thread-2
  at(4);
  await doTick();
  at(5);
  await doTick(); // stall 2: park
}

test("completed session is closed before release", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } }, { withOptional: true });
  ownDirs(host);
  const order = recordOrder(host);
  await doTick();
  host.advance();
  at(1);
  await doTick();
  const dir = join(root, "launch", "r1_a_work_1");
  expect(runState().units.a.stage).toBe("done");
  expect(host.closes).toEqual(["thread-1"]);
  expect(order).toEqual(["close thread-1", `release ${dir}`]);
  expect(claimFiles()).toEqual([]);
  expect(runState().units.a.kept).toBeUndefined();
});

test("park keeps the terminal and the directory", async () => {
  await arm(recipe({ work: sess({ stall_minutes: 1 }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } }, { withOptional: true });
  ownDirs(host);
  await stallTwice();
  const u = runState().units.a;
  expect(u.parked?.reason).toBe("stalled");
  // Only stall 1's normal end closed and released; the park did neither.
  expect(host.closes).toEqual(["thread-1"]);
  expect(host.releases.map((r) => r.dir)).toEqual([join(root, "launch", "r1_a_work_1")]);
  expect(u.kept).toEqual([{
    thread: "thread-2", project: "proj", cwd: join(root, "w", "a"), dir: join(root, "launch", "r1_a_work_2"), until: "unpark",
  }]);
  expect(claimFiles()).toEqual([]); // the claim goes at a park all the same
  // A parked unit keeps it on later ticks.
  at(6);
  await doTick();
  expect(host.closes).toEqual(["thread-1"]);
  expect(runState().units.a.kept?.length).toBe(1);
});

test("unpark closes the kept terminal on the next tick", async () => {
  await arm(recipe({ work: sess({ stall_minutes: 1 }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } }, { withOptional: true });
  ownDirs(host);
  await stallTwice();
  expect(await main(["unpark", "r1", "a"])).toBe(0);
  const order = recordOrder(host);
  at(6);
  await doTick();
  const dir = join(root, "launch", "r1_a_work_2");
  expect(host.closes).toEqual(["thread-1", "thread-2"]);
  expect(order).toEqual(["close thread-2", `release ${dir}`]);
  expect(runState().units.a.kept).toBeUndefined();
  expect(host.launches.length).toBe(3); // the unit relaunched in the same tick
});

test("interrupted end keeps the terminal until run end", async () => {
  await arm(recipe({
    work: sess({ outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "gate" }] }),
    gate: { kind: "wait", outcomes: [{ when: [{ file: "{run.dir}/go" }], to: "done" }] },
  }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "interrupted", writes: [DONE_WRITE()] } }, { withOptional: true });
  ownDirs(host);
  await doTick();
  host.advance();
  at(1);
  await doTick(); // interrupted, outcome met: the session ends
  let u = runState().units.a;
  expect(u.stage).toBe("gate");
  expect(u.kept?.map((k) => [k.thread, k.until])).toEqual([["thread-1", "run-end"]]);
  expect(host.closes).toEqual([]);
  expect(host.releases).toEqual([]);
  expect(claimFiles()).toEqual([]);
  at(2);
  await doTick(); // not parked, but kept until run end
  expect(host.closes).toEqual([]);
  expect(runState().units.a.kept?.length).toBe(1);
  writeFileSync(join(runDir(), "go"), "");
  const atNotice: { key: string; closes: string[]; releases: number }[] = [];
  at(3);
  await doTick((key, text) => {
    atNotice.push({ key, closes: [...host.closes], releases: host.releases.length });
    return notifyOnce(key, text);
  });
  u = runState().units.a;
  expect(runState().status).toBe("done");
  expect(atNotice.map((n) => n.key)).toEqual(["r1/done"]);
  expect(atNotice[0].closes).toEqual(["thread-1"]);
  expect(atNotice[0].releases).toBe(1);
  expect(host.releases.map((r) => r.dir)).toEqual([join(root, "launch", "r1_a_work_1")]);
  expect(u.kept).toBeUndefined();
});

test("host without close behaves as 0.4.0", async () => {
  // Adjacent control for the keep rule: the same stall park on a host with no `close`.
  await arm(recipe({ work: sess({ stall_minutes: 1 }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  ownDirs(host);
  expect("close" in host).toBe(false);
  await stallTwice();
  const u = runState().units.a;
  expect(u.parked?.reason).toBe("stalled");
  expect(host.releases.map((r) => r.dir)).toEqual([
    join(root, "launch", "r1_a_work_1"), join(root, "launch", "r1_a_work_2"),
  ]);
  expect(u.kept).toBeUndefined();
  expect(await main(["unpark", "r1", "a"])).toBe(0);
  at(6);
  await doTick();
  expect(runState().units.a.kept).toBeUndefined();
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

test("disarm closes kept terminals", async () => {
  await arm(recipe({ work: sess({ stall_minutes: 1 }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } }, { withOptional: true });
  ownDirs(host);
  await stallTwice();
  expect(runState().units.a.kept?.length).toBe(1);
  setHostForTest(host);
  const order = recordOrder(host);
  const r = await capture(() => main(["disarm", "r1"]));
  expect(r.rc).toBe(0);
  expect(r.err).toBe("");
  expect(host.closes).toEqual(["thread-1", "thread-2"]);
  expect(order).toEqual(["close thread-2", `release ${join(root, "launch", "r1_a_work_2")}`]);
  const run = runState();
  expect(run.status).toBe("disarmed");
  expect(run.units.a.kept).toBeUndefined();
});

test("disarm: a close that fails is reported and the disarm goes on", async () => {
  await arm(recipe({ work: sess({ stall_minutes: 1 }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } }, { withOptional: true });
  ownDirs(host);
  await stallTwice();
  setHostForTest(host);
  host.close = async () => { throw new HostDownError("orca unreachable"); };
  const releasesBefore = host.releases.length;
  const r = await capture(() => main(["disarm", "r1"]));
  expect(r.rc).toBe(0);
  expect(r.err).toBe("baton disarm: could not close thread-2: orca unreachable\n");
  expect(host.releases.length).toBe(releasesBefore); // no release of a directory whose terminal may be open
  expect(runState().status).toBe("disarmed");
  expect(runState().units.a.kept?.map((k) => k.thread)).toEqual(["thread-2"]); // left on record, not closed
});

// ---- fix round 1: a park by outcome keeps; triage, driver and molt parent threads close -----

function outcomeRecipe(to: "park" | "done") {
  return recipe({ work: sess({ outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to }] }) }, ["a"]);
}

test("a park by outcome keeps the terminal and the directory", async () => {
  await arm(outcomeRecipe("park"));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } }, { withOptional: true });
  ownDirs(host);
  await doTick();
  host.advance();
  at(1);
  await doTick();
  const u = runState().units.a;
  expect(u.parked?.reason).toBe("outcome");
  expect(host.closes).toEqual([]);
  expect(host.releases).toEqual([]);
  expect(u.kept?.map((k) => [k.thread, k.until, k.dir])).toEqual([["thread-1", "unpark", join(root, "launch", "r1_a_work_1")]]);
  expect(claimFiles()).toEqual([]);
});

test("control: the same recipe's non-park outcome closes, then releases", async () => {
  await arm(outcomeRecipe("done"));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } }, { withOptional: true });
  ownDirs(host);
  const order = recordOrder(host);
  await doTick();
  host.advance();
  at(1);
  await doTick();
  const u = runState().units.a;
  expect(u.stage).toBe("done");
  expect(order).toEqual(["close thread-1", `release ${join(root, "launch", "r1_a_work_1")}`]);
  expect(u.kept).toBeUndefined();
});

const REQ = { id: "req-1", questions: [{ id: "q1", header: "Pick", question: "Which way?", options: [{ label: "left" }] }] };

function triageRecipe() {
  return {
    ...recipe({ work: sess() }, ["a"]),
    triage: {
      kind: "triage", instance: "tinst", model: "tmod", project: "proj",
      cwd: "{param.root}/w/{unit.id}", title: "triage {unit.id}", message: "answer {pending.request}",
      env: { TK: "t-{unit.id}" }, note_file: "{run.dir}/notes/{unit.id}.md",
    },
  };
}

/** Seat thread-1 pending at once; its triage (thread-2) launches at minute 1, then answers and ends. */
async function triageAnswers(withOptional: boolean): Promise<string[]> {
  await arm(triageRecipe());
  host = new FakeHost({
    work: { ticks: 3, end: "completed", pending: { atStep: 0, request: REQ } },
    triage: { ticks: 100, end: "completed" },
  }, { withOptional });
  ownDirs(host);
  await doTick();
  at(1);
  await doTick();
  expect(host.launches.map((l) => l.request.nonce)).toEqual(["r1/a/work/1", "r1/a/triage/1"]);
  const log = withOptional ? recordOrder(host) : [];
  host.answer("thread-1");
  host.finish("thread-2", "completed");
  at(2);
  await doTick();
  return log;
}

test("triage end closes the triage thread before its release", async () => {
  const order = await triageAnswers(true);
  const u = runState().units.a;
  expect(u.triage).toBeUndefined();
  expect(order).toEqual(["close thread-2", `release ${join(root, "launch", "r1_a_triage_1")}`]);
  expect(u.session?.thread_id).toBe("thread-1"); // the seat goes on
});

test("control: on a host without close the triage ends as in 0.4.0", async () => {
  await triageAnswers(false);
  const u = runState().units.a;
  expect(u.triage).toBeUndefined();
  expect(u.parked).toBeUndefined();
  expect(host.releases.map((r) => r.dir)).toEqual([join(root, "launch", "r1_a_triage_1")]);
  expect(u.session?.thread_id).toBe("thread-1");
});

function driverRecipe() {
  return {
    ...recipe({ work: sess({ stop_file: "{run.dir}/stop/{unit.id}" }) }, ["a"]),
    driver: {
      kind: "driver", instance: "dinst", model: "dmod", project: "proj",
      cwd: "{param.root}/w/{unit.id}", title: "driver {unit.id}", message: "settle {unit.id}",
      env: { DK: "d-{unit.id}" },
      state_file: "{run.dir}/driver/{unit.id}/state.md",
      result_file: "{run.dir}/out/{unit.id}/driver-result-{driver.launch}.json",
      ledger: "{param.root}/ledger.md",
      clearing: ["remove-file"],
      resume_to: {},
    },
  };
}
const RESUME = JSON.stringify({ result: "resume", cleared: "remove-file", ledger: { q: "q", a: "a", why: "w", rejected: "r" } });

/** Seat thread-1 parks `stop` at minute 1 and its driver (thread-2) launches; the driver writes a resume. */
async function driverOut(): Promise<void> {
  await arm(driverRecipe());
  host = new FakeHost({
    work: { ticks: 100, end: "completed" },
    driver: { ticks: 1, end: "completed", writes: [{ path: join(runDir(), "out", "{unit}", "driver-result-{launch}.json"), content: RESUME }] },
  }, { withOptional: true });
  ownDirs(host);
  await doTick();
  mkdirSync(join(runDir(), "stop"), { recursive: true });
  writeFileSync(join(runDir(), "stop", "a"), "");
  at(1);
  await doTick();
  expect(runState().units.a.parked?.reason).toBe("stop");
  expect(runState().units.a.driver?.session.thread_id).toBe("thread-2");
  host.advance();
}

test("driver end closes the driver thread before its release", async () => {
  await driverOut();
  const order = recordOrder(host);
  at(2);
  await doTick();
  const u = runState().units.a;
  expect(u.driver).toBeUndefined();
  expect(u.parked).toBeUndefined(); // resumed in place
  expect(order).toEqual(["close thread-2", `release ${join(root, "launch", "r1_a_driver_1")}`]);
  // The seat thread the stop park kept closes on the next tick, as any unpark.
  at(3);
  await doTick();
  expect(host.closes).toEqual(["thread-2", "thread-1"]);
});

test("driver close that fails retries next tick with the result still there", async () => {
  await driverOut();
  const close = host.close!.bind(host);
  host.close = async () => { throw new HostDownError("orca unreachable"); };
  at(2);
  expect((await doTick()).host).toBe("down");
  let u = runState().units.a;
  expect(u.driver?.session.thread_id).toBe("thread-2");
  expect(existsSync(join(runDir(), "out", "a", "driver-result-1.json"))).toBe(true);
  host.close = close;
  at(3);
  await doTick();
  u = runState().units.a;
  expect(u.driver).toBeUndefined();
  expect(u.parked).toBeUndefined(); // resumed, not escalated for a lost result
  expect(host.closes).toContain("thread-2");
});

test("a molt successor closes the parent thread, keeping its claim and directory", async () => {
  await arm(recipe({
    work: sess({ handoff: { file: "{run.dir}/h/{unit.id}", token: "handed-off", message: "resume from {handoff_path}" } }),
  }, ["a"]));
  const line = `warned 40\n${new Date(T0 + 60_000).toISOString()} handed-off /tmp/hand {unit}.md\n`;
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [{ path: join(runDir(), "h", "{unit}"), content: line }] } }, { withOptional: true });
  ownDirs(host);
  const order = recordOrder(host);
  const launch = host.launch.bind(host);
  host.launch = async (r) => { order.push(`launch ${r.nonce}`); return launch(r); };
  await doTick();
  host.advance();
  at(2);
  await doTick();
  expect(order).toEqual(["launch r1/a/work/1", "close thread-1", "launch r1/a/work/2"]);
  const s = runState().units.a.session!;
  expect(s.successor_of).toBe("r1/a/work/1");
  expect(s.launch_dir).toBe(join(root, "launch", "r1_a_work_1"));
  expect(claimFiles().length).toBe(1);
});
