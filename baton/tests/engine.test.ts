import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { claimKey, claimPath, liveClaim } from "../src/claims.ts";
import { main } from "../src/cli.ts";
import { exitCode, tick, type TickReport } from "../src/engine.ts";
import type { Forge } from "../src/forge.ts";
import { HostDownError, LaunchError, type LaunchRequest } from "../src/host.ts";
import { setHostForTest } from "../src/hosts/select.ts";
import { notifyOnce } from "../src/notify.ts";
import { openStore, type RunState } from "../src/state.ts";
import { FakeForge } from "./fake-forge.ts";
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

test("a nonce the host never saw is relaunched after 2 minutes", async () => {
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
  // Every launch is an unknown outcome and the host never lists a thread for the nonce.
  host.launch = async () => { throw new HostDownError("launch outcome unknown: bad model"); };
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
  launchDirBind(projRoot);
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

/** A FakeHost bind that, like OrcaHost's, gives a root-`cwd` worktree stage its own launch directory. */
function launchDirBind(projRoot: string) {
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
  launchDirBind(projRoot);
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
  launchDirBind(projRoot);
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

// A failed hook's park names it (#906): the reason stays the same, the event carries the hook's
// 1-based index and rendered argv, and the notice ends with them, as a merge park ends with its PR.
const lastPark = () => events().filter((e) => e.kind === "park").at(-1);

test("a before failed park names the failing hook in its event and at the end of its notice", async () => {
  await arm(recipe({ work: sess({ before: [["true"], ["sh", "-c", "exit 3", "{unit.id}"]] }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed" } });
  await doTick();
  expect(host.launches.length).toBe(0);
  const e = lastPark();
  expect(e.reason).toBe("before failed");
  expect(e.hook).toBe(2);
  expect(e.argv).toEqual(["sh", "-c", "exit 3", "a"]);
  expect(notifyLines().length).toBe(1);
  expect(notifyLines()[0].endsWith("baton r1/a parked in work: before failed — hook 2 (sh)")).toBe(true);
});

test("a run failed park and an after_launch failed park name their hook too", async () => {
  await arm(recipe({
    work: sess({ outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "done", run: [["false"]] }] }),
    late: sess({ after_launch: [["true"], ["true"], ["sh", "-c", "exit 1"]] }),
  }, ["a", "b"], { seed: [{ id: "a", stage: "work" }, { id: "b", stage: "late" }] }));
  mkdirSync(join(root, "w", "b"), { recursive: true });
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] }, late: { ticks: 100, end: "completed" } });
  await doTick();
  host.advance();
  at(1);
  await doTick();
  const parks = events().filter((e) => e.kind === "park");
  expect(parks.map((e) => [e.unit, e.reason, e.hook, e.argv])).toEqual([
    ["b", "after_launch failed", 3, ["sh", "-c", "exit 1"]],
    ["a", "run failed", 1, ["false"]],
  ]);
  expect(notifyLines().map((l) => l.slice(l.indexOf(" baton ") + 1))).toEqual([
    "baton r1/b parked in late: after_launch failed — hook 3 (sh)",
    "baton r1/a parked in work: run failed — hook 1 (false)",
  ]);
});

test("a hook's arguments stay in the event and never reach the notice", async () => {
  const secret = "token-" + "x".repeat(40);
  await arm(recipe({ work: sess({ before: [["/usr/bin/sh", "-c", `exit 1 # ${secret}`]] }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed" } });
  await doTick();
  expect(lastPark().argv).toEqual(["/usr/bin/sh", "-c", `exit 1 # ${secret}`]);
  expect(notifyLines()[0].endsWith("before failed — hook 1 (sh)")).toBe(true);
  expect(notifyLines()[0]).not.toContain(secret);
});

test("control: a park with no failed hook carries no hook field and no hook suffix", async () => {
  await arm(recipe({ work: sess({ stop_file: "{run.dir}/stop/{unit.id}", before: [["true"]] }) }, ["a"]));
  mkdirSync(join(runDir(), "stop"), { recursive: true });
  writeFileSync(join(runDir(), "stop", "a"), "halt");
  host = new FakeHost({ work: { ticks: 1, end: "completed" } });
  await doTick();
  const e = lastPark();
  expect(e.reason).toBe("stop");
  expect("hook" in e || "argv" in e).toBe(false);
  expect(notifyLines()[0].endsWith("parked in work: stop")).toBe(true);
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

/** `work` ends on its done file (removed by its hook) and goes to `cool`, which returns to `work` until `<run>/stop` exists. */
function cycling(work: Record<string, unknown> = {}) {
  return recipe({
    work: sess({
      outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "cool", run: [["rm", "-f", "{run.dir}/out/{unit.id}.done"]] }],
      ...work,
    }),
    cool: { kind: "wait", outcomes: [{ when: [{ file: "{run.dir}/stop" }], to: "done" }, { when: [{ absent: "{run.dir}/stop" }], to: "work" }] },
  }, ["a"]);
}

test("a stage re-entered starts a fresh launch count: a cycling recipe is not capped by earlier visits", async () => {
  await arm(cycling({ max_launches: 1 }));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } });
  for (let m = 0; m < 12 && host.launches.length < 4; m++) {
    at(m);
    await doTick();
    host.advance();
  }
  const u = runState().units.a;
  expect(u.parked).toBeUndefined();
  expect(host.launches.length).toBe(4);
  // control: the nonce sequence is never reset, so each visit's launch has a fresh nonce
  expect(host.launches.map((l) => l.request.nonce)).toEqual(["r1/a/work/1", "r1/a/work/2", "r1/a/work/3", "r1/a/work/4"]);
  expect(u.seq?.work).toBe(4);
});

test("control: within one visit the launch count still caps", async () => {
  await arm(cycling({ max_launches: 2 }));
  host = new FakeHost({ work: { ticks: 1, end: "failed" } });
  for (let m = 0; m < 6; m++) {
    at(m);
    await doTick();
    host.advance();
  }
  const u = runState().units.a;
  expect(u.parked?.reason).toBe("thread failed");
  expect(host.launches.length).toBe(2);
});

test("a stall in one stage does not count toward a stall in the next", async () => {
  await arm(recipe({
    one: sess({ stall_minutes: 1, outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.one" }], to: "two" }] }),
    two: sess({ stall_minutes: 1 }),
  }, ["a"]));
  host = new FakeHost({ one: { ticks: 100, end: "completed" }, two: { ticks: 100, end: "completed" } });
  await doTick(); // one: thread-1
  at(1);
  await doTick(); // first status sets the progress mark
  at(3);
  await doTick(); // stall 1 in one
  expect(count("stall")).toBe(1);
  host.script.one = { ticks: 1, end: "completed", writes: [{ path: join(runDir(), "out", "{unit}.one"), content: "ok" }] };
  at(4);
  await doTick(); // one relaunches: thread-2
  host.advance();
  at(5);
  await doTick(); // one completes, moves to two
  expect(runState().units.a.stage).toBe("two");
  for (const m of [6, 7, 9]) {
    at(m);
    await doTick();
  }
  expect(count("stall")).toBe(2);
  const u = runState().units.a;
  expect(u.parked).toBeUndefined();
  expect(u.stalls).toBe(1);
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
  expect(notifyLines()[0]).toContain("host auth rejected: host authentication failed");
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

function pinnedRecipe() {
  const rec = sourced();
  Object.assign(rec.stages.work as Record<string, unknown>, { cwd: "{param.root}/{unit.vars.slug}", project: "{unit.vars.project}" });
  rec.sources[0].vars = { slug: "slug", project: "project" };
  return rec;
}

test("a record rewritten mid-session: release targets the project and cwd the session launched with", async () => {
  await arm(pinnedRecipe());
  for (const d of ["s1", "s2"]) mkdirSync(join(root, d), { recursive: true });
  host = new FakeHost({ work: { ticks: 1, end: "failed" } });
  record("a.json", { id: "a", group: 1, order: 1, slug: "s1", project: "p1" });
  await doTick();
  const s = runState().units.a.session!;
  expect([s.project, s.cwd]).toEqual(["p1", join(root, "s1")]);
  record("a.json", { id: "a", group: 1, order: 1, slug: "s2", project: "p2" });
  host.advance();
  at(1);
  await doTick();
  expect(host.releases[0]).toEqual({ project: "p1", cwd: join(root, "s1"), dir: join(root, "s1") });
  // the relaunch follows the rewritten record
  expect(host.launches.map((l) => [l.request.project, l.request.cwd])).toEqual([["p1", join(root, "s1")], ["p2", join(root, "s2")]]);
});

test("a successor after a record rewrite launches in the pinned project, and a refused one releases there", async () => {
  const rec = pinnedRecipe();
  Object.assign(rec.stages.work as Record<string, unknown>, {
    handoff: { file: "{run.dir}/h/{unit.id}", token: "handed-off", message: "resume from {handoff_path}" },
  });
  await arm(rec);
  for (const d of ["s1", "s2"]) mkdirSync(join(root, d), { recursive: true });
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [handoffWrite(1)] } });
  record("a.json", { id: "a", group: 1, order: 1, slug: "s1", project: "p1" });
  await doTick();
  record("a.json", { id: "a", group: 1, order: 1, slug: "s2", project: "p2" });
  host.advance();
  at(2);
  await doTick();
  expect(host.launches.map((l) => l.request.project)).toEqual(["p1", "p1"]);
  const s = runState().units.a.session!;
  expect(s.successor_of).toBe("r1/a/work/1");
  expect([s.project, s.cwd]).toEqual(["p1", join(root, "s1")]);
  expect(s.vars).toEqual({ slug: "s1", project: "p1" }); // the successor inherits the launch's vars
  // a successor the host refuses releases the launched directory in the launched project
  host.advance();
  writeFileSync(join(runDir(), "h", "a"), `${iso(3)} handed-off /tmp/hand2 a.md\n`);
  failNextLaunch(new LaunchError("refused"), false);
  at(4);
  await doTick();
  expect(kinds()).toContain("launch failed");
  expect(host.releases[0]).toEqual({ project: "p1", cwd: join(root, "s1"), dir: join(root, "s1") });
});

test("outcome signals of a rewritten record run in the cwd the session launched in", async () => {
  const rec = pinnedRecipe();
  (rec.stages.work as { outcomes: unknown[] }).outcomes = [
    { when: [{ exit0: ["sh", "-c", `test "$(basename "$PWD")" = s1`] }], to: "done" },
  ];
  await arm(rec);
  for (const d of ["s1", "s2"]) mkdirSync(join(root, d), { recursive: true });
  host = new FakeHost({ work: { ticks: 1, end: "completed" } });
  record("a.json", { id: "a", group: 1, order: 1, slug: "s1", project: "p1" });
  await doTick();
  record("a.json", { id: "a", group: 1, order: 1, slug: "s2", project: "p2" });
  host.advance();
  at(1);
  await doTick();
  expect(runState().units.a.stage).toBe("done");
});

function snapshotRecipe(to = "done") {
  const rec = pinnedRecipe();
  Object.assign(rec.stages.work as Record<string, unknown>, {
    stop_file: "{run.dir}/stop/{unit.vars.slug}",
    watch: ["{run.dir}/watch/{unit.vars.slug}"],
    outcomes: [{ when: [{ file: "{run.dir}/out/{unit.vars.slug}.done" }], to }],
  });
  return rec;
}
async function launchedThenRewritten(rec: unknown, b: { ticks: number; end: "completed" }) {
  await arm(rec);
  for (const d of ["s1", "s2"]) mkdirSync(join(root, d), { recursive: true });
  host = new FakeHost({ work: b });
  record("a.json", { id: "a", group: 1, order: 1, slug: "s1", project: "p1" });
  await doTick();
  record("a.json", { id: "a", group: 1, order: 1, slug: "s2", project: "p2" });
}
const put = (rel: string) => {
  mkdirSync(dirname(join(runDir(), rel)), { recursive: true });
  writeFileSync(join(runDir(), rel), "x");
};

test("a live session reads its stop file from the vars it launched with", async () => {
  await launchedThenRewritten(snapshotRecipe(), { ticks: 100, end: "completed" });
  at(1);
  await doTick(); // reads the rewritten record
  expect(runState().units.a.vars.slug).toBe("s2");
  put("stop/s1");
  at(2);
  await doTick();
  expect(runState().units.a.parked?.reason).toBe("stop");
  expect(runState().units.a.session).toBeUndefined();
});

test("a live session reads its watch paths from the vars it launched with", async () => {
  await launchedThenRewritten(snapshotRecipe(), { ticks: 100, end: "completed" });
  host.advance();
  at(1);
  await doTick();
  const before = runState().units.a.session!.last_progress_at;
  put("watch/s1");
  require("node:fs").utimesSync(join(runDir(), "watch", "s1"), new Date(T0 + 5 * 60_000), new Date(T0 + 5 * 60_000));
  at(3);
  await doTick();
  expect(runState().units.a.session!.last_progress_at).not.toBe(before);
  expect(runState().units.a.session!.last_progress_at).toBe(iso(3));
});

test("a live session reads its outcome file from the vars it launched with; the next launch takes the new vars", async () => {
  await launchedThenRewritten(snapshotRecipe("work"), { ticks: 1, end: "completed" });
  put("out/s1.done");
  host.advance();
  at(1);
  await doTick();
  expect(count("transition")).toBe(1);
  at(2);
  await doTick();
  expect(host.launches.map((l) => [l.request.project, l.request.cwd])).toEqual([["p1", join(root, "s1")], ["p2", join(root, "s2")]]);
  expect(runState().units.a.session!.vars).toEqual({ slug: "s2", project: "p2" });
});

test("a session from older state, without the pinned fields, re-renders project and cwd", async () => {
  await arm(pinnedRecipe());
  mkdirSync(join(root, "s1"), { recursive: true });
  host = new FakeHost({ work: { ticks: 1, end: "failed" } });
  record("a.json", { id: "a", group: 1, order: 1, slug: "s1", project: "p1" });
  await doTick();
  const run = runState();
  delete run.units.a.session!.project;
  delete run.units.a.session!.cwd;
  delete run.units.a.session!.vars; // older state has no vars snapshot either: u.vars apply
  store().writeRun(run);
  host.advance();
  at(1);
  await doTick();
  expect(host.releases[0]).toEqual({ project: "p1", cwd: join(root, "s1"), dir: join(root, "s1") });
});

test("a lost launch response is adopted through the launched project after the record moves", async () => {
  await arm(pinnedRecipe());
  for (const d of ["s1", "s2"]) mkdirSync(join(root, d), { recursive: true });
  host = new FakeHost({ work: { ticks: 100, end: "completed", loseResponse: true } });
  record("a.json", { id: "a", group: 1, order: 1, slug: "s1", project: "p1" });
  await doTick();
  expect(runState().units.a.session?.thread_id).toBeUndefined();
  record("a.json", { id: "a", group: 1, order: 1, slug: "s2", project: "p2" });
  // The host does not list the thread yet on the next tick, which also reads the rewritten record.
  const find = host.findByNonce.bind(host);
  const asked: string[] = [];
  let hidden = 1;
  host.findByNonce = async (project, n) => { asked.push(project); return hidden-- > 0 ? [] : find(project, n); };
  at(1);
  await doTick();
  expect(runState().units.a.vars.project).toBe("p2");
  at(2);
  await doTick();
  expect(asked).toEqual(["p1", "p1"]);
  const u = runState().units.a;
  expect(u.session?.thread_id).toBe("thread-1");
  expect(kinds()).toContain("adopted");
  expect(host.launches).toHaveLength(1);
  expect(host.releases).toEqual([]);
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

const PR = "https://github.com/o/r/pull/7";
function mergedForge(): FakeForge {
  const f = new FakeForge();
  f.views.set(PR, { state: "MERGED", head: "abc123", base: "main", mergeable: "MERGEABLE", checks: "green" });
  return f;
}
const prOutcome = (to: string) => ({
  when: [{ pr: { url: ["echo", PR], test: "merged" } }], to,
  run: [["touch", "{run.dir}/hook-{pr.head}"]], notify: "landed {pr.url} at {pr.head}",
});

test("a wait outcome's run hooks and notify render the pr its signal read", async () => {
  await arm(recipe({ gate: { kind: "wait", outcomes: [prOutcome("done")] } }, ["a"]));
  host = new FakeHost({});
  await doTick({ forge: mergedForge() });
  expect(runState().units.a.parked).toBeUndefined();
  expect(runState().units.a.stage).toBe("done");
  expect(existsSync(join(runDir(), "hook-abc123"))).toBe(true);
  expect(notifyLines().some((l) => l.includes(`landed ${PR} at abc123`))).toBe(true);
});

test("a session outcome's run hooks and notify render the pr its signal read", async () => {
  await arm(recipe({ work: sess({ outcomes: [prOutcome("done")] }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed" } });
  const forge = mergedForge();
  await doTick({ forge });
  host.advance();
  at(1);
  await doTick({ forge });
  expect(runState().units.a.parked).toBeUndefined();
  expect(runState().units.a.stage).toBe("done");
  expect(existsSync(join(runDir(), "hook-abc123"))).toBe(true);
  expect(notifyLines().some((l) => l.includes(`landed ${PR} at abc123`))).toBe(true);
});

test("control: an outcome with no pr signal cannot render {pr.url}, and parks where it was, unmoved", async () => {
  await arm(recipe({
    gate: { kind: "wait", outcomes: [{ when: [{ file: "{run.dir}/go" }], to: "next", notify: "moved {pr.url}" }] },
    next: { kind: "wait", outcomes: [{ when: [{ file: "{run.dir}/never" }], to: "done" }] },
  }, ["a"]));
  host = new FakeHost({});
  writeFileSync(join(runDir(), "go"), "ok");
  await doTick({ forge: mergedForge() });
  const u = runState().units.a;
  expect(u.stage).toBe("gate");
  expect(u.parked?.reason).toBe("error: no pr in scope");
  expect(count("transition")).toBe(0);
});

test("a pr read by an outcome that did not match never reaches the outcome that did", async () => {
  await arm(recipe({
    gate: {
      kind: "wait",
      outcomes: [
        { when: [{ pr: { url: ["echo", PR], test: "open" } }], to: "done" }, // reads the PR, MERGED: no match
        { when: [{ file: "{run.dir}/go" }], to: "done", run: [["touch", "{run.dir}/hook-{pr.head}"]], notify: "moved {pr.url}" },
      ],
    },
  }, ["a"]));
  host = new FakeHost({});
  writeFileSync(join(runDir(), "go"), "ok");
  await doTick({ forge: mergedForge() });
  const u = runState().units.a;
  expect(u.stage).toBe("gate");
  expect(u.parked?.reason).toBe("error: no pr in scope");
  expect(existsSync(join(runDir(), "hook-abc123"))).toBe(false);
  expect(notifyLines().some((l) => l.includes(PR))).toBe(false);
});

test("a notice that cannot render parks before any hook runs or the session ends", async () => {
  await arm(recipe({
    work: sess({ outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "done", run: [["touch", "{run.dir}/hook"]], notify: "moved {pr.url}" }] }),
  }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } });
  await doTick();
  host.advance();
  at(1);
  await doTick();
  const u = runState().units.a;
  expect(u.stage).toBe("work");
  expect(u.parked?.reason).toBe("error: no pr in scope");
  expect(existsSync(join(runDir(), "hook"))).toBe(false);
  expect(count("transition")).toBe(0);
  // the park, not the outcome, ends the session: one release, the claim gone
  expect(host.releases.length).toBe(1);
  expect(claimFiles()).toEqual([]);
});

test("unpark --to enters the stage as a move does: a record seen before the entry is not a change", async () => {
  await arm(recipe({
    work: sess(),
    gate: { kind: "wait", outcomes: [{ when: [{ record_changed: true }], to: "done" }] },
  }, ["a"]));
  const run = runState();
  Object.assign(run.units.a, { record_seen: "d2", record_at_entry: "d1", cwd_busy: "x", parked: { reason: "stop", at: "t" } });
  store().writeRun(run);
  expect(await main(["unpark", "r1", "a", "--to", "gate"])).toBe(0);
  host = new FakeHost({});
  await doTick();
  await doTick();
  const u = runState().units.a;
  expect(u.stage).toBe("gate");
  expect(u.record_at_entry).toBe("d2");
  expect(u.cwd_busy).toBeUndefined();
  // control: a record rewritten after the entry still reads as changed
  const r2 = runState();
  r2.units.a.record_seen = "d3";
  store().writeRun(r2);
  await doTick();
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

test("baton tick: busy is rc 0, and a bad argument is usage", async () => {
  mkdirSync(state, { recursive: true });
  expect((await cli("tick")).rc).toBe(0);
  writeFileSync(join(state, "lock"), "1");
  expect((await cli("tick")).rc).toBe(0);
  expect((await cli("tick", "--run")).rc).toBe(64);
});

test("notify argv renders {key} and {message}", async () => {
  const out = join(root, "argv.json");
  const script = join(root, "fake-notify.sh");
  writeFileSync(script, `#!/bin/sh\nprintf '%s\\n%s\\n' "$1" "$2" > "${out}"\n`, { mode: 0o755 });
  writeFileSync(join(root, "config.json"), JSON.stringify({ notify: [script, "{key}", "{message}"] }));
  await arm(recipe({ work: sess() }, ["u1"]));
  host = new FakeHost({ work: { ticks: 5, end: "completed" } });
  host.launch = async () => { throw new HostDownError("launch outcome unknown: bad model"); };
  for (let i = 0; i < 12 && !runState().units.u1.parked; i++) {
    at(i * 1.5);
    await doTick();
  }
  const [key, msg] = readFileSync(out, "utf8").trim().split("\n");
  expect(key).toMatch(/^r1\/u1\/park\/\d{4}-/);
  expect(msg).toBe("baton r1/u1 parked in work: cap");
});

// ---- host leftovers and the thread gone note (#930) ----------------------------------------

test("a run that finishes asks the host once to drop what it keeps for the run", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } });
  const ended: string[] = [];
  host.endRun = async (id) => { ended.push(id); };
  await doTick();
  expect(ended).toEqual([]); // not done yet
  host.advance();
  at(1);
  await doTick();
  expect(runState().status).toBe("done");
  expect(ended).toEqual(["r1"]);
  at(2);
  await doTick();
  expect(ended).toEqual(["r1"]);
});

test("a host error at endRun leaves the run armed: the next tick retries it", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed", writes: [DONE_WRITE()] } });
  let fail = true;
  const ended: string[] = [];
  host.endRun = async (id) => {
    if (fail) throw new HostDownError("orca unreachable");
    ended.push(id);
  };
  await doTick();
  host.advance();
  at(1);
  await doTick();
  expect(runState().status).toBe("armed");
  fail = false;
  at(2);
  await doTick();
  expect(runState().status).toBe("done");
  expect(ended).toEqual(["r1"]);
});

test("disarm asks the host to drop what it keeps for the run", async () => {
  await arm(recipe({ work: sess() }, ["a"]));
  host = new FakeHost({ work: { ticks: 100, end: "completed" } });
  const ended: string[] = [];
  host.endRun = async (id) => { ended.push(id); };
  await doTick();
  setHostForTest(host);
  try {
    expect(await main(["disarm", "r1"])).toBe(0);
  } finally {
    setHostForTest(null);
  }
  expect(ended).toEqual(["r1"]);
  expect(runState().status).toBe("disarmed");
});

test("a thread gone park ends its notice with the host's gone note; a host with none adds nothing", async () => {
  for (const note of ["see /s/claims/seat.log", undefined]) {
    fresh();
    await arm(recipe({ work: sess({ max_launches: 1 }) }, ["a"]));
    host = new FakeHost({ work: { ticks: 100, end: "completed" } });
    if (note) host.goneNote = () => note;
    await doTick();
    host.drop("thread-1");
    at(1);
    await doTick();
    expect(runState().units.a.parked?.reason).toBe("thread gone");
    const want = `baton r1/a parked in work: thread gone${note ? ` — ${note}` : ""}`;
    expect([note, notifyLines()[0].endsWith(want)]).toEqual([note, true]);
  }
});

test("control: the gone note is only on a thread gone park", async () => {
  await arm(recipe({ work: sess({ before: [["false"]] }) }, ["a"]));
  host = new FakeHost({ work: { ticks: 1, end: "completed" } });
  host.goneNote = () => "see seat.log";
  await doTick();
  expect(notifyLines()[0]).not.toContain("seat.log");
});
