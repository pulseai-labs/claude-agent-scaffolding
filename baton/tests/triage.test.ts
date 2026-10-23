// The engine waits on a seat's pending request, triages it once, and acts on the result.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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

const T0 = Date.parse("2026-10-23T10:00:00.000Z");
const saved = { state: process.env.BATON_STATE_DIR, config: process.env.BATON_CONFIG, home: process.env.HOME };
let root: string, state: string, clock: number, host: FakeHost;

const now = () => new Date(clock);
const at = (min: number) => { clock = T0 + min * 60_000; };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "baton-triage-")));
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

const REQ = {
  id: "req-1",
  questions: [{ id: "q1", header: "Pick", question: "Which way?", options: [{ label: "left" }, { label: "right", description: "the other" }] }],
};
const OTHER = { id: "req-2", questions: [{ id: "q2", header: "Again", question: "Sure?", options: [{ label: "yes" }] }] };

const note = (unit = "a") => join(runDir(), "notes", `${unit}.md`);
const stop = (unit = "a") => join(runDir(), "stop", unit);
const put = (p: string, text = "x") => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const seatCwd = (unit = "a") => join(root, "w", unit);
const triageCwd = (unit = "a") => join(root, "t", unit);
const triageLaunches = () => host.launches.filter((l) => l.request.nonce.includes("/triage/"));
const seatLaunches = () => host.launches.filter((l) => !l.request.nonce.includes("/triage/"));
const DONE = () => ({ path: join(runDir(), "out", "{unit}.done"), content: "ok" });

function sess(over: Record<string, unknown> = {}) {
  return {
    kind: "session", instance: "inst", model: "mod", project: "proj",
    cwd: "{param.root}/w/{unit.id}", title: "t {unit.id}", message: "go {unit.id}",
    env: { K: "v-{unit.id}" }, handoff: null, stop_file: "{run.dir}/stop/{unit.id}",
    outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "done" }],
    ...over,
  };
}

function triageStage(over: Record<string, unknown> = {}) {
  return {
    kind: "triage", instance: "tinst", model: "tmod", project: "proj",
    cwd: "{param.root}/t/{unit.id}", title: "triage {unit.id}",
    message: "answer {pending.request} {pending.questions} on {pending.thread} in {pending.stage}",
    env: { TK: "t-{unit.id}" }, note_file: "{run.dir}/notes/{unit.id}.md",
    ...over,
  };
}

function recipe(stages: Record<string, unknown>, seeds: string[], triage: Record<string, unknown> | null = triageStage()) {
  const first = Object.keys(stages)[0];
  return {
    version: 1, name: "rec", params: ["root"], sources: [],
    seed: seeds.map((id) => ({ id, stage: first })), stages,
    ...(triage ? { triage } : {}),
  };
}

async function arm(rec: unknown) {
  const file = join(root, "r1.recipe.json");
  writeFileSync(file, JSON.stringify(rec));
  for (const s of (rec as { seed: { id: string }[] }).seed) {
    mkdirSync(seatCwd(s.id), { recursive: true });
    mkdirSync(triageCwd(s.id), { recursive: true });
  }
  expect(await main(["arm", file, "--run", "r1", "--param", `root=${root}`, "--no-timer"])).toBe(0);
}

/** A seat pending on REQ from its first step, finishing (writing its done file) 3 steps after an answer. */
const pendingSeat = (over: Partial<Behaviour> = {}): Behaviour =>
  ({ ticks: 3, end: "completed", writes: [DONE()], pending: { atStep: 0, request: REQ }, ...over });
const TRIAGE: Behaviour = { ticks: 100, end: "completed" };

/** Arm one unit `a`, launch its seat (thread-1) at minute 0 and its triage (thread-2) at minute 1. */
async function triaged(rec: unknown = recipe({ work: sess() }, ["a"]), seat: Behaviour = pendingSeat()) {
  await arm(rec);
  host = new FakeHost({ work: seat, triage: TRIAGE });
  await doTick();
  at(1);
  await doTick();
  expect(triageLaunches().length).toBe(1);
}

/** As `triaged`, then the triage ends with a note, the seat still pending: a relaunch (thread-3 at minute 3). */
async function relaunched() {
  await triaged();
  put(note());
  host.finish("thread-2", "completed");
  at(2);
  await doTick();
  at(3);
  await doTick();
  expect(seatLaunches().length).toBe(2);
}

