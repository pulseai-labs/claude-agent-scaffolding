import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimKey, claimPath, liveClaim } from "../src/claims.ts";
import { main } from "../src/cli.ts";
import { exitCode, tick, type TickReport } from "../src/engine.ts";
import type { Forge } from "../src/forge.ts";
import { HostDownError, LaunchError, type LaunchRequest } from "../src/host.ts";
import { notifyOnce } from "../src/notify.ts";
import { openStore, type RunState } from "../src/state.ts";
import { FakeHost } from "./fake-host.ts";

const T0 = Date.parse("2026-10-22T10:00:00.000Z");
const saved = { state: process.env.BATON_STATE_DIR, config: process.env.BATON_CONFIG, home: process.env.HOME };
let root: string, state: string, clock: number, host: FakeHost;

const now = () => new Date(clock);
const at = (min: number) => { clock = T0 + min * 60_000; };
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();

function fresh() {
  root = realpathSync(mkdtempSync(join(tmpdir(), "baton-engine-")));
  state = join(root, "state");
  mkdirSync(join(root, "home"));
  process.env.BATON_STATE_DIR = state;
  process.env.BATON_CONFIG = join(root, "config.json");
  process.env.HOME = join(root, "home");
  clock = T0;
}
beforeEach(fresh);
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

const runDir = (id = "r1") => join(state, "runs", id);
const store = () => openStore(state);
const runState = (id = "r1"): RunState => store().readRun(id);
const runBytes = (id = "r1") => readFileSync(join(runDir(id), "run.json"), "utf8");
const events = (id = "r1") =>
  readFileSync(join(runDir(id), "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const kinds = (id = "r1") => events(id).map((e) => e.kind as string);
const count = (kind: string, id = "r1") => kinds(id).filter((k) => k === kind).length;
const claimFiles = () => {
  const d = join(state, "claims");
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".env")) : [];
};
const notifyLines = () => {
  const p = join(state, "notify.log");
  return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean) : [];
};
const lines = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean) : []);

/** A session stage whose thread works in `<root>/w/<unit>` and ends on `<run>/out/<unit>.done`. */
function sess(over: Record<string, unknown> = {}) {
  return {
    kind: "session", instance: "inst", model: "mod", project: "proj",
    cwd: "{param.root}/w/{unit.id}", title: "t {unit.id}", message: "go {unit.id} in {run.dir}",
    env: { K: "v-{unit.id}" }, handoff: null,
    outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "done" }],
    ...over,
  };
}

function recipe(stages: Record<string, unknown>, seeds: string[], extra: Record<string, unknown> = {}) {
  const first = Object.keys(stages)[0];
  return {
    version: 1, name: "rec", params: ["root"], sources: [],
    seed: seeds.map((id) => ({ id, stage: first })), stages, ...extra,
  };
}

async function arm(rec: unknown, id = "r1") {
  const file = join(root, `${id}.recipe.json`);
  writeFileSync(file, JSON.stringify(rec));
  for (const s of (rec as { seed: { id: string }[] }).seed) mkdirSync(join(root, "w", s.id), { recursive: true });
  expect(await main(["arm", file, "--run", id, "--param", `root=${root}`, "--no-timer"])).toBe(0);
}

const doTick = (over: Partial<Parameters<typeof tick>[0]> = {}): Promise<TickReport> =>
  tick({ store: store(), host, forge: noForge, notify: notifyOnce, now, ...over });

const done = (unit: string, id = "r1") => {
  mkdirSync(join(runDir(id), "out"), { recursive: true });
  writeFileSync(join(runDir(id), "out", `${unit}.done`), "ok");
};
const DONE_WRITE = () => ({ path: join(runDir(), "out", "{unit}.done"), content: "ok" });

/** Make the next `launch` throw `err`; with `register`, the thread exists first (a lost response). */
function failNextLaunch(err: Error, register: boolean) {
  const orig = host.launch.bind(host);
  host.launch = async (r: LaunchRequest) => {
    host.launch = orig;
    if (register) await orig(r).catch(() => {});
    throw err;
  };
}

// ---- launches -------------------------------------------------------------------------

test("launches a due unit with its rendered claim and message", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed" } });
  const r = await doTick();
  expect(r.launched).toEqual(["a"]);
  expect(host.launches.length).toBe(1);
  const l = host.launches[0];
  expect(l.claim).toEqual({ nonce: "r1/a/work/1", env: { K: "v-a" } });
  expect(l.request.message).toBe(`go a in ${runDir()}`);
  expect(l.request.title).toBe("t a [baton r1/a/work/1]");
  expect(l.request.cwd).toBe(join(root, "w", "a"));
  expect(l.request.instance).toBe("inst");
  const u = runState().units.a;
  expect(u.session?.thread_id).toBe("thread-1");
  expect(u.session?.claim_nonce).toBe("r1/a/work/1");
  expect(u.launches.work).toBe(1);
  expect(kinds().filter((k) => k === "launching" || k === "launched")).toEqual(["launching", "launched"]);
  expect(exitCode(r)).toBe(0);
});

