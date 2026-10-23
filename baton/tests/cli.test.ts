import { expect, test } from "bun:test";
import { join } from "node:path";

const BIN = join(import.meta.dir, "..", "bin", "baton");
const FIX = join(import.meta.dir, "fixtures", "recipes");

async function run(...args: string[]) {
  const p = Bun.spawn([BIN, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, rc] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, rc };
}

test("baton validate: rc 0 on the relay fixture", async () => {
  const r = await run("validate", join(FIX, "relay.json"));
  expect(r.rc).toBe(0);
});

test("baton validate: rc 2 with one error per line on stderr", async () => {
  const r = await run("validate", join(FIX, "bad-version.json"));
  expect(r.rc).toBe(2);
  expect(r.err.trim().split("\n")).toEqual(["version: must be 1"]);
});

test("baton validate: an unreadable file is rc 2", async () => {
  const r = await run("validate", join(FIX, "nope.json"));
  expect(r.rc).toBe(2);
});

test("baton with no command is a usage error", async () => {
  expect((await run()).rc).toBe(64);
});

// ---- run state commands ---------------------------------------------------------------

import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

const RELAY = join(FIX, "relay.json");
const PARAMS = ["--param", "project=/p", "--param", "repo=o/r"];

async function runIn(state: string, ...args: string[]) {
  const p = Bun.spawn([BIN, ...args], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, BATON_STATE_DIR: state },
  });
  const [out, err, rc] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, rc };
}
const newState = () => mkdtempSync(join(tmpdir(), "baton-cli-"));
const runJson = (state: string, id: string) => JSON.parse(readFileSync(join(state, "runs", id, "run.json"), "utf8"));