// ---- launch ------------------------------------------------------------------------------

test("pending launches one triage", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: pendingSeat(), triage: TRIAGE });
  await doTick();
  expect(triageLaunches().length).toBe(0);
  at(1);
  await doTick();
  expect(runState().units.a.triaged).toEqual(["req-1"]);
  at(2);
  await doTick();
  expect(triageLaunches().length).toBe(1);
  const l = triageLaunches()[0];
  expect(l.request.title).toBe("triage a [baton r1/a/triage/1]");
  expect(l.request.message).toBe(`answer req-1 ${JSON.stringify(REQ.questions)} on thread-1 in work`);
  expect(l.request.instance).toBe("tinst");
  expect(l.request.cwd).toBe(triageCwd());
  expect(l.claim).toEqual({ nonce: "r1/a/triage/1", env: { TK: "t-a" } });
  const u = runState().units.a;
  expect(u.triage?.request_id).toBe("req-1");
  expect(u.triage?.session.thread_id).toBe("thread-2");
  expect(u.session?.thread_id).toBe("thread-1");
  expect(u.launches.work).toBe(1);
  const ev = events().filter((e) => e.kind === "triage");
  expect(ev).toEqual([expect.objectContaining({ unit: "a", nonce: "r1/a/triage/1", request: "req-1" })]);
});

test("stall clock paused while triage runs", async () => {
  await triaged(recipe({ work: sess() }, ["a"], triageStage({ stall_minutes: 90 })));
  for (let m = 5; m <= 61; m += 5) {
    at(m);
    await doTick();
  }
  expect(count("stall")).toBe(0);
  expect(count("park")).toBe(0);
  expect(host.interrupts).toEqual([]);
  expect(runState().units.a.triage?.session.thread_id).toBe("thread-2");
});

// ---- the triage ends ------------------------------------------------------------------------

test("answered", async () => {
  await triaged();
  host.answer("thread-1");
  host.finish("thread-2", "completed");
  at(2);
  await doTick();
  expect(count("triage answered")).toBe(1);
  expect(runState().units.a.triage).toBeUndefined();
  expect(liveClaim(claimKey(triageCwd()))).toBeNull();
  for (let i = 0; i < 3; i++) host.advance();
  at(3);
  await doTick();
  const u = runState().units.a;
  expect(u.stage).toBe("done");
  expect(u.parked).toBeUndefined();
  expect(count("park")).toBe(0);
  expect(count("triage answered")).toBe(1);
  expect(seatLaunches().length).toBe(1);
});

test("relaunch with note", async () => {
  await triaged();
  put(note());
  host.finish("thread-2", "completed");
  at(2);
  await doTick();
  expect(host.interrupts).toEqual([{ threadId: "thread-1", reason: "stalled" }]);
  expect(count("triage relaunch")).toBe(1);
  let u = runState().units.a;
  expect(u.stalls).toBe(1);
  expect(u.parked).toBeUndefined();
  expect(u.triage).toBeUndefined();
  at(3);
  await doTick();
  expect(seatLaunches().length).toBe(2);
  expect(seatLaunches()[1].request.nonce).toBe("r1/a/work/2");
  expect(existsSync(note())).toBe(true);
  // the relaunched seat shows the same (stale) request and never moves: an ordinary stall
  at(4);
  await doTick();
  at(48);
  await doTick();
  expect(runState().units.a.parked).toBeUndefined();
  at(49);
  await doTick();
  u = runState().units.a;
  expect(u.stalls).toBe(2);
  expect(u.parked?.reason).toBe("stalled");
  expect(triageLaunches().length).toBe(1);
});

test("prompt after relaunch parks", async () => {
  await relaunched();
  host.raise("thread-3", OTHER);
  at(4);
  await doTick();
  const u = runState().units.a;
  expect(u.parked?.reason).toBe("second prompt");
  expect(host.interrupts.at(-1)).toEqual({ threadId: "thread-3", reason: "stop" });
  expect(triageLaunches().length).toBe(1);
});