test("adopts a launched thread whose response was lost", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 5, end: "completed", loseResponse: true } });
  await doTick();
  expect(host.launches.length).toBe(1);
  expect(runState().units.a.session?.thread_id).toBeUndefined();
  at(1);
  await doTick();
  expect(host.launches.length).toBe(1);
  const u = runState().units.a;
  expect(u.session?.thread_id).toBe("thread-1");
  expect(u.launches.work).toBe(1);
  expect(liveClaim(claimKey(join(root, "w", "a")))).toBe("r1/a/work/1");
});

test("a nonce T3 never saw is relaunched after 2 minutes", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 5, end: "completed" } });
  failNextLaunch(new HostDownError(), false);
  expect(exitCode(await doTick())).toBe(4);
  expect(runState().units.a.session?.thread_id).toBeUndefined();
  at(1);
  await doTick();
  expect(host.launches.length).toBe(0);
  at(3);
  await doTick();
  expect(host.launches.length).toBe(1);
  expect(runState().units.a.session?.thread_id).toBe("thread-1");
  expect(count("orphan")).toBe(1);
  // The dropped orphan counts one attempt (final re-review ruling), and the relaunch a second.
  expect(runState().units.a.launches.work).toBe(2);
});

test("three unknown launch outcomes in a row park cap with one notice", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 5, end: "completed" } });
  // Every launch is an unknown outcome and T3 never lists a thread for the nonce.
  host.launch = async () => { throw new HostDownError("t3_thread_launch outcome unknown: JSON-RPC error -32602: bad model"); };
  for (let i = 0; i < 12 && !runState().units.a.parked; i++) {
    at(i * 1.5);
    await doTick();
  }
  const u = runState().units.a;
  expect(u.parked?.reason).toBe("cap");
  expect(u.launches.work).toBe(3);
  expect(count("orphan")).toBe(3);
  const unknown = events().filter((e) => e.kind === "launch unknown");
  expect(unknown.map((e) => e.nonce)).toEqual(["r1/a/work/1", "r1/a/work/2", "r1/a/work/3"]);
  expect(notifyLines().length).toBe(1);
  expect(notifyLines()[0]).toContain("parked in work: cap");
  expect(claimFiles()).toEqual([]);
});

test("control: an adopted lost response is counted exactly once", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 5, end: "completed" } });
  failNextLaunch(new HostDownError(), true);
  await doTick();
  at(1);
  await doTick();
  at(3);
  await doTick();
  const u = runState().units.a;
  expect(u.session?.thread_id).toBe("thread-1");
  expect(u.launches.work).toBe(1);
  expect(count("orphan")).toBe(0);
  expect(count("launch unknown")).toBe(0);
  expect(host.launches.length).toBe(1);
});

test("an orphan dropped at 2 minutes relaunches with a new nonce and a new directory", async () => {
  const projRoot = join(root, "proj");
  mkdirSync(projRoot);
  await arm(recipe({ work: sess({ cwd: "{param.root}/proj" }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 5, end: "completed" } });
  t3LikeBind(projRoot);
  failNextLaunch(new HostDownError(), false);
  await doTick();
  const first = runState().units.a.session!;
  expect(first.nonce).toBe("r1/a/work/1");
  expect(first.launch_dir).toBe(join(state, "launch", "r1%2Fa%2Fwork%2F1"));
  at(3);
  await doTick();
  expect(host.releases.map((r) => r.dir)).toEqual([first.launch_dir]);
  expect(host.launches.length).toBe(1);
  const l = host.launches[0];
  expect(l.request.nonce).toBe("r1/a/work/2");
  expect(l.request.cwd).toBe(join(state, "launch", "r1%2Fa%2Fwork%2F2"));
  expect(l.request.cwd).not.toBe(first.launch_dir);
  const u = runState().units.a;
  expect(u.launches.work).toBe(2); // the dropped orphan counts one attempt (final re-review ruling)
  expect(u.seq?.work).toBe(2);
});

test("a session without thread_id younger than 2 minutes blocks a second launch", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 5, end: "completed" } });
  failNextLaunch(new HostDownError(), false);
  await doTick();
  at(1.5);
  await doTick();
  expect(host.launches.length).toBe(0);
  const s = runState().units.a.session;
  expect(s?.nonce).toBe("r1/a/work/1");
  expect(s?.thread_id).toBeUndefined();
  expect(claimFiles().length).toBe(1);
});

test("two threads for one nonce park ambiguous nonce", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 5, end: "completed", loseResponse: true } });
  await doTick();
  await host.launch(host.launches[0].request).catch(() => {});
  expect(host.launches.length).toBe(2);
  at(1);
  const r = await doTick();
  expect(r.parked).toEqual(["a"]);
  expect(runState().units.a.parked?.reason).toBe("ambiguous nonce");
  expect(notifyLines().length).toBe(1);
  at(5);
  await doTick();
  expect(host.launches.length).toBe(2);
  expect(claimFiles()).toEqual([]);
});

