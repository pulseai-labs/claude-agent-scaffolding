import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { tick } from "../src/engine.ts";
import { notifyOnce } from "../src/notify.ts";
import { openStore, type RunState } from "../src/state.ts";
import { FakeForge } from "./fake-forge.ts";
import { FakeHost } from "./fake-host.ts";

// `baton clone` in a temporary state directory. Nothing here reads or writes the real state.

const RELAY = join(import.meta.dir, "fixtures", "recipes", "relay.json");
const saved = { state: process.env.BATON_STATE_DIR, config: process.env.BATON_CONFIG, home: process.env.HOME };
let root: string, state: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "baton-clone-")));
  state = join(root, "state");
  mkdirSync(join(root, "home"));
  process.env.BATON_STATE_DIR = state;
  process.env.BATON_CONFIG = join(root, "config.json");
  process.env.HOME = join(root, "home");
});
afterEach(() => {
  for (const [k, v] of [["BATON_STATE_DIR", saved.state], ["BATON_CONFIG", saved.config], ["HOME", saved.home]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** `main(args)` with stdout and stderr captured. */
async function cli(...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string) => { out.push(String(s)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((s: string) => { err.push(String(s)); return true; }) as typeof process.stderr.write;
  try {
    const rc = await main(args);
    return { rc, out: out.join(""), err: err.join("") };
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
}

const dirOf = (id: string) => join(state, "runs", id);
const run = (id: string): RunState => openStore(state).readRun(id);
const rawRun = (id: string) => JSON.parse(readFileSync(join(dirOf(id), "run.json"), "utf8"));
const events = (id: string) =>
  readFileSync(join(dirOf(id), "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const ls = (p: string) => readdirSync(p).sort();
const PARAMS = ["--param", "project=/p", "--param", "repo=o/r"];

/** Arm the relay fixture as `id`, then give it the leftovers of a run that has been going. */
async function source(id = "r1") {
  expect((await cli("arm", RELAY, "--run", id, ...PARAMS, "--no-timer")).rc).toBe(0);
  const d = dirOf(id);
  const r = rawRun(id);
  r.params.project = `${d}/project`; // a param derived from the run's own directory
  r.params.repo = `${dirOf(id)}0/other`; // a different run's directory that starts with this one's name
  r.status = "parked";
  r.parked = { reason: "invalid record x.json", at: "t" };
  const session = (n: string) => ({
    nonce: n, claim_nonce: n, launch_dir: "/tmp/x", thread_id: "T-LIVE", claim_key: "k", launched_at: "t",
    last_progress_at: "t", progress_mark: "m",
  });
  r.units.planner = {
    ...r.units.planner, stage: "planner_wait", launches: { planner: 2, work: 1 }, stalls: 1, seq: { planner: 4 },
    session: session("r1/planner/planner/4"), parked: { reason: "stalled", at: "t", blocked: { thread: "T-LIVE" } },
    driver: { key: "k", session: session("d"), result_file: "/tmp/r" }, drivers: ["planner/stall"],
    triage: { request_id: "REQ-9", session: session("t") }, triaged: ["REQ-9"], cwd_busy: "n", quiet_since: "t",
    merge_failures: 2, forge_failures: 2, kept: [{ thread: "T-KEPT", project: "p", cwd: "/c", dir: "/d", until: "unpark" }],
    record_seen: "sha-seen", record_at_entry: "sha-entry", vars: { note: `${d}/note.md` },
  };
  r.units.w1 = {
    id: "w1", group: 1, order: 0, vars: { task: "t1" }, stage: "work", launches: { work: 2 }, stalls: 0,
    record_seen: "sha-w1", record_at_entry: "sha-w1", session: session("r1/w1/work/2"),
  };
  writeFileSync(join(d, "run.json"), JSON.stringify(r, null, 2) + "\n");
  mkdirSync(join(d, "spine"));
  writeFileSync(join(d, "spine", "r0.s1.w1.json"), "{}");
  writeFileSync(join(d, "project-state.json"), "{}");
  mkdirSync(join(d, "out"), { recursive: true });
  mkdirSync(join(d, "queue"), { recursive: true });
  writeFileSync(join(d, "out", "w1.done"), "ok");
  writeFileSync(join(d, "queue", "w1.json"), "{}");
  for (const k of ["launching", "launched", "launched", "stall"]) {
    writeFileSync(join(d, "events.jsonl"), JSON.stringify({ at: "t", kind: k }) + "\n", { flag: "a" });
  }
}

/** Every file under a run directory, with its bytes: what a refused clone must leave as it was. */
function snapshot(id: string): string {
  const out: string[] = [];
  const walk = (p: string) => {
    for (const n of ls(p)) {
      const f = join(p, n);
      if (readdirSync(p, { withFileTypes: true }).find((e) => e.name === n)!.isDirectory()) walk(f);
      else out.push(`${f}\n${readFileSync(f, "utf8")}`);
    }
  };
  walk(dirOf(id));
  return out.join("\n--\n");
}

// ---- what a clone holds ----------------------------------------------------------------

test("a clone holds the six things a run holds and nothing else: no spine/, no leftovers, empty queue and out", async () => {
  await source();
  const before = snapshot("r1");
  const r = await cli("clone", "r1", "c1");
  expect(r.rc).toBe(0);
  expect(ls(dirOf("c1"))).toEqual(["events.jsonl", "out", "queue", "recipe.json", "run.json"]);
  expect(ls(join(dirOf("c1"), "out"))).toEqual([]);
  expect(ls(join(dirOf("c1"), "queue"))).toEqual([]);
  // control: the source holds what the clone does not, and is byte for byte as it was
  expect(ls(dirOf("r1"))).toContain("spine");
  expect(ls(dirOf("r1"))).toContain("project-state.json");
  expect(snapshot("r1")).toBe(before);
  expect(readFileSync(join(dirOf("c1"), "recipe.json"))).toEqual(readFileSync(RELAY));
});

test("units stays an object keyed by unit id, and the clone loads under status", async () => {
  await source();
  expect((await cli("clone", "r1", "c1")).rc).toBe(0);
  const units = rawRun("c1").units;
  expect(Array.isArray(units)).toBe(false);
  expect(Object.keys(units).sort()).toEqual(["planner", "w1"]);
  for (const [k, u] of Object.entries(units)) expect((u as { id: string }).id).toBe(k);
  const s = await cli("status", "c1");
  expect(s.rc).toBe(0);
  expect(s.out.split("\n").filter(Boolean).map((l) => l.split(" ")[0]).sort()).toEqual(["planner", "w1"]);
});

test("a clone starts with its own events: one cloned line, none of the source's", async () => {
  await source();
  expect(events("r1").length).toBe(5);
  expect((await cli("clone", "r1", "c1")).rc).toBe(0);
  const ev = events("c1");
  expect(ev.length).toBe(1);
  expect(ev[0].kind).toBe("cloned");
  expect(ev[0].from).toBe("r1");
  const rep = await cli("report", "c1");
  expect(rep.out).toContain("launched 0");
  // control: the source's report still counts its own launches
  expect((await cli("report", "r1")).out).toContain("launched 2");
});

test("no session, thread, driver, triage, park or count carries over; the stage does", async () => {
  await source();
  expect((await cli("clone", "r1", "c1")).rc).toBe(0);
  const text = readFileSync(join(dirOf("c1"), "run.json"), "utf8");
  for (const leak of ["T-LIVE", "T-KEPT", "REQ-9", "session", "driver", "triage", "kept", "claim", "cwd_busy", "seq"]) {
    expect(text).not.toContain(leak);
  }
  const p = rawRun("c1").units.planner;
  expect(p.stage).toBe("planner_wait");
  expect(p.launches).toEqual({ planner_wait: 0 });
  expect(p.stalls).toBe(0);
  expect(p.parked).toBeUndefined();
  // control: the source has every one of them
  const src = readFileSync(join(dirOf("r1"), "run.json"), "utf8");
  for (const kept of ["T-LIVE", "T-KEPT", "REQ-9", "session", "driver", "triage"]) expect(src).toContain(kept);
  // identity and the file digests stand
  expect(p.record_seen).toBe("sha-seen");
  expect(rawRun("c1").units.w1.group).toBe(1);
  expect(rawRun("c1").units.w1.vars).toEqual({ task: "t1" });
});

test("a clone is pinned: its recipe digest is the digest of the recipe it holds", async () => {
  await source();
  expect((await cli("clone", "r1", "c1")).rc).toBe(0);
  const sha = new Bun.CryptoHasher("sha256").update(readFileSync(join(dirOf("c1"), "recipe.json"))).digest("hex");
  expect(rawRun("c1").recipe_sha256).toBe(sha);
  expect(rawRun("c1").id).toBe("c1");
  expect(rawRun("c1").dir).toBe(dirOf("c1"));
});

test("--recipe re-pins to another recipe; without it the source's recipe stands (control)", async () => {
  await source();
  const rec = JSON.parse(readFileSync(RELAY, "utf8"));
  rec.name = "relay-two";
  const file = join(root, "two.json");
  writeFileSync(file, JSON.stringify(rec));
  expect((await cli("clone", "r1", "c1")).rc).toBe(0);
  expect((await cli("clone", "r1", "c2", "--recipe", file)).rc).toBe(0);
  expect(readFileSync(join(dirOf("c2"), "recipe.json"))).toEqual(readFileSync(file));
  expect(rawRun("c2").recipe_sha256).not.toBe(rawRun("c1").recipe_sha256);
  expect(rawRun("c2").recipe_sha256).toBe(new Bun.CryptoHasher("sha256").update(readFileSync(file)).digest("hex"));
  expect(events("c2")[0].recipe).toBe("relay-two");
});

// ---- the state a clone starts in -------------------------------------------------------

test("a clone starts parked for `cloned`, and a tick does nothing for it; unpark starts it", async () => {
  await source();
  // --fresh leaves the planner at its seed stage: a unit that is due to launch
  expect((await cli("clone", "r1", "c1", "--fresh")).rc).toBe(0);
  const r = run("c1");
  expect(r.status).toBe("parked");
  expect(r.parked?.reason).toBe("cloned");

  const host = new FakeHost({ planner: { ticks: 1, end: "completed" } });
  const dueTick = () =>
    tick({ store: openStore(state), host, forge: new FakeForge(), notify: notifyOnce, now: () => new Date(), runId: "c1" });
  const before = readFileSync(join(dirOf("c1"), "run.json"), "utf8");
  const t1 = await dueTick();
  expect(host.launches.length).toBe(0);
  expect(t1.launched).toEqual([]);
  expect(t1.errors).toEqual([]);
  expect(readFileSync(join(dirOf("c1"), "run.json"), "utf8")).toBe(before);
  expect(events("c1").map((e) => e.kind)).toEqual(["cloned"]);

  // Nothing else runs either: a unit file that lands in its queue is not read while the park stands...
  writeFileSync(join(dirOf("c1"), "queue", "w2.json"), JSON.stringify({ id: "w2", group: 0, order: 1, task: "x" }));
  await dueTick();
  expect(Object.keys(run("c1").units)).toEqual(["planner"]);
  // ...control: the same run parked for any other reason does read it (a park stops launches only)
  const other = rawRun("c1");
  other.parked = { reason: "invalid record x.json", at: "t" };
  writeFileSync(join(dirOf("c1"), "run.json"), JSON.stringify(other));
  await dueTick();
  expect(Object.keys(run("c1").units).sort()).toEqual(["planner", "w2"]);
  other.parked = { reason: "cloned", at: "t" };
  writeFileSync(join(dirOf("c1"), "run.json"), JSON.stringify(other));
  // control: the same run, unparked, is due and launches (its cwd is the rewritten param)
  mkdirSync(`${dirOf("c1")}/project`);
  expect((await cli("unpark", "c1")).rc).toBe(0);
  expect(run("c1").status).toBe("armed");
  expect(run("c1").parked).toBeUndefined();
  await dueTick();
  expect(host.launches.length).toBe(1);
});

test("a clone does not touch the timer", async () => {
  await source();
  const bin = join(root, "systemd");
  process.env.BATON_SYSTEMD_DIR = bin;
  process.env.BATON_SYSTEMCTL = "/bin/false";
  try {
    // /bin/false would fail an install; the clone succeeds because it never tries
    expect((await cli("clone", "r1", "c1")).rc).toBe(0);
    expect(existsSync(bin)).toBe(false);
  } finally {
    delete process.env.BATON_SYSTEMD_DIR;
    delete process.env.BATON_SYSTEMCTL;
  }
});

// ---- params ----------------------------------------------------------------------------

test("a param naming the source run directory follows to the clone; another run's directory does not", async () => {
  await source();
  expect((await cli("clone", "r1", "c1")).rc).toBe(0);
  const c = rawRun("c1");
  expect(c.params.project).toBe(`${dirOf("c1")}/project`);
  expect(rawRun("c1").units.planner.vars.note).toBe(`${dirOf("c1")}/note.md`);
  // the source ran r10-style: a path under `<r1 dir>0` is another run's and stays
  expect(c.params.repo).toBe(`${dirOf("r1")}0/other`);
});

test("--param overrides a declared param; an undeclared one is refused (control: declared works)", async () => {
  await source();
  const bad = await cli("clone", "r1", "c1", "--param", "nope=1");
  expect(bad.rc).toBe(2);
  expect(bad.err).toContain("undeclared param: nope");
  expect(existsSync(dirOf("c1"))).toBe(false);
  expect((await cli("clone", "r1", "c1", "--param", "repo=x/y")).rc).toBe(0);
  expect(rawRun("c1").params.repo).toBe("x/y");
  expect(rawRun("c1").params.project).toBe(`${dirOf("c1")}/project`);
});

test("a param the new recipe declares and the source lacks is refused unless given", async () => {
  await source();
  const rec = JSON.parse(readFileSync(RELAY, "utf8"));
  rec.params = [...rec.params, "extra"];
  const file = join(root, "extra.json");
  writeFileSync(file, JSON.stringify(rec));
  const bad = await cli("clone", "r1", "c1", "--recipe", file);
  expect(bad.rc).toBe(2);
  expect(bad.err).toContain("missing param: extra");
  expect(existsSync(dirOf("c1"))).toBe(false);
  expect((await cli("clone", "r1", "c1", "--recipe", file, "--param", "extra=1")).rc).toBe(0);
  expect(rawRun("c1").params.extra).toBe("1");
});

// ---- reset and fresh -------------------------------------------------------------------

test("--reset <unit> returns a seed unit to its seed stage; the other unit keeps its stage", async () => {
  await source();
  expect((await cli("clone", "r1", "c1", "--reset", "planner")).rc).toBe(0);
  const u = rawRun("c1").units;
  expect(u.planner.stage).toBe("planner");
  expect(u.planner.record_seen).toBeUndefined();
  expect(u.planner.vars).toEqual({});
  expect(u.w1.stage).toBe("work");
  // control: without --reset the seed unit keeps the stage it was in
  expect((await cli("clone", "r1", "c2")).rc).toBe(0);
  expect(rawRun("c2").units.planner.stage).toBe("planner_wait");
});

test("--reset <unit>=<stage> goes to that stage; an unknown stage is refused (control: a known one works)", async () => {
  await source();
  const bad = await cli("clone", "r1", "c1", "--reset", "w1=nowhere");
  expect(bad.rc).toBe(2);
  expect(bad.err).toContain('stage "nowhere" is not a stage of the recipe');
  expect(existsSync(dirOf("c1"))).toBe(false);
  expect((await cli("clone", "r1", "c1", "--reset", "w1=regap")).rc).toBe(0);
  expect(rawRun("c1").units.w1.stage).toBe("regap");
  expect(rawRun("c1").units.w1.launches).toEqual({ regap: 0 });
  // a terminal stage is a stage without being declared
  expect((await cli("clone", "r1", "c2", "--reset", "w1=done")).rc).toBe(0);
  expect(rawRun("c2").units.w1.stage).toBe("done");
});

test("--reset of a unit the seed does not name needs a stage; an unknown unit is refused", async () => {
  await source();
  const noStage = await cli("clone", "r1", "c1", "--reset", "w1");
  expect(noStage.rc).toBe(2);
  expect(noStage.err).toContain("not in the recipe's seed");
  const noUnit = await cli("clone", "r1", "c1", "--reset", "ghost=work");
  expect(noUnit.rc).toBe(2);
  expect(noUnit.err).toContain("no such unit: ghost");
  expect(existsSync(dirOf("c1"))).toBe(false);
  expect((await cli("clone", "r1", "c1", "--reset", "w1=work")).rc).toBe(0);
});

test("--fresh writes the seed as arm does and drops units that came from sources", async () => {
  await source();
  expect((await cli("clone", "r1", "c1", "--fresh")).rc).toBe(0);
  const units = rawRun("c1").units;
  expect(Object.keys(units)).toEqual(["planner"]);
  expect(units.planner).toEqual({ id: "planner", group: 0, order: 0, vars: {}, stage: "planner", launches: {}, stalls: 0 });
  // --fresh and --reset together are a usage error
  const both = await cli("clone", "r1", "c2", "--fresh", "--reset", "planner");
  expect(both.rc).toBe(64);
  expect(existsSync(dirOf("c2"))).toBe(false);
});

// ---- refusals, each with its control ---------------------------------------------------

test("refuses a new id that exists, and leaves it as it was (control: a free id clones)", async () => {
  await source();
  expect((await cli("arm", RELAY, "--run", "taken", ...PARAMS, "--no-timer")).rc).toBe(0);
  const before = snapshot("taken");
  const r = await cli("clone", "r1", "taken");
  expect(r.rc).toBe(2);
  expect(r.err).toContain('run "taken" already exists');
  expect(snapshot("taken")).toBe(before);
  expect((await cli("clone", "r1", "free")).rc).toBe(0);
  // the source id as the new id is the same refusal
  expect((await cli("clone", "r1", "r1")).rc).toBe(2);
});

test("refuses a source that does not exist, and creates nothing (control: an existing source clones)", async () => {
  await source();
  for (const bad of ["ghost", "../r1", "../runs/r1", "R1", "__proto__"]) {
    const r = await cli("clone", bad, "c1");
    expect(r.rc).toBe(2);
    expect(r.err).toContain(`no such run: ${bad}`);
    expect(existsSync(dirOf("c1"))).toBe(false);
  }
  expect((await cli("clone", "r1", "c1")).rc).toBe(0);
});

test("refuses an invalid new id by arm's rule (control: a valid one clones)", async () => {
  await source();
  for (const bad of ["Bad", "a b", "a/b", "..", "__proto__", "constructor"]) {
    const r = await cli("clone", "r1", bad);
    expect(r.rc).toBe(2);
    expect(r.err).toContain(`run id "${bad}"`);
  }
  expect(ls(join(state, "runs"))).toEqual(["r1"]);
  expect((await cli("clone", "r1", "ok_1-b")).rc).toBe(0);
});

test("refuses a source whose run.json is malformed (control: a well-formed one clones)", async () => {
  await source();
  await source("r2");
  const r = rawRun("r2");
  r.units = Object.values(r.units); // the array form #920 closed
  writeFileSync(join(dirOf("r2"), "run.json"), JSON.stringify(r));
  const bad = await cli("clone", "r2", "c2");
  expect(bad.rc).toBe(2);
  expect(bad.err).toContain("units is not an object");
  expect(existsSync(dirOf("c2"))).toBe(false);
  expect((await cli("clone", "r1", "c1")).rc).toBe(0);
});

test("refuses a recipe that names roles when the source has no seat table (control: with one it clones)", async () => {
  await source();
  const rec = JSON.parse(readFileSync(RELAY, "utf8"));
  delete rec.stages.work.instance;
  delete rec.stages.work.model;
  rec.stages.work.role = "implementer";
  const file = join(root, "roles.json");
  writeFileSync(file, JSON.stringify(rec));
  const bad = await cli("clone", "r1", "c1", "--recipe", file);
  expect(bad.rc).toBe(2);
  expect(bad.err).toContain("has no seats.json");
  expect(existsSync(dirOf("c1"))).toBe(false);
  // control: a run armed with a table for that role clones, and the table goes along as it is
  const seats = join(root, "seats.json");
  writeFileSync(seats, JSON.stringify({ implementer: { agent: "a", argv: ["x"], brief_delivery: "inject", expected_model: "m", effort: "high", env: {} } }));
  expect((await cli("arm", file, "--run", "r3", ...PARAMS, "--seats", seats, "--no-timer")).rc).toBe(0);
  expect((await cli("clone", "r3", "c3")).rc).toBe(0);
  expect(readFileSync(join(dirOf("c3"), "seats.json"))).toEqual(readFileSync(seats));
  expect(rawRun("c3").seats_sha256).toBe(rawRun("r3").seats_sha256);
});

test("refuses a role the source's seat table lacks (control: the role it has clones)", async () => {
  await source();
  const rec = JSON.parse(readFileSync(RELAY, "utf8"));
  delete rec.stages.work.instance;
  delete rec.stages.work.model;
  rec.stages.work.role = "implementer";
  const file = join(root, "roles.json");
  writeFileSync(file, JSON.stringify(rec));
  const seats = join(root, "seats.json");
  const agent = { agent: "a", argv: ["x"], brief_delivery: "inject", expected_model: "m", effort: "high", env: {} };
  writeFileSync(seats, JSON.stringify({ implementer: agent }));
  expect((await cli("arm", file, "--run", "r3", ...PARAMS, "--seats", seats, "--no-timer")).rc).toBe(0);
  rec.stages.work.role = "verifier";
  const other = join(root, "verifier.json");
  writeFileSync(other, JSON.stringify(rec));
  const bad = await cli("clone", "r3", "c1", "--recipe", other);
  expect(bad.rc).toBe(2);
  expect(bad.err).toContain('role table has no role "verifier"');
  expect(existsSync(dirOf("c1"))).toBe(false);
  expect((await cli("clone", "r3", "c1", "--recipe", file)).rc).toBe(0);
});

test("refuses a recipe file that does not validate or is missing (control: the valid one clones)", async () => {
  await source();
  const rec = JSON.parse(readFileSync(RELAY, "utf8"));
  rec.version = 2;
  const file = join(root, "bad.json");
  writeFileSync(file, JSON.stringify(rec));
  const bad = await cli("clone", "r1", "c1", "--recipe", file);
  expect(bad.rc).toBe(2);
  expect(bad.err).toContain("version: must be 1");
  expect((await cli("clone", "r1", "c1", "--recipe", join(root, "nope.json"))).rc).toBe(2);
  expect(existsSync(dirOf("c1"))).toBe(false);
  expect((await cli("clone", "r1", "c1", "--recipe", RELAY)).rc).toBe(0);
});

test("a malformed command line is a usage error and creates nothing", async () => {
  await source();
  for (const args of [["r1"], ["r1", "c1", "extra"], ["r1", "c1", "--nope"], ["r1", "c1", "--reset"], ["r1", "c1", "--param", "x"]]) {
    expect((await cli("clone", ...args)).rc).toBe(64);
  }
  expect(ls(join(state, "runs"))).toEqual(["r1"]);
});

test("a unit in a stage the new recipe lacks is refused, and says which unit", async () => {
  await source();
  const rec = JSON.parse(readFileSync(RELAY, "utf8"));
  delete rec.stages.regap;
  rec.stages.planner_wait.outcomes = rec.stages.planner_wait.outcomes.filter((o: { to: string }) => o.to !== "regap");
  rec.stages.planner_wait.outcomes[0].when = [{ active: "none-in-group" }];
  rec.stages.work.outcomes = [rec.stages.work.outcomes[0]];
  const file = join(root, "nostage.json");
  writeFileSync(file, JSON.stringify(rec));
  expect((await cli("validate", file)).rc).toBe(0);
  const r = rawRun("r1");
  r.units.w1.stage = "regap";
  writeFileSync(join(dirOf("r1"), "run.json"), JSON.stringify(r));
  const bad = await cli("clone", "r1", "c1", "--recipe", file);
  expect(bad.rc).toBe(2);
  expect(bad.err).toContain('unit w1: stage "regap" is not a stage of the recipe');
  // control: the unit moved to a stage the recipe has, it clones
  r.units.w1.stage = "work";
  writeFileSync(join(dirOf("r1"), "run.json"), JSON.stringify(r));
  expect((await cli("clone", "r1", "c1", "--recipe", file)).rc).toBe(0);
});

test("through bin/baton: a clone is made, and a missing source is rc 2 (the dispatcher path)", async () => {
  await source();
  const bin = join(import.meta.dir, "..", "bin", "baton");
  const go = async (...args: string[]) => {
    const p = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, BATON_STATE_DIR: state } });
    const [out, err, rc] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, rc };
  };
  const ok = await go("clone", "r1", "c1");
  expect(ok.rc).toBe(0);
  expect(ok.out).toContain("baton unpark c1");
  expect(run("c1").status).toBe("parked");
  const bad = await go("clone", "ghost", "c2");
  expect(bad.rc).toBe(2);
  expect(bad.err).toContain("no such run: ghost");
  expect((await go("clone")).rc).toBe(64);
});