test("park releases triage", async () => {
  // (a) the triage ends with no note
  await triaged();
  host.finish("thread-2", "completed");
  at(2);
  await doTick();
  expect(runState().units.a.parked?.reason).toBe("triage gave no answer");
  expect(runState().units.a.triage).toBeUndefined();
  expect(liveClaim(claimKey(triageCwd()))).toBeNull();
  expect(host.releases.map((r) => r.dir)).toContain(triageCwd());
  expect(count("triage dropped")).toBe(0);
});

test("park releases triage: a second prompt while triage runs", async () => {
  // (b) the triage is live and the seat raises another request
  await triaged();
  expect(liveClaim(claimKey(triageCwd()))).toBe("r1/a/triage/1");
  host.raise("thread-1", OTHER);
  at(2);
  await doTick();
  const u = runState().units.a;
  expect(u.parked?.reason).toBe("second prompt");
  expect(u.triage).toBeUndefined();
  expect(host.interrupts).toEqual([
    { threadId: "thread-2", reason: "stop" },
    { threadId: "thread-1", reason: "stop" },
  ]);
  expect(count("triage dropped")).toBe(1);
  expect(liveClaim(claimKey(triageCwd()))).toBeNull();
  expect(host.releases.map((r) => r.dir)).toContain(triageCwd());
});

test("acted once", async () => {
  await relaunched();
  // thread-3 reports req-1, already acted on: no triage, no stall, no park
  at(4);
  await doTick();
  at(5);
  await doTick();
  const u = runState().units.a;
  expect(triageLaunches().length).toBe(1);
  expect(count("triage")).toBe(1);
  expect(u.stalls).toBe(1);
  expect(u.parked).toBeUndefined();
  expect(host.interrupts.length).toBe(1);
});