test("after_launch runs only once a thread id exists", async () => {
  const before = join(root, "before.log");
  const after = join(root, "after.log");
  await arm(recipe({
    work: sess({
      before: [["sh", "-c", `echo {unit.id} >> ${before}`]],
      after_launch: [["sh", "-c", `echo {unit.id} >> ${after}`]],
    }),
  }, ["a", "b"]));
  host = new FakeHost({ work: { ticks: 5, end: "completed" } });
  failNextLaunch(new HostDownError(), true);
  expect(exitCode(await doTick())).toBe(4);
  expect(lines(before)).toEqual(["a"]);
  expect(lines(after)).toEqual([]);
  at(1);
  await doTick();
  expect(runState().units.a.session?.thread_id).toBe("thread-1");
  expect(runState().units.b.session?.thread_id).toBe("thread-2");
  expect(lines(before)).toEqual(["a", "b"]);
  expect(lines(after)).toEqual(["b"]);
});

test("a LaunchError counts one attempt and removes the claim", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 5, end: "completed" } });
  failNextLaunch(new LaunchError("no such project"), false);
  await doTick();
  const u = runState().units.a;
  expect(u.launches.work).toBe(1);
  expect(u.session).toBeUndefined();
  expect(claimFiles()).toEqual([]);
  expect(events().find((e) => e.kind === "launch failed")?.reason).toBe("no such project");
  expect(host.launches.length).toBe(0);
  at(1);
  await doTick();
  expect(host.launches.length).toBe(1);
  expect(host.launches[0].request.nonce).toBe("r1/a/work/2");
});

// ---- successors -----------------------------------------------------------------------

function handoffStage(before?: string) {
  return sess({
    handoff: { file: "{run.dir}/h/{unit.id}", token: "handed-off", message: "resume from {handoff_path}" },
    ...(before ? { before: [["sh", "-c", `echo {unit.id} >> ${before}`]] } : {}),
  });
}
const handoffWrite = (min: number) => ({ path: join(runDir(), "h", "{unit}"), content: `warned 40\n${iso(min)} handed-off /tmp/hand {unit}.md\n` });

test("a successor keeps the claim header nonce and removal still works", async () => {
  await arm(recipe({ work: handoffStage() }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [handoffWrite(1)] } });
  await doTick();
  host.advance();
  at(2);
  await doTick();
  expect(host.launches.length).toBe(2);
  expect(host.launches[1].claim?.nonce).toBe("r1/a/work/1");
  expect(host.launches[1].request.title).toBe("t a [baton r1/a/work/2]");
  const s = runState().units.a.session!;
  expect(s.successor_of).toBe("r1/a/work/1");
  expect(s.claim_nonce).toBe("r1/a/work/1");
  expect(liveClaim(s.claim_key)).toBe("r1/a/work/1");
  host.advance(); // the successor rewrites the same handoff line, now older than its launch
  done("a");
  at(3);
  await doTick();
  expect(runState().units.a.stage).toBe("done");
  expect(claimFiles()).toEqual([]);
  expect(count("successor")).toBe(1);
});

test("a handoff line launches a successor on the same claim", async () => {
  const before = join(root, "before.log");
  await arm(recipe({ work: handoffStage(before) }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [handoffWrite(1)] } });
  await doTick();
  host.advance();
  at(2);
  await doTick();
  expect(host.launches.length).toBe(2);
  expect(host.launches[1].request.message).toBe("resume from /tmp/hand a.md");
  expect(host.launches[1].request.cwd).toBe(host.launches[0].request.cwd);
  expect(runState().units.a.launches.work).toBe(1);
  expect(lines(before)).toEqual(["a"]);
});

test("a refused successor launch counts one attempt, removes the claim, and relaunches next tick", async () => {
  await arm(recipe({ work: handoffStage() }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [handoffWrite(1)] } });
  await doTick();
  host.advance();
  at(2);
  failNextLaunch(new LaunchError("refused"), false);
  const r = await doTick();
  expect(r.launched).toEqual([]);
  const u = runState().units.a;
  expect(u.session).toBeUndefined();
  expect(u.launches.work).toBe(2);
  expect(claimFiles()).toEqual([]);
  expect(host.launches.length).toBe(1);
  at(3);
  await doTick();
  expect(host.launches.length).toBe(2);
  expect(host.launches[1].request.nonce).toBe("r1/a/work/3");
});

test("control: a handoff line older than the launch is ignored", async () => {
  await arm(recipe({ work: handoffStage() }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [handoffWrite(-1)] } });
  await doTick();
  host.advance();
  at(2);
  await doTick();
  expect(host.launches.length).toBe(1);
  expect(count("successor")).toBe(0);
  expect(runState().units.a.session?.thread_id).toBe("thread-1");
});

// ---- slots and directories -------------------------------------------------------------

