// The relay recipe, end to end: the real engine, the fake host, a temp git repo with a bare
// origin. The planner and the workers are scripts and callbacks; the recipe names no workflow.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/cli.ts";
import { tick } from "../src/engine.ts";
import type { PrView } from "../src/forge.ts";
import { openStore, type RunState } from "../src/state.ts";
import { commit, FakeForge, git } from "./fake-forge.ts";
import { type Behaviour, FakeHost } from "./fake-host.ts";

const RELAY = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "recipes", "relay.json");
const T0 = Date.parse("2026-10-22T10:00:00.000Z");
const saved = { state: process.env.BATON_STATE_DIR, config: process.env.BATON_CONFIG, home: process.env.HOME };
let root: string, state: string, project: string, repo: string, origin: string, other: string, runDir: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "baton-e2e-")));
  state = join(root, "state");
  project = join(root, "project");
  mkdirSync(join(root, "home"));
  mkdirSync(project);
  process.env.BATON_STATE_DIR = state;
  process.env.BATON_CONFIG = join(root, "config.json");
  process.env.HOME = join(root, "home");
  origin = join(root, "origin.git");
  repo = join(root, "repo");
  other = join(root, "other");
  git(root, "init", "--bare", "-b", "main", origin);
  git(root, "clone", origin, repo);
  git(root, "clone", origin, other);
  for (const d of [repo, other]) {
    git(d, "config", "user.email", "t@example.com");
    git(d, "config", "user.name", "t");
    git(d, "config", "commit.gpgsign", "false");
  }
  commit(repo, "init");
  git(repo, "push", "origin", "main");
  git(other, "pull", "origin", "main");
  runDir = join(state, "runs", "r1");
});
afterEach(() => {
  for (const [k, v] of [["BATON_STATE_DIR", saved.state], ["BATON_CONFIG", saved.config], ["HOME", saved.home]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const url = (unit: string) => `https://github.com/o/r/pull/${unit === "a" ? 1 : 2}`;
const open: PrView = { state: "OPEN", head: "pending", base: "main", mergeable: "MERGEABLE", checks: "green" };

/** A forge whose merge lands a real merge commit on the bare origin, then reads MERGED. */
class LandingForge extends FakeForge {
  constructor() {
    super();
    for (const u of ["a", "b"]) this.views.set(url(u), { ...open });
  }
  override async merge(prUrl: string, head: string): Promise<void> {
    await super.merge(prUrl, head);
    const name = prUrl.endsWith("/1") ? "a" : "b";
    git(other, "pull", "origin", "main");
    git(other, "checkout", "-b", `pr-${name}`);
    const branchHead = commit(other, `pr-${name}`);
    git(other, "checkout", "main");
    git(other, "merge", "--no-ff", "-m", `merge ${name}`, `pr-${name}`);
    git(other, "push", "origin", "main");
    this.views.set(prUrl, { ...open, state: "MERGED", head: branchHead });
  }
}

const record = (id: string, order: number, task: string) =>
  JSON.stringify({ id, group: 1, order, task });
const queue = (id: string, order: number, task: string) =>
  ({ path: join(runDir, "queue", `${id}.json`), content: record(id, order, task) });
const planRun = (...writes: { path: string; content: string }[]): Behaviour =>
  ({ ticks: 1, end: "completed", writes: [...writes, { path: join(runDir, "plan.done"), content: "x" }] });
const finalRun = (): Behaviour => planRun({ path: join(runDir, "final"), content: "x" });
const workDone = (): Behaviour => ({ ticks: 1, end: "completed", writes: [{ path: join(runDir, "out", "{unit}.done"), content: "x" }] });

async function arm(): Promise<void> {
  expect(await main(["arm", RELAY, "--run", "r1", "--param", `project=${project}`, "--param", `repo=${repo}`, "--no-timer"])).toBe(0);
  mkdirSync(join(runDir, "out"), { recursive: true });
  for (const u of ["a", "b"]) writeFileSync(join(runDir, "out", `${u}.pr`), url(u) + "\n");
}

function newHost(script: Record<string, Behaviour>): FakeHost {
  const host = new FakeHost(script);
  let n = 0;
  host.bindDir = (_p, _c, _n, _m) => {
    const d = join(root, "wt", String(++n));
    mkdirSync(d, { recursive: true });
    return d;
  };
  return host;
}

const readRun = (): RunState => openStore(state).readRun("r1");
const events = () =>
  readFileSync(join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, string>);
/** `launched planner`, `merged a`, `done`: the events that mark the relay's course. */
const course = () =>
  events().filter((e) => ["launched", "merged", "done"].includes(e.kind)).map((e) => (e.unit ? `${e.kind} ${e.unit}` : e.kind));
const workLaunches = (host: FakeHost, unit: string) =>
  host.launches.filter((l) => l.request.title.startsWith(`work ${unit} `));

/** Drive tick + advance until the run is done, at most 60 times; `between` runs after each advance. */
async function drive(
  host: FakeHost, forge: FakeForge, notify: (k: string, m: string) => void, between: () => void = () => {},
): Promise<number> {
  for (let i = 1; i <= 60; i++) {
    await tick({ store: openStore(state), host, forge, notify, now: () => new Date(T0) });
    host.advance();
    between();
    if (readRun().status === "done") return i;
  }
  return 60;
}
const mergeCommits = () => git(origin, "log", "--merges", "--reverse", "--format=%s", "main").split("\n").filter(Boolean);

test("relay runs to done", async () => {
  await arm();
  const host = newHost({ planner: planRun(queue("a", 1, "task a"), queue("b", 2, "task b")), work: workDone() });
  const forge = new LandingForge();
  const notes: string[] = [];
  const between = () => {
    if (host.launches.filter((l) => l.request.title.startsWith("plan ")).length >= 1) host.script.planner = finalRun();
  };
  await drive(host, forge, (_k, m) => { notes.push(m); }, between);

  expect(readRun().status).toBe("done");
  expect(course()).toEqual(["launched planner", "launched a", "launched b", "merged a", "merged b", "launched planner", "done"]);
  expect(mergeCommits()).toEqual(["merge a", "merge b"]);
  expect(readdirSync(join(state, "claims"))).toEqual([]);
  const workers = host.launches.filter((l) => l.request.title.startsWith("work "));
  expect(workers.map((l) => l.claim?.env.RELAY_ROLE)).toEqual(["worker", "worker"]);
  expect(workers.map((l) => l.claim?.env.RELAY_UNIT)).toEqual(["a", "b"]);
  expect(host.launches.filter((l) => l.request.title.startsWith("plan ")).map((l) => l.claim?.env.RELAY_ROLE)).toEqual(["planner", "planner"]);
  expect(existsSync(join(runDir, "final"))).toBe(true);
  expect(notes).toEqual([`baton r1 done`]);
});

test("relay with a gap re-enters through the planner", async () => {
  await arm();
  const planners = [
    planRun(queue("a", 1, "task a"), queue("b", 2, "task b")),
    planRun(queue("a", 1, "task a, gap answered")), // the planner rewrites a's record
    finalRun(),
  ];
  const host = newHost({ planner: planners[0], work: { ticks: 1, end: "completed" } });
  const forge = new LandingForge();
  let handled = 0;
  const between = () => {
    const nPlan = host.launches.filter((l) => l.request.title.startsWith("plan ")).length;
    host.script.planner = planners[Math.min(nPlan, planners.length - 1)];
    // The workers: a's first run reports a gap, every other run is done.
    const work = host.launches.filter((l) => l.request.title.startsWith("work "));
    for (; handled < work.length; handled++) {
      const unit = work[handled].claim!.env.RELAY_UNIT;
      const first = work.slice(0, handled).every((l) => l.claim!.env.RELAY_UNIT !== unit);
      const file = unit === "a" && first ? "a.gaps" : `${unit}.done`;
      mkdirSync(join(runDir, "out"), { recursive: true });
      writeFileSync(join(runDir, "out", file), "x");
    }
  };
  await drive(host, forge, () => {}, between);

  expect(readRun().status).toBe("done");
  expect(existsSync(join(runDir, "out", "a.gaps"))).toBe(false); // the gap outcome's hook consumed it
  expect(workLaunches(host, "a")).toHaveLength(2);
  expect(workLaunches(host, "b")).toHaveLength(1);
  expect(host.launches.filter((l) => l.request.title.startsWith("plan "))).toHaveLength(3);
  expect(JSON.parse(readFileSync(join(runDir, "queue", "a.json"), "utf8")).task).toBe("task a, gap answered");
  expect(mergeCommits()).toEqual(["merge a", "merge b"]);
  expect(readdirSync(join(state, "claims"))).toEqual([]);
});

test("relay with a stop parks only that unit and the run never reaches done", async () => {
  await arm();
  const host = newHost({ planner: planRun(queue("a", 1, "task a"), queue("b", 2, "task b")), work: { ...workDone(), ticks: 2 } });
  const forge = new LandingForge();
  const notes: string[] = [];
  let stopped = false;
  const between = () => {
    if (host.launches.filter((l) => l.request.title.startsWith("plan ")).length >= 1) host.script.planner = finalRun();
    // b is stopped while its session is at work: the next tick parks it and interrupts the thread.
    if (!stopped && workLaunches(host, "b").length === 1) {
      mkdirSync(join(runDir, "stop"), { recursive: true });
      writeFileSync(join(runDir, "stop", "b"), "x");
      stopped = true;
    }
  };
  await drive(host, forge, (_k, m) => { notes.push(m); }, between);

  const run = readRun();
  expect(run.status).toBe("armed");
  expect(run.units.a.stage).toBe("done");
  expect(run.units.b.parked?.reason).toBe("stop");
  expect(run.units.b.stage).toBe("work");
  expect(mergeCommits()).toEqual(["merge a"]);
  expect(host.interrupts).toHaveLength(1);
  expect(notes).toEqual(["baton r1/b parked in work: stop"]);
  expect(events().some((e) => e.kind === "done")).toBe(false);
});