test("stale note cleared", async () => {
  await arm(recipe({
    one: sess({ outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.one" }], to: "two" }] }),
    two: sess(),
  }, ["a"]));
  host = new FakeHost({
    one: { ticks: 1, end: "completed", writes: [{ path: join(runDir(), "out", "{unit}.one"), content: "ok" }] },
    two: pendingSeat(),
    triage: TRIAGE,
  });
  put(note(), "from an earlier visit");
  await doTick();
  host.advance();
  at(1);
  await doTick(); // one completes; enterStage(two) deletes the note; two launches
  expect(runState().units.a.stage).toBe("two");
  expect(existsSync(note())).toBe(false);
  put(note(), "stale again");
  at(2);
  await doTick(); // two is pending: the note goes before the triage launches
  expect(triageLaunches().length).toBe(1);
  expect(existsSync(note())).toBe(false);
  host.finish(runState().units.a.triage!.session.thread_id!, "completed");
  at(3);
  await doTick();
  expect(runState().units.a.parked?.reason).toBe("triage gave no answer");
});

test("unpark --to clears triaged and the note", async () => {
  await triaged();
  host.finish("thread-2", "completed");
  at(2);
  await doTick(); // parks: no answer
  put(note());
  expect(await main(["unpark", "r1", "a", "--to", "work"])).toBe(0);
  const u = runState().units.a;
  expect(u.triaged).toBeUndefined();
  expect(existsSync(note())).toBe(false);
});

test("report counts triage", async () => {
  await arm(recipe({ work: sess() }, ["a", "b"]));
  host = new FakeHost({ work: pendingSeat(), triage: TRIAGE });
  await doTick(); // a: thread-1, b: thread-2
  at(1);
  await doTick(); // a's triage thread-3, b's triage thread-4
  expect(triageLaunches().length).toBe(2);
  host.answer("thread-1");
  host.finish("thread-3", "completed");
  put(note("b"));
  host.finish("thread-4", "completed");
  at(2);
  await doTick();
  const BIN = join(import.meta.dir, "..", "bin", "baton");
  const p = Bun.spawn([BIN, "report", "r1"], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const [out, rc] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  expect(rc).toBe(0);
  const lines = out.trim().split("\n");
  expect(lines).toContain("triage 2");
  expect(lines).toContain("triage answered 1");
  expect(lines).toContain("triage relaunch 1");
});

test("no answer parks", async () => {
  await triaged();
  host.finish("thread-2", "completed");
  at(2);
  await doTick();
  const u = runState().units.a;
  expect(u.parked?.reason).toBe("triage gave no answer");
  expect(u.session).toBeUndefined();
  expect(host.interrupts).toEqual([{ threadId: "thread-1", reason: "stop" }]);
  expect(liveClaim(claimKey(seatCwd()))).toBeNull();
});

test("triage over its limit", async () => {
  await triaged(); // triage launched at minute 1
  at(10);
  await doTick();
  expect(host.interrupts).toEqual([]);
  at(11);
  await doTick();
  expect(host.interrupts).toEqual([
    { threadId: "thread-2", reason: "stalled" },
    { threadId: "thread-1", reason: "stop" },
  ]);
  expect(runState().units.a.parked?.reason).toBe("triage gave no answer");
});

test("second prompt parks", async () => {
  await triaged(undefined, pendingSeat({ ticks: 100 }));
  host.answer("thread-1");
  host.finish("thread-2", "completed");
  at(2);
  await doTick();
  expect(count("triage answered")).toBe(1);
  host.raise("thread-1", OTHER);
  at(3);
  await doTick();
  expect(runState().units.a.parked?.reason).toBe("second prompt");
  expect(host.interrupts).toEqual([{ threadId: "thread-1", reason: "stop" }]);
  expect(triageLaunches().length).toBe(1);
});

// ---- Review Focus 1-5 -------------------------------------------------------------------------

test("seat completes before triage ends", async () => {
  await triaged();
  host.answer("thread-1");
  for (let i = 0; i < 3; i++) host.advance(); // the seat finishes; the triage thread runs on
  at(2);
  await doTick();
  const u = runState().units.a;
  expect(u.stage).toBe("done");
  expect(u.triage).toBeUndefined();
  expect(host.interrupts).toEqual([{ threadId: "thread-2", reason: "stop" }]);
  expect(count("triage dropped")).toBe(1);
  expect(count("triage answered")).toBe(0);
  expect(liveClaim(claimKey(triageCwd()))).toBeNull();
  expect(host.releases.map((r) => r.dir)).toContain(triageCwd());
});

test("pending clears while triage runs", async () => {
  await triaged(undefined, pendingSeat({ ticks: 100 }));
  host.answer("thread-1"); // the operator answers
  at(2);
  await doTick();
  expect(count("triage answered")).toBe(0);
  expect(runState().units.a.triage?.session.thread_id).toBe("thread-2");
  host.finish("thread-2", "completed");
  at(3);
  await doTick();
  let u = runState().units.a;
  expect(count("triage answered")).toBe(1);
  expect(u.parked).toBeUndefined();
  expect(u.stalls).toBe(0);
  expect(u.triaged).toEqual(["req-1"]);
  expect(seatLaunches().length).toBe(1);
  host.raise("thread-1", REQ); // the same id again never triggers
  at(4);
  await doTick();
  u = runState().units.a;
  expect(triageLaunches().length).toBe(1);
  expect(u.parked).toBeUndefined();
});

test("lost triage launch", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: pendingSeat(), triage: TRIAGE });
  await doTick();
  const orig = host.launch.bind(host);
  host.launch = async (_r: LaunchRequest) => {
    host.launch = orig;
    throw new HostDownError("mid-launch");
  };
  at(1);
  const r = await doTick();
  expect(r.host).toBe("down");
  let u = runState().units.a;
  expect(u.triaged).toEqual(["req-1"]);
  expect(u.triage?.session.nonce).toBe("r1/a/triage/1");
  expect(u.triage?.session.thread_id).toBeUndefined();
  at(2);
  await doTick(); // not found yet, inside the orphan window: still waiting
  expect(runState().units.a.parked).toBeUndefined();
  at(4);
  await doTick(); // none found: the triage counts as ended with no answer
  u = runState().units.a;
  expect(count("orphan")).toBe(1);
  expect(u.parked?.reason).toBe("triage gave no answer");
  expect(u.triage).toBeUndefined();
  expect(liveClaim(claimKey(triageCwd()))).toBeNull();
});

test("lost triage launch found by nonce is adopted", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: pendingSeat(), triage: { ...TRIAGE, loseResponse: true } });
  await doTick();
  at(1);
  await doTick();
  expect(runState().units.a.triage?.session.thread_id).toBeUndefined();
  at(2);
  await doTick();
  expect(runState().units.a.triage?.session.thread_id).toBe("thread-2");
  expect(count("adopted")).toBe(1);
  expect(triageLaunches().length).toBe(1);
});