test("default slots cap a recipe that omits slots", async () => {
  await arm(recipe({ work: sess() }, ["a", "b", "c"]));
  host = new FakeHost({ work: { ticks: 5, end: "completed" } });
  await doTick();
  expect(host.launches.length).toBe(2);
  expect(runState().units.c.session).toBeUndefined();
});

test("slots cap concurrent sessions", async () => {
  await arm(recipe({ work: sess() }, ["a", "b", "c"], { slots: { session: 2 } }));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } });
  await doTick();
  expect(host.launches.map((l) => l.request.nonce)).toEqual(["r1/a/work/1", "r1/b/work/1"]);
  host.advance();
  at(1);
  await doTick();
  expect(host.launches.length).toBe(3);
  expect(host.launches[2].request.nonce).toBe("r1/c/work/1");
});

/** A FakeHost bind that, like T3's, gives a root-`cwd` worktree stage its own launch directory. */
function t3LikeBind(projRoot: string) {
  host.bindDir = (_p, cwd, nonceText, mode) => {
    if (cwd !== projRoot || mode === "root") return cwd;
    const dir = join(state, "launch", encodeURIComponent(nonceText));
    mkdirSync(dir, { recursive: true });
    return dir;
  };
}

test("default root cwd still binds a per-launch worktree", async () => {
  const projRoot = join(root, "proj");
  mkdirSync(projRoot);
  await arm(recipe({ work: sess({ cwd: "{param.root}/proj" }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } });
  t3LikeBind(projRoot);
  await doTick();
  const dir = join(state, "launch", "r1%2Fa%2Fwork%2F1");
  expect(host.launches[0].request.cwd).toBe(dir);
  expect(runState().units.a.session?.claim_key).toBe(claimKey(dir));
  expect(liveClaim(claimKey(dir))).toBe("r1/a/work/1");
  expect(existsSync(claimPath(claimKey(projRoot)))).toBe(false);
  host.advance();
  at(1);
  await doTick();
  expect(runState().units.a.stage).toBe("done");
  expect(host.releases).toEqual([{ project: "proj", cwd: projRoot, dir }]);
  expect(existsSync(claimPath(claimKey(projRoot)))).toBe(false);
  expect(claimFiles()).toEqual([]);
});

test("launch_dir root binds the root and holds it busy", async () => {
  const projRoot = join(root, "proj");
  mkdirSync(projRoot);
  await arm(recipe({ work: sess({ cwd: "{param.root}/proj", launch_dir: "root" }) }, ["a", "b"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } });
  t3LikeBind(projRoot);
  await doTick();
  expect(host.launches.length).toBe(1);
  expect(host.launches[0].request.cwd).toBe(projRoot);
  expect(liveClaim(claimKey(projRoot))).toBe("r1/a/work/1");
  expect(runState().units.b.session).toBeUndefined();
  expect(events().filter((e) => e.kind === "cwd busy").map((e) => e.unit)).toEqual(["b"]);
  host.advance();
  at(1);
  await doTick();
  // a's outcome removed its root claim; b took the root in the same tick.
  expect(runState().units.a.stage).toBe("done");
  expect(host.launches.length).toBe(2);
  expect(host.launches[1].claim?.nonce).toBe("r1/b/work/1");
  host.advance();
  at(2);
  await doTick();
  expect(runState().units.b.stage).toBe("done");
  expect(existsSync(claimPath(claimKey(projRoot)))).toBe(false);
});

test("cwd busy waits instead of launching a second session in one directory", async () => {
  await arm(recipe({ work: sess({ cwd: "{param.root}/shared" }) }, ["a", "b"]));
  mkdirSync(join(root, "shared"));
  host = new FakeHost({ work: { ticks: 5, end: "completed" } });
  await doTick();
  at(1);
  await doTick();
  expect(host.launches.length).toBe(1);
  expect(runState().units.b.session).toBeUndefined();
  expect(count("cwd busy")).toBe(1);
});

// ---- hooks, quiet, stalls, stops, caps ---------------------------------------------------

test("hooks stop at the first non-zero", async () => {
  await arm(recipe({
    work: sess({ outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "done", run: [["true"], ["false"], ["touch", "x"]] }] }),
  }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } });
  await doTick();
  host.advance();
  at(1);
  await doTick();
  const u = runState().units.a;
  expect(u.parked?.reason).toBe("run failed");
  expect(u.stage).toBe("work");
  expect(existsSync(join(root, "w", "a", "x"))).toBe(false);
  expect(existsSync(join(runDir(), "x"))).toBe(false);
  expect(claimFiles()).toEqual([]);
});

test("control: hooks that all pass move the unit", async () => {
  await arm(recipe({
    work: sess({ outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "done", run: [["true"], ["touch", "x"]] }] }),
  }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } });
  await doTick();
  host.advance();
  at(1);
  await doTick();
  expect(runState().units.a.stage).toBe("done");
  expect(existsSync(join(root, "w", "a", "x"))).toBe(true);
});