test("arm writes a frozen recipe and seed units", async () => {
  const st = newState();
  const r = await runIn(st, "arm", RELAY, "--run", "r1", ...PARAMS, "--no-timer");
  expect(r.rc).toBe(0);
  const dir = join(st, "runs", "r1");
  expect(readFileSync(join(dir, "recipe.json"))).toEqual(readFileSync(RELAY));
  const run = runJson(st, "r1");
  expect(run.units.planner.stage).toBe("planner");
  expect(run.units.planner.group).toBe(0);
  expect(run.units.planner.order).toBe(0);
  expect(run.status).toBe("armed");
  expect(run.dir).toBe(dir);
  expect(run.params).toEqual({ project: "/p", repo: "o/r" });
  expect(run.recipe_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(statSync(join(dir, "run.json")).mode & 0o777).toBe(0o600);
  const ev = readFileSync(join(dir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(ev.map((e) => e.kind)).toEqual(["armed"]);
});

test("arm checks params by own property: constructor and __proto__ are params like any other", async () => {
  for (const name of ["constructor", "__proto__"]) {
    const rec = JSON.parse(readFileSync(RELAY, "utf8"));
    rec.params = [...rec.params, name];
    const file = join(newState(), "r.json");
    writeFileSync(file, JSON.stringify(rec));
    const st = newState();
    const missing = await runIn(st, "arm", file, "--run", "r1", ...PARAMS, "--no-timer");
    expect(missing.rc).toBe(2);
    expect(missing.err).toContain(`missing param: ${name}`);
    // adjacent control: given, it arms and is stored as an own value
    expect((await runIn(st, "arm", file, "--run", "r1", ...PARAMS, "--param", `${name}=v`, "--no-timer")).rc).toBe(0);
    const params = runJson(st, "r1").params;
    expect(Object.prototype.hasOwnProperty.call(params, name)).toBe(true);
    expect(params[name]).toBe("v");
    // undeclared, it is refused rather than dropped
    const st2 = newState();
    const extra = await runIn(st2, "arm", RELAY, "--run", "r1", ...PARAMS, "--param", `${name}=v`, "--no-timer");
    expect(extra.rc).toBe(2);
    expect(extra.err).toContain(`undeclared param: ${name}`);
  }
});

test("an Object.prototype member is refused as a run id, an unpark unit or an unpark --to stage", async () => {
  for (const n of ["__proto__", "constructor"]) {
    const st = newState();
    const a = await runIn(st, "arm", RELAY, "--run", n, ...PARAMS, "--no-timer");
    expect(a.rc).toBe(2);
    expect(a.err).toContain("must not name an Object.prototype member");
    expect(existsSync(join(st, "runs", n))).toBe(false);
    expect((await runIn(st, "tick", "--run", n)).rc).toBe(64);
  }
  const st = await armedWithParkedUnit();
  const before = readFileSync(join(st, "runs", "r1", "run.json"), "utf8");
  for (const n of ["__proto__", "constructor", "toString"]) {
    const u = await runIn(st, "unpark", "r1", n);
    expect(u.rc).toBe(2);
    expect(u.err).toContain("must not name an Object.prototype member");
    const t = await runIn(st, "unpark", "r1", "planner", "--to", n);
    expect(t.rc).toBe(2);
    expect(t.err).toContain("must not name an Object.prototype member");
  }
  expect(readFileSync(join(st, "runs", "r1", "run.json"), "utf8")).toBe(before);
  // adjacent control: an ordinary unit and stage still unpark
  expect((await runIn(st, "unpark", "r1", "planner", "--to", "work")).rc).toBe(0);
});

/** `baton <args>` in a child under a file-size limit of `kb` KiB. */
function underLimit(kb: number, state: string, ...args: string[]) {
  const p = Bun.spawnSync(["bash", "-c", `ulimit -f ${kb}; exec "$@"`, "-", BIN, ...args], {
    env: { ...process.env, BATON_STATE_DIR: state }, stdout: "pipe", stderr: "pipe",
  });
  return { rc: p.exitCode, err: p.stderr.toString() };
}

test("arm is all or nothing: a failed write leaves no run directory, and a retry arms", async () => {
  // a recipe.json too large for the limit, and a run.json too large for it (a long param)
  const rec = JSON.parse(readFileSync(RELAY, "utf8"));
  rec.stages.work.message = "x".repeat(20000);
  const bigRecipe = join(newState(), "big.json");
  writeFileSync(bigRecipe, JSON.stringify(rec));
  const cases: [string, string[]][] = [
    [bigRecipe, PARAMS],
    [RELAY, ["--param", `project=/${"p".repeat(20000)}`, "--param", "repo=o/r"]],
  ];
  for (const [file, params] of cases) {
    const st = newState();
    const r = underLimit(4, st, "arm", file, "--run", "r1", ...params, "--no-timer");
    expect(r.rc).toBe(2);
    expect(r.err.trim().split("\n")).toHaveLength(1);
    expect(r.err).toContain("arm r1 failed: ");
    expect(existsSync(join(st, "runs", "r1"))).toBe(false);
    // the retry with no limit arms
    expect((await runIn(st, "arm", file, "--run", "r1", ...params, "--no-timer")).rc).toBe(0);
    expect(runJson(st, "r1").status).toBe("armed");
    expect(readFileSync(join(st, "runs", "r1", "recipe.json"))).toEqual(readFileSync(file));
  }
});

test("arm refuses a reused run id and leaves state unchanged", async () => {
  const st = newState();
  expect((await runIn(st, "arm", RELAY, "--run", "r1", ...PARAMS, "--no-timer")).rc).toBe(0);
  const before = readFileSync(join(st, "runs", "r1", "run.json"), "utf8");
  const evBefore = readFileSync(join(st, "runs", "r1", "events.jsonl"), "utf8");
  const r = await runIn(st, "arm", RELAY, "--run", "r1", "--param", "project=/other", "--param", "repo=o/r", "--no-timer");
  expect(r.rc).toBe(2);
  expect(readFileSync(join(st, "runs", "r1", "run.json"), "utf8")).toBe(before);
  expect(readFileSync(join(st, "runs", "r1", "events.jsonl"), "utf8")).toBe(evBefore);
});

test("arm refuses a missing param", async () => {
  const st = newState();
  const r = await runIn(st, "arm", RELAY, "--run", "r1", "--param", "project=/p", "--no-timer");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("repo");
  expect(existsSync(join(st, "runs", "r1"))).toBe(false);
});

test("arm refuses an extra param", async () => {
  const st = newState();
  const r = await runIn(st, "arm", RELAY, "--run", "r1", ...PARAMS, "--param", "bogus=1", "--no-timer");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("bogus");
  expect(existsSync(join(st, "runs", "r1"))).toBe(false);
});

test("arm accepts exactly the declared params", async () => {
  const st = newState();
  expect((await runIn(st, "arm", RELAY, "--run", "r1", ...PARAMS, "--no-timer")).rc).toBe(0);
});

test("arm refuses an invalid recipe and a bad run id", async () => {
  const st = newState();
  expect((await runIn(st, "arm", join(FIX, "bad-version.json"), "--run", "r1", "--no-timer")).rc).toBe(2);
  expect((await runIn(st, "arm", RELAY, "--run", "Bad Id", ...PARAMS, "--no-timer")).rc).toBe(2);
  expect((await runIn(st, "arm", RELAY, ...PARAMS)).rc).toBe(64);
});

test("status prints one line per unit", async () => {
  const st = newState();
  await runIn(st, "arm", RELAY, "--run", "r1", ...PARAMS, "--no-timer");
  const r = await runIn(st, "status", "r1");
  expect(r.rc).toBe(0);
  expect(r.out).toBe("planner planner 0 0 - -\n");
  expect((await runIn(st, "status", "nope")).rc).toBe(2);
});

test("disarm marks the run disarmed and removes only its units' claims", async () => {
  const st = newState();
  await runIn(st, "arm", RELAY, "--run", "r1", ...PARAMS, "--no-timer");
  const run = runJson(st, "r1");
  run.units.planner.session = {
    nonce: "r1/planner/planner/1", claim_nonce: "r1/planner/planner/1", launch_dir: "/x", claim_key: "abc123",
    launched_at: "t", last_progress_at: "t", progress_mark: "m",
  };
  writeFileSync(join(st, "runs", "r1", "run.json"), JSON.stringify(run));
  mkdirSync(join(st, "claims"), { recursive: true });
  writeFileSync(join(st, "claims", "abc123.env"), "# baton r1/planner/planner/1\nX=1\n");
  writeFileSync(join(st, "claims", "other.env"), "x");
  const r = await runIn(st, "disarm", "r1");
  expect(r.rc).toBe(0);
  expect(runJson(st, "r1").status).toBe("disarmed");
  expect(existsSync(join(st, "claims", "abc123.env"))).toBe(false);
  expect(existsSync(join(st, "claims", "other.env"))).toBe(true);
  // A second disarm with the claim already gone is fine.
  expect((await runIn(st, "disarm", "r1")).rc).toBe(0);
});

async function armedWithParkedUnit() {
  const st = newState();
  await runIn(st, "arm", RELAY, "--run", "r1", ...PARAMS, "--no-timer");
  const run = runJson(st, "r1");
  run.units.planner.parked = { reason: "stalled", at: "t" };
  run.units.planner.stalls = 3;
  run.units.planner.launches = { planner: 2, work: 1 };
  writeFileSync(join(st, "runs", "r1", "run.json"), JSON.stringify(run));
  return st;
}

test("unpark refuses a running unit (session, not parked); control: a parked unit unparks even with a session record", async () => {
  const st = await armedWithParkedUnit();
  const run = runJson(st, "r1");
  const session = { nonce: "r1/planner/planner/3", claim_nonce: "r1/planner/planner/3", launch_dir: "/tmp/x", thread_id: "t1", started: "t" };
  run.units.planner.session = session;
  delete run.units.planner.parked;
  writeFileSync(join(st, "runs", "r1", "run.json"), JSON.stringify(run));
  const events = () => readFileSync(join(st, "runs", "r1", "events.jsonl"), "utf8").trim().split("\n").length;
  const before = events();
  for (const args of [["unpark", "r1", "planner"], ["unpark", "r1", "planner", "--to", "work"]]) {
    expect((await runIn(st, ...args)).rc).toBe(2);
    const u = runJson(st, "r1").units.planner;
    expect(u.stage).toBe("planner");
    expect(u.stalls).toBe(3);
    expect(u.session?.nonce).toBe("r1/planner/planner/3");
  }
  expect(events()).toBe(before);
  // control: parked, with a session record left behind (older state, a hand edit) — not refused
  run.units.planner.parked = { reason: "stalled", at: "t" };
  writeFileSync(join(st, "runs", "r1", "run.json"), JSON.stringify(run));
  expect((await runIn(st, "unpark", "r1", "planner")).rc).toBe(0);
  expect(runJson(st, "r1").units.planner.parked).toBeUndefined();
});

test("unpark resets the stage counters and logs an event", async () => {
  const st = await armedWithParkedUnit();
  const r = await runIn(st, "unpark", "r1", "planner");
  expect(r.rc).toBe(0);
  const u = runJson(st, "r1").units.planner;
  expect(u.parked).toBeUndefined();
  expect(u.stalls).toBe(0);
  expect(u.launches).toEqual({ planner: 0, work: 1 });
  expect(u.stage).toBe("planner");
  const ev = readFileSync(join(st, "runs", "r1", "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(ev.map((e) => e.kind)).toEqual(["armed", "unpark"]);
  expect(ev[1].unit).toBe("planner");
});

test("unpark clears the merge failure count", async () => {
  const st = await armedWithParkedUnit();
  const run = runJson(st, "r1");
  run.units.planner.merge_failures = 3;
  writeFileSync(join(st, "runs", "r1", "run.json"), JSON.stringify(run));
  expect((await runIn(st, "unpark", "r1", "planner")).rc).toBe(0);
  expect(runJson(st, "r1").units.planner.merge_failures).toBeUndefined();
});

test("unpark clears the forge failure count", async () => {
  const st = await armedWithParkedUnit();
  const run = runJson(st, "r1");
  run.units.planner.forge_failures = 3;
  writeFileSync(join(st, "runs", "r1", "run.json"), JSON.stringify(run));
  expect((await runIn(st, "unpark", "r1", "planner")).rc).toBe(0);
  expect(runJson(st, "r1").units.planner.forge_failures).toBeUndefined();
});

test("unpark --to moves the unit to a recipe stage; an unknown stage is rc 2", async () => {
  const st = await armedWithParkedUnit();
  expect((await runIn(st, "unpark", "r1", "planner", "--to", "nowhere")).rc).toBe(2);
  // a terminal is never a stage (validate refuses a stage so named), so --to cannot name one
  for (const t of ["done", "park"]) expect((await runIn(st, "unpark", "r1", "planner", "--to", t)).rc).toBe(2);
  expect(runJson(st, "r1").units.planner.parked).toBeDefined();
  expect((await runIn(st, "unpark", "r1", "planner", "--to", "work")).rc).toBe(0);
  expect(runJson(st, "r1").units.planner.stage).toBe("work");
  expect((await runIn(st, "unpark", "r1", "--to", "work")).rc).toBe(64);
  expect((await runIn(st, "unpark", "r1", "ghost")).rc).toBe(2);
});

test("unpark --to resets the launch count of the stage the unit moves to", async () => {
  const st = await armedWithParkedUnit(); // launches { planner: 2, work: 1 }
  expect((await runIn(st, "unpark", "r1", "planner", "--to", "work")).rc).toBe(0);
  const u = runJson(st, "r1").units.planner;
  expect(u.stage).toBe("work");
  expect(u.launches).toEqual({ planner: 2, work: 0 });
});

test("unpark --to applies the stage entry; plain unpark keeps the visit's entry record and busy note", async () => {
  const entry = { record_seen: "d2", record_at_entry: "d1", cwd_busy: "x", merge_failures: 2, forge_failures: 1 };
  let st = await armedWithParkedUnit();
  let run = runJson(st, "r1");
  Object.assign(run.units.planner, entry);
  writeFileSync(join(st, "runs", "r1", "run.json"), JSON.stringify(run));
  expect((await runIn(st, "unpark", "r1", "planner", "--to", "regap")).rc).toBe(0);
  let u = runJson(st, "r1").units.planner;
  expect(u.stage).toBe("regap");
  expect(u.record_at_entry).toBe("d2");
  expect(u.cwd_busy).toBeUndefined();
  expect(u.merge_failures).toBeUndefined();
  expect(u.forge_failures).toBeUndefined();
  expect(u.stalls).toBe(0);
  expect(u.launches).toEqual({ planner: 2, work: 1, regap: 0 });
  // control: plain unpark resumes the same visit
  st = await armedWithParkedUnit();
  run = runJson(st, "r1");
  Object.assign(run.units.planner, entry);
  writeFileSync(join(st, "runs", "r1", "run.json"), JSON.stringify(run));
  expect((await runIn(st, "unpark", "r1", "planner")).rc).toBe(0);
  u = runJson(st, "r1").units.planner;
  expect(u.record_at_entry).toBe("d1");
  expect(u.cwd_busy).toBe("x");
  expect(u.merge_failures).toBeUndefined();
  expect(u.launches).toEqual({ planner: 0, work: 1 });
});

test("unpark with no unit un-parks the run", async () => {
  const st = await armedWithParkedUnit();
  const run = runJson(st, "r1");
  run.status = "parked";
  run.parked = { reason: "x", at: "t" };
  writeFileSync(join(st, "runs", "r1", "run.json"), JSON.stringify(run));
  expect((await runIn(st, "unpark", "r1")).rc).toBe(0);
  const after = runJson(st, "r1");
  expect(after.status).toBe("armed");
  expect(after.parked).toBeUndefined();
  expect(after.units.planner.parked).toBeDefined();
});

test("report counts events by kind", async () => {
  const st = newState();
  const dir = join(st, "runs", "r9");
  mkdirSync(dir, { recursive: true });
  const evs = [
    { at: "2026-01-01T00:00:00.000Z", kind: "armed" },
    { at: "2026-01-01T00:01:00.000Z", kind: "launched" },
    { at: "2026-01-01T00:02:00.000Z", kind: "launched" },
    { at: "2026-01-01T00:03:00.000Z", kind: "launched" },
    { at: "2026-01-01T00:04:00.000Z", kind: "successor" },
    { at: "2026-01-01T00:05:00.000Z", kind: "stall" },
    { at: "2026-01-01T00:06:00.000Z", kind: "stall" },
    { at: "2026-01-01T00:07:00.000Z", kind: "park" },
    { at: "2026-01-01T00:08:00.000Z", kind: "unpark" },
    { at: "2026-01-01T00:09:00.000Z", kind: "merged" },
    { at: "2026-01-01T00:10:00.000Z", kind: "merged" },
    { at: "2026-01-01T01:00:00.000Z", kind: "done" },
    { at: "2026-01-01T02:00:00.000Z", kind: "tick" },
  ];
  writeFileSync(join(dir, "events.jsonl"), evs.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const r = await runIn(st, "report", "r9");
  expect(r.rc).toBe(0);
  expect(r.out).toBe(
    "launched 3\nsuccessor 1\nstall 2\npark 1\nunpark 1\nmerged 2\ntriage 0\ntriage answered 0\ntriage relaunch 0\nwall_seconds 3600\n",
  );
  expect((await runIn(st, "report", "nope")).rc).toBe(2);
});