test("stop beats note", async () => {
  await triaged();
  put(note());
  put(stop());
  host.finish("thread-2", "completed");
  at(2);
  await doTick();
  const u = runState().units.a;
  expect(u.parked?.reason).toBe("stop");
  expect(u.stalls).toBe(0);
  expect(count("triage relaunch")).toBe(0);
  expect(u.triage).toBeUndefined();
  expect(liveClaim(claimKey(triageCwd()))).toBeNull();
  expect(seatLaunches().length).toBe(1);
});

test("no triage stage", async () => {
  await arm(recipe({ work: sess() }, ["a"], null));
  host = new FakeHost({ work: pendingSeat(), triage: TRIAGE });
  await doTick();
  at(1);
  await doTick();
  at(2);
  await doTick();
  expect(count("pending")).toBe(1);
  expect(events().find((e) => e.kind === "pending")).toEqual(expect.objectContaining({ unit: "a", request: "req-1" }));
  expect(triageLaunches().length).toBe(0);
  at(45);
  await doTick();
  expect(count("stall")).toBe(0);
  at(46);
  await doTick(); // the stall clock ran from minute 1
  expect(count("stall")).toBe(1);
  at(47);
  await doTick(); // relaunch, pending on the same request: no second event
  at(48);
  await doTick();
  expect(seatLaunches().length).toBe(2);
  expect(count("pending")).toBe(1);
  expect(triageLaunches().length).toBe(0);
});

// ---- the seat's state gates its pending request --------------------------------------------

/** Make `threadId` report `state` with REQ still pending (a stale read). */
function staleRead(threadId: string, state: ThreadStatus["state"]) {
  const orig = host.status.bind(host);
  host.status = async (id: string) => {
    const st = await orig(id);
    return id === threadId ? { ...st, state, pending: REQ } : st;
  };
}

for (const end of ["completed", "interrupted"] as const) {
  test(`${end}: a seat with a stale pending request takes its outcome`, async () => {
    await arm(recipe({ work: sess() }, ["a"]));
    host = new FakeHost({ work: { ticks: 100, end: "completed" }, triage: TRIAGE });
    await doTick();
    staleRead("thread-1", end);
    put(join(runDir(), "out", "a.done"), "ok");
    at(1);
    await doTick();
    const u = runState().units.a;
    expect(u.stage).toBe("done");
    expect(u.parked).toBeUndefined();
    expect(triageLaunches().length).toBe(0);
    expect(count("triage")).toBe(0);
  });
}

test("a waiting seat with a pending request is triaged", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" }, triage: TRIAGE });
  await doTick();
  staleRead("thread-1", "waiting");
  at(1);
  await doTick();
  expect(triageLaunches().length).toBe(1);
  expect(runState().units.a.triage?.request_id).toBe("req-1");
});

// ---- each triage branch, pinned ----------------------------------------------------------

test("a host error at triage bind unmarks the request and the seq: a later tick triages once", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: pendingSeat(), triage: TRIAGE });
  await doTick();
  let failed = false;
  host.bindDir = (_p, cwd, nonce) => {
    if (nonce.includes("/triage/") && !failed) {
      failed = true;
      throw new HostDownError("at bind");
    }
    return cwd;
  };
  at(1);
  expect((await doTick()).host).toBe("down");
  let u = runState().units.a;
  expect(u.triaged).toBeUndefined();
  expect(u.seq?.triage).toBeUndefined();
  expect(u.triage).toBeUndefined();
  at(2);
  await doTick();
  at(3);
  await doTick();
  u = runState().units.a;
  expect(triageLaunches().map((l) => l.request.nonce)).toEqual(["r1/a/triage/1"]);
  expect(u.triaged).toEqual(["req-1"]);
  expect(u.parked).toBeUndefined();
});