test("completed without an outcome waits, then counts one no-result", async () => {
  await arm(recipe({ work: sess({ settle_minutes: 10, watch: ["{run.dir}/out"] }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed" } });
  await doTick();
  host.advance();
  at(1);
  await doTick(); // completed, nothing matched: quiet from here
  at(9);
  const r9 = await doTick();
  expect(r9.transitioned).toEqual([]);
  expect(count("no-result")).toBe(0);
  expect(host.launches.length).toBe(1);
  expect(claimFiles().length).toBe(1);
  at(11);
  await doTick();
  expect(count("no-result")).toBe(1);
  expect(host.launches.length).toBe(2);
  expect(runState().units.a.launches.work).toBe(2);
});

test("completed without an outcome: a write under watch restarts the window", async () => {
  await arm(recipe({ work: sess({ settle_minutes: 10, watch: ["{run.dir}/out"] }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed" } });
  await doTick();
  host.advance();
  at(1);
  await doTick();
  at(8);
  mkdirSync(join(runDir(), "out"), { recursive: true });
  writeFileSync(join(runDir(), "out", "progress.txt"), "still going");
  at(9);
  await doTick();
  at(11);
  await doTick();
  expect(count("no-result")).toBe(0);
  expect(host.launches.length).toBe(1);
  at(19);
  await doTick();
  expect(count("no-result")).toBe(1);
});

test("a no-result at max_launches parks no result", async () => {
  await arm(recipe({ work: sess({ settle_minutes: 1, max_launches: 1 }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed" } });
  await doTick();
  host.advance();
  at(1);
  await doTick();
  at(2);
  await doTick();
  expect(runState().units.a.parked?.reason).toBe("no result");
  expect(claimFiles()).toEqual([]);
});

test("stall interrupts, releases, and parks at two", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  await doTick();
  at(1);
  await doTick(); // first status: the progress mark is set
  at(45);
  await doTick();
  expect(count("stall")).toBe(0);
  at(46);
  const r = await doTick();
  expect(count("stall")).toBe(1);
  expect(host.interrupts.map((i) => i.threadId)).toEqual(["thread-1"]);
  expect(host.releases.length).toBe(1);
  expect(claimFiles()).toEqual([]);
  expect(r.launched).toEqual([]); // relaunch waits for the next tick
  expect(runState().units.a.parked).toBeUndefined();
  at(47);
  await doTick();
  expect(host.launches.length).toBe(2);
  at(48);
  await doTick();
  at(93);
  await doTick();
  const u = runState().units.a;
  expect(u.stalls).toBe(2);
  expect(u.parked?.reason).toBe("stalled");
  expect(host.interrupts.length).toBe(2);
  expect(host.releases.length).toBe(2);
  expect(notifyLines().length).toBe(1);
  expect(claimFiles()).toEqual([]);
});

test("stop file parks only that unit", async () => {
  await arm(recipe({ work: sess({ stop_file: "{run.dir}/stop/{unit.id}" }) }, ["a", "b"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  await doTick();
  mkdirSync(join(runDir(), "stop"), { recursive: true });
  writeFileSync(join(runDir(), "stop", "a"), "");
  at(1);
  await doTick();
  const run = runState();
  expect(run.units.a.parked?.reason).toBe("stop");
  expect(run.units.a.session).toBeUndefined();
  expect(host.interrupts.map((i) => i.threadId)).toEqual(["thread-1"]);
  expect(run.units.b.parked).toBeUndefined();
  expect(run.units.b.session?.thread_id).toBe("thread-2");
  expect(liveClaim(claimKey(join(root, "w", "a")))).toBeNull();
  expect(liveClaim(claimKey(join(root, "w", "b")))).toBe("r1/b/work/1");
  expect(notifyLines().length).toBe(1);
});

test("cap parks at max_launches before running before", async () => {
  const before = join(root, "before.log");
  await arm(recipe({
    work: sess({ max_launches: 1, stall_minutes: 1, before: [["sh", "-c", `echo {unit.id} >> ${before}`]] }),
  }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  await doTick();
  at(1);
  await doTick();
  at(2);
  await doTick(); // stall 1: relaunch is due next tick
  expect(count("stall")).toBe(1);
  at(3);
  await doTick();
  expect(runState().units.a.parked?.reason).toBe("cap");
  expect(lines(before)).toEqual(["a"]);
  expect(host.launches.length).toBe(1);
  // unpark resets the count, never the nonce sequence
  expect(await main(["unpark", "r1", "a"])).toBe(0);
  at(4);
  await doTick();
  expect(host.launches.length).toBe(2);
  expect(host.launches[1].request.nonce).toBe("r1/a/work/2");
});

test("a failed thread counts the attempt and relaunches", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "failed" } });
  await doTick();
  host.advance();
  at(1);
  await doTick();
  expect(host.releases.length).toBe(1);
  expect(host.launches.length).toBe(2);
  expect(runState().units.a.launches.work).toBe(2);
});

test("an interrupted thread keeps its claim and directory through the settle window, then counts one no-result", async () => {
  await arm(recipe({ work: sess({ settle_minutes: 10, watch: ["{run.dir}/out"] }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "interrupted" } });
  host.bindDir = (_p, cwd, nonce) => {
    const d = join(root, "launch", nonce.replaceAll("/", "_"));
    mkdirSync(d, { recursive: true });
    return d;
  };
  await doTick();
  host.advance();
  at(1);
  const r1 = await doTick(); // interrupted, no outcome yet: quiet from here
  expect(r1.launched).toEqual([]);
  expect(count("thread failed")).toBe(0);
  at(9);
  await doTick();
  expect(host.releases).toEqual([]);
  expect(host.launches.length).toBe(1);
  expect(claimFiles().length).toBe(1);
  expect(runState().units.a.session?.thread_id).toBe("thread-1");
  expect(count("no-result")).toBe(0);
  at(11);
  await doTick();
  expect(count("no-result")).toBe(1);
  expect(host.releases.length).toBe(1);
  expect(host.launches.length).toBe(2);
});

test("an interrupted thread whose outcome is met moves on, like a completed one", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "interrupted", writes: [DONE_WRITE()] } });
  await doTick();
  host.advance();
  at(1);
  await doTick();
  expect(runState().units.a.stage).toBe("done");
  expect(host.launches.length).toBe(1);
});

test("control: a failed thread with the same setup releases and relaunches at once", async () => {
  await arm(recipe({ work: sess({ settle_minutes: 10, watch: ["{run.dir}/out"] }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "failed" } });
  await doTick();
  host.advance();
  at(1);
  await doTick();
  expect(count("thread failed")).toBe(1);
  expect(host.releases.length).toBe(1);
  expect(host.launches.length).toBe(2);
});

test("claim removed on every exit path", async () => {
  const key = (u: string) => claimKey(join(root, "w", u));
  // outcome
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } });
  await doTick();
  expect(liveClaim(key("a"))).not.toBeNull();
  host.advance();
  at(1);
  await doTick();
  expect(runState().units.a.stage).toBe("done");
  expect(existsSync(claimPath(key("a")))).toBe(false);
  // park (stop)
  fresh();
  await arm(recipe({ work: sess({ stop_file: "{run.dir}/stop" }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  await doTick();
  expect(liveClaim(key("a"))).not.toBeNull();
  writeFileSync(join(runDir(), "stop"), "");
  await doTick();
  expect(runState().units.a.parked?.reason).toBe("stop");
  expect(existsSync(claimPath(key("a")))).toBe(false);
  // stall
  fresh();
  await arm(recipe({ work: sess({ stall_minutes: 1 }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  await doTick();
  at(1);
  await doTick();
  at(2);
  await doTick();
  expect(count("stall")).toBe(1);
  expect(existsSync(claimPath(key("a")))).toBe(false);
  // failed launch
  fresh();
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  failNextLaunch(new LaunchError("refused"), false);
  await doTick();
  expect(count("launch failed")).toBe(1);
  expect(existsSync(claimPath(key("a")))).toBe(false);
  // disarm
  fresh();
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  await doTick();
  expect(liveClaim(key("a"))).not.toBeNull();
  expect(await main(["disarm", "r1"])).toBe(0);
  expect(existsSync(claimPath(key("a")))).toBe(false);
  expect(claimFiles()).toEqual([]);
});

// ---- host failures ---------------------------------------------------------------------

test("host outage leaves units untouched", async () => {
  await arm(recipe({ work: sess() }, ["a", "b", "c"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  await doTick();
  const before = runBytes();
  const evBefore = kinds().length;
  host.down = "unreachable";
  at(1);
  const r = await doTick();
  expect(exitCode(r)).toBe(4);
  expect(runBytes()).toBe(before);
  expect(kinds().length).toBe(evBefore);
  expect(notifyLines()).toEqual([]); // not yet 30 minutes
  at(20);
  await doTick();
  expect(notifyLines()).toEqual([]);
  at(32);
  await doTick();
  expect(notifyLines().length).toBe(1);
  expect(runBytes()).toBe(before);
});

test("auth error notifies once per day", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  host.down = "auth";
  const before = runBytes();
  expect(exitCode(await doTick())).toBe(3);
  at(60);
  expect(exitCode(await doTick())).toBe(3);
  expect(notifyLines().length).toBe(1);
  expect(notifyLines()[0]).toContain("t3 token rejected — run baton t3 login");
  expect(runBytes()).toBe(before);
  at(24 * 60);
  await doTick();
  expect(notifyLines().length).toBe(2);
});

test("a launch whose request cannot render parks with nothing bound and no claim written", async () => {
  for (const field of ["title", "instance", "model", "message"]) {
    fresh();
    await arm(recipe({ work: sess({ [field]: "x {pr.head}" }) }, ["a"]));
    host = new FakeHost({ work: { ticks: 100, end: "completed" } });
    let binds = 0;
    host.bindDir = (_p, cwd) => { binds++; return cwd; };
    await doTick();
    const u = runState().units.a;
    expect(u.parked?.reason).toContain("no pr in scope");
    expect(u.session).toBeUndefined();
    expect(binds).toBe(0);
    expect(claimFiles()).toEqual([]);
    expect(host.launches).toHaveLength(0);
  }
  // a record lacking a var the message uses parks the same way
  fresh();
  const rec = sourced();
  (rec.stages.work as { message: string }).message = "Do {unit.vars.task}";
  await arm(rec);
  mkdirSync(join(root, "w", "a"), { recursive: true });
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  let binds = 0;
  host.bindDir = (_p, cwd) => { binds++; return cwd; };
  record("a.json", { id: "a", group: 1, order: 1 });
  await doTick();
  expect(runState().units.a.parked?.reason).toContain('unknown unit var "task"');
  expect(binds).toBe(0);
  expect(claimFiles()).toEqual([]);
  // control: with the var present it renders, binds, claims and launches
  record("a.json", { id: "a", group: 1, order: 1, task: "t" });
  expect(await main(["unpark", "r1", "a"])).toBe(0);
  await doTick();
  expect(binds).toBe(1);
  expect(claimFiles()).toHaveLength(1);
  expect(host.launches.map((l) => l.request.message)).toEqual(["Do t"]);
});

// ---- sources -------------------------------------------------------------------------

function sourced(waitOutcomes?: unknown[]) {
  const stages: Record<string, unknown> = waitOutcomes
    ? { hold: { kind: "wait", outcomes: waitOutcomes } }
    : { work: sess() };
  return {
    version: 1, name: "rec", params: ["root"], seed: [], stages,
    sources: [{
      dir: "{run.dir}/queue", id_key: "id", group_key: "group", order_key: "order",
      vars: { task: "task" }, stage: Object.keys(stages)[0],
    }],
  };
}
const record = (file: string, body: unknown) => {
  mkdirSync(join(runDir(), "queue"), { recursive: true });
  writeFileSync(join(runDir(), "queue", file), typeof body === "string" ? body : JSON.stringify(body));
};

test("invalid record parks the run with the file name", async () => {
  await arm(sourced());
  mkdirSync(join(root, "w", "a"), { recursive: true });
  mkdirSync(join(root, "w", "b"), { recursive: true });
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  record("a.json", { id: "a", group: 1, order: 1, task: "x" });
  record("b.json", "{not json");
  const r = await doTick();
  let run = runState();
  expect(run.status).toBe("parked");
  expect(run.parked?.reason).toBe("invalid record b.json");
  expect(run.units).toEqual({});
  expect(r.launched).toEqual([]);
  expect(notifyLines().length).toBe(1);
  // A record without its order key parks the same way.
  record("b.json", { id: "b", group: 1, task: "y" });
  expect(await main(["unpark", "r1"])).toBe(0);
  await doTick();
  expect(runState().status).toBe("parked");
  expect(runState().units).toEqual({});
  // Fixed and unparked: the run resumes.
  record("b.json", { id: "b", group: 1, order: 2, task: "y" });
  expect(await main(["unpark", "r1"])).toBe(0);
  await doTick();
  run = runState();
  expect(run.status).toBe("armed");
  expect(Object.keys(run.units).sort()).toEqual(["a", "b"]);
  expect(run.units.b.group).toBe(1);
  expect(run.units.b.order).toBe(2);
  expect(run.units.a.vars).toEqual({ task: "x" });
  expect(host.launches.length).toBe(2);
});

test("a record whose id names an Object.prototype member is an invalid record", async () => {
  for (const id of ["toString", "__proto__", "constructor"]) {
    fresh();
    await arm(sourced());
    host = new FakeHost({ work: { ticks: 100, end: "completed" } });
    record("a.json", { id, group: 1, order: 1, task: "x" });
    await doTick();
    const run = runState();
    expect(run.status).toBe("parked");
    expect(run.parked?.reason).toBe("invalid record a.json");
    expect(Object.getOwnPropertyNames(run.units)).toEqual([]);
    expect(({} as Record<string, unknown>).record_seen).toBeUndefined(); // Object.prototype untouched
  }
  // adjacent control: an ordinary id that only contains such a name is a unit like any other
  fresh();
  await arm(sourced());
  mkdirSync(join(root, "w", "toStrings"), { recursive: true });
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  record("a.json", { id: "toStrings", group: 1, order: 1, task: "x" });
  await doTick();
  expect(runState().status).toBe("armed");
  expect(Object.keys(runState().units)).toEqual(["toStrings"]);
});

test("a rewritten record updates a known unit's vars and keeps its group and order", async () => {
  await arm(sourced([{ when: [{ file: "{run.dir}/never" }], to: "done" }]));
  host = new FakeHost({});
  record("a.json", { id: "a", group: 1, order: 1, task: "x" });
  await doTick();
  expect(runState().units.a.vars).toEqual({ task: "x" });
  record("a.json", { id: "a", group: 5, order: 9, task: "x, answered" });
  await doTick();
  const u = runState().units.a;
  expect(u.vars).toEqual({ task: "x, answered" });
  expect(u.group).toBe(1);
  expect(u.order).toBe(1);
  // control: an unchanged record leaves vars as they are
  await doTick();
  expect(runState().units.a.vars).toEqual({ task: "x, answered" });
});

test("record_changed is true only after a new digest", async () => {
  await arm(sourced([{ when: [{ record_changed: true }], to: "done" }]));
  host = new FakeHost({});
  record("a.json", { id: "a", group: 1, order: 1, task: "x" });
  await doTick();
  expect(runState().units.a.stage).toBe("hold");
  expect(runState().units.a.record_seen).toBe(runState().units.a.record_at_entry);
  record("a.json", { id: "a", group: 1, order: 1, task: "x" }); // same bytes
  await doTick();
  expect(runState().units.a.stage).toBe("hold");
  record("a.json", { id: "a", group: 1, order: 1, task: "x, again" });
  const r = await doTick();
  expect(r.transitioned).toEqual(["a"]);
  const u = runState().units.a;
  expect(u.stage).toBe("done");
  expect(u.record_at_entry).toBe(u.record_seen);
});

test("seed units take group 0", async () => {
  await arm(recipe({ work: sess({ title: "g{run.group}" }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  await doTick();
  expect(runState().units.a.group).toBe(0);
  expect(host.launches[0].request.title).toBe("g0 [baton r1/a/work/1]");
});

test("run.group is the highest group seen", async () => {
  const rec = sourced();
  (rec.stages.work as { title: string }).title = "g{run.group}";
  await arm(rec);
  mkdirSync(join(root, "w", "a"), { recursive: true });
  mkdirSync(join(root, "w", "b"), { recursive: true });
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  record("a.json", { id: "a", group: 3, order: 1 });
  record("b.json", { id: "b", group: 1, order: 1 });
  await doTick();
  expect(host.launches.map((l) => l.request.title)).toEqual(["g3 [baton r1/b/work/1]", "g3 [baton r1/a/work/1]"]);
});

test("a unit enters one stage per tick: a wait whose outcome already matches reads next tick", async () => {
  await arm(recipe({
    work: sess({ outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "gate" }] }),
    gate: { kind: "wait", outcomes: [{ when: [{ file: "{run.dir}/go" }], to: "done" }] },
  }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } });
  writeFileSync(join(runDir(), "go"), "ok"); // the gate's outcome matches before the unit reaches it
  await doTick();
  host.advance();
  await doTick(); // step 3 moves a into gate; step 4 does not read it again this tick
  expect(runState().units.a.stage).toBe("gate");
  await doTick(); // control: the next tick reads it
  expect(runState().units.a.stage).toBe("done");
});

test("every unit done marks the run done and notifies once", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } });
  await doTick();
  host.advance();
  at(1);
  await doTick();
  expect(runState().status).toBe("done");
  expect(count("done")).toBe(1);
  at(2);
  await doTick();
  expect(count("done")).toBe(1);
  expect(notifyLines().length).toBe(1);
});

// ---- the lock and the CLI ------------------------------------------------------------------

test("busy lock returns at once", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  writeFileSync(join(state, "lock"), "1"); // pid 1 is always alive
  const before = runBytes();
  const r = await doTick();
  expect(r).toEqual({ launched: [], transitioned: [], parked: [], merged: [], errors: [] });
  expect(exitCode(r)).toBe(0);
  expect(host.launches.length).toBe(0);
  expect(runBytes()).toBe(before);
  expect(readFileSync(join(state, "lock"), "utf8")).toBe("1");
});

const BIN = join(import.meta.dir, "..", "bin", "baton");
async function cli(...args: string[]) {
  const p = Bun.spawn([BIN, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const [out, err, rc] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, rc };
}

test("baton tick: busy is rc 0, and a token near expiry notifies once per day", async () => {
  const token = join(root, "token.json");
  writeFileSync(token, JSON.stringify({ access_token: "secret-value", expires_at: Math.floor(Date.now() / 1000) + 86_400, scope: "s" }));
  chmodSync(token, 0o600);
  writeFileSync(join(root, "config.json"), JSON.stringify({ t3: { tokenFile: token } }));
  mkdirSync(state, { recursive: true });
  let r = await cli("tick");
  expect(r.rc).toBe(0);
  r = await cli("tick");
  expect(r.rc).toBe(0);
  expect(notifyLines().length).toBe(1);
  expect(notifyLines()[0]).toContain("expires");
  expect(readFileSync(join(state, "notify.log"), "utf8")).not.toContain("secret-value");
  expect(r.out + r.err).not.toContain("secret-value");
  writeFileSync(join(state, "lock"), "1");
  expect((await cli("tick")).rc).toBe(0);
  expect((await cli("tick", "--run")).rc).toBe(64);
});