test("a triage nonce that finds two threads parks ambiguous nonce", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: pendingSeat(), triage: { ...TRIAGE, loseResponse: true } });
  await doTick();
  at(1);
  await doTick();
  expect(runState().units.a.triage?.session.thread_id).toBeUndefined();
  host.findByNonce = async (_p: string, nonce: string) => (nonce.includes("/triage/") ? ["thread-2", "thread-9"] : []);
  at(2); // inside the orphan window
  await doTick();
  const u = runState().units.a;
  expect(u.parked?.reason).toBe("ambiguous nonce");
  expect(u.triage).toBeUndefined();
  expect(count("ambiguous nonce")).toBe(1);
  expect(liveClaim(claimKey(triageCwd()))).toBeNull();
  // the directory may hold a live thread: it is kept
  expect(host.releases.map((r) => r.dir)).not.toContain(triageCwd());
  expect(host.interrupts).toEqual([{ threadId: "thread-1", reason: "stop" }]);
});

test("disarm removes a live triage claim", async () => {
  await triaged();
  expect(liveClaim(claimKey(triageCwd()))).toBe("r1/a/triage/1");
  expect(await main(["disarm", "r1"])).toBe(0);
  expect(liveClaim(claimKey(triageCwd()))).toBeNull();
  expect(liveClaim(claimKey(seatCwd()))).toBeNull();
});

test("a handoff successor ends a live triage", async () => {
  const handoff = { file: "{run.dir}/h/{unit.id}", token: "handed-off", message: "resume from {handoff_path}" };
  await triaged(recipe({ work: sess({ handoff }) }, ["a"]), pendingSeat({ writes: [] }));
  host.answer("thread-1");
  for (let i = 0; i < 3; i++) host.advance(); // the seat completes with no result; the triage runs on
  put(join(runDir(), "h", "a"), `${new Date(T0 + 60_000 * 2).toISOString()} handed-off /tmp/hand.md\n`);
  at(3);
  await doTick();
  const u = runState().units.a;
  expect(count("successor")).toBe(1);
  expect(u.triage).toBeUndefined();
  expect(count("triage dropped")).toBe(1);
  expect(host.interrupts).toEqual([{ threadId: "thread-2", reason: "stop" }]);
  expect(liveClaim(claimKey(triageCwd()))).toBeNull();
  expect(host.releases.map((r) => r.dir)).toContain(triageCwd());
});

test("a triage claim that cannot be written releases the triage launch dir", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: pendingSeat(), triage: TRIAGE });
  await doTick();
  const missing = join(root, "t", "a-wt"); // never created: the claim cannot resolve it
  host.bindDir = (_p, cwd, nonce) => (nonce.includes("/triage/") ? missing : cwd);
  at(1);
  await doTick();
  const u = runState().units.a;
  expect(triageLaunches().length).toBe(0);
  expect(u.triage).toBeUndefined();
  expect(u.triaged).toEqual(["req-1"]);
  expect(host.releases.map((r) => r.dir)).toEqual([missing]);
  expect(events().filter((e) => e.kind === "launch failed")).toEqual([
    expect.objectContaining({ unit: "a", nonce: "r1/a/triage/1", reason: expect.stringContaining("claim:") }),
  ]);
});

test("a triage LaunchError ends the triage and keeps the request recorded", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: pendingSeat(), triage: TRIAGE });
  await doTick();
  const orig = host.launch.bind(host);
  host.launch = async (r: LaunchRequest) => {
    if (r.nonce.includes("/triage/")) throw new LaunchError("refused");
    return orig(r);
  };
  at(1);
  await doTick();
  let u = runState().units.a;
  expect(u.triage).toBeUndefined();
  expect(u.triaged).toEqual(["req-1"]);
  expect(liveClaim(claimKey(triageCwd()))).toBeNull();
  expect(host.releases.map((r) => r.dir)).toContain(triageCwd());
  expect(count("launch failed")).toBe(1);
  at(2);
  await doTick(); // already acted on: no second try
  u = runState().units.a;
  expect(count("launch failed")).toBe(1);
  expect(u.parked).toBeUndefined();
});

test("the triage launch tick stamps the seat's stall clock", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" }, triage: TRIAGE });
  await doTick();
  at(1);
  await doTick(); // the seat's first activity: its clock starts here
  expect(runState().units.a.session?.last_progress_at).toBe(new Date(T0 + 60_000).toISOString());
  host.raise("thread-1", REQ); // no step taken: the progress mark does not move
  at(5);
  await doTick();
  const u = runState().units.a;
  expect(triageLaunches().length).toBe(1);
  expect(u.session?.last_progress_at).toBe(new Date(T0 + 5 * 60_000).toISOString());
});
