import { expect, test } from "bun:test";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { breakStaleLock, openStore, type RunState } from "../src/state.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "baton-state-"));

const sample = (id: string): RunState => ({
  id, dir: "", recipe_sha256: "x", params: {}, armed_at: "2026-01-01T00:00:00.000Z", status: "armed", units: {},
});

test("writeRun is atomic: a leftover .tmp is ignored and the file is mode 600", () => {
  const s = openStore(tmp());
  s.writeRun(sample("r1"));
  // A killed writer left a half-written temp file beside run.json.
  writeFileSync(join(s.runDir("r1"), "run.json.99999.tmp"), '{"id": "tru');
  expect(s.readRun("r1").id).toBe("r1");
  expect(statSync(join(s.runDir("r1"), "run.json")).mode & 0o777).toBe(0o600);
  // A temp file alone never makes a run.
  mkdirSync(s.runDir("r2"), { recursive: true });
  writeFileSync(join(s.runDir("r2"), "run.json.1.tmp"), "{");
  expect(s.listRuns()).toEqual(["r1"]);
});

test("second lock holder gets busy", async () => {
  const s = openStore(tmp());
  const inner = await s.withLock(async () => s.withLock(async () => "inner"));
  expect(inner).toBe("busy");
});

test("the lock is released after the callback, even when it throws", async () => {
  const s = openStore(tmp());
  await expect(s.withLock(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  expect(await s.withLock(async () => "ok")).toBe("ok");
  expect(existsSync(join(s.dir, "lock"))).toBe(false);
});

test("a stale pid lock is taken over", async () => {
  const dir = tmp();
  const dead = Bun.spawn(["true"]);
  await dead.exited;
  writeFileSync(join(dir, "lock"), String(dead.pid));
  const s = openStore(dir);
  expect(await s.withLock(async () => "taken")).toBe("taken");
});

test("a live foreign pid lock is respected", async () => {
  const dir = tmp();
  const live = Bun.spawn(["sleep", "30"]);
  try {
    writeFileSync(join(dir, "lock"), String(live.pid));
    expect(await openStore(dir).withLock(async () => "no")).toBe("busy");
  } finally {
    live.kill();
  }
});

test("event appends one JSON line with an at stamp", () => {
  const s = openStore(tmp());
  s.event("r1", { kind: "launched" });
  s.event("r1", { kind: "stall" });
  const lines = require("node:fs").readFileSync(join(s.runDir("r1"), "events.jsonl"), "utf8").trim().split("\n");
  expect(lines.map((l: string) => JSON.parse(l).kind)).toEqual(["launched", "stall"]);
  expect(typeof JSON.parse(lines[0]).at).toBe("string");
});

test("a lock that vanishes between open and read does not throw", async () => {
  const dir = tmp();
  // A dangling symlink: the exclusive create sees EEXIST, the read sees ENOENT.
  require("node:fs").symlinkSync(join(dir, "gone"), join(dir, "lock"));
  expect(await openStore(dir).withLock(async () => "no")).toBe("busy");
});

test("an empty lock file reads busy, never stale", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "lock"), "");
  expect(await openStore(dir).withLock(async () => "no")).toBe("busy");
  writeFileSync(join(dir, "lock"), "not-a-pid");
  expect(await openStore(dir).withLock(async () => "no")).toBe("busy");
});

test("release leaves a lock whose pid is not ours", async () => {
  const dir = tmp();
  const live = Bun.spawn(["sleep", "30"]);
  try {
    const s = openStore(dir);
    expect(await s.withLock(async () => {
      writeFileSync(join(dir, "lock"), String(live.pid)); // another process took over
      return "ran";
    })).toBe("ran");
    expect(require("node:fs").readFileSync(join(dir, "lock"), "utf8")).toBe(String(live.pid));
  } finally {
    live.kill();
  }
});

test("two takers judge the same dead pid: the first takes the lock, the second reads busy and leaves it", async () => {
  const dir = tmp();
  const dead = Bun.spawn(["true"]);
  await dead.exited;
  const lock = join(dir, "lock");
  writeFileSync(lock, String(dead.pid));
  // Both takers read the dead pid; then they break in turn.
  expect(breakStaleLock(lock, String(dead.pid))).toBe(true);
  expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
  expect(breakStaleLock(lock, String(dead.pid))).toBe(false);
  expect(readFileSync(lock, "utf8")).toBe(String(process.pid)); // the first taker's lock survives
  expect(readdirSync(dir)).toEqual(["lock"]); // no marker or temp file left behind
});

test("a stale lock another taker is breaking reads busy", async () => {
  const dir = tmp();
  const dead = Bun.spawn(["true"]);
  await dead.exited;
  const lock = join(dir, "lock");
  writeFileSync(lock, String(dead.pid));
  linkSync(lock, `${lock}.stale.${dead.pid}`); // another breaker holds the marker
  expect(await openStore(dir).withLock(async () => "no")).toBe("busy");
  expect(readFileSync(lock, "utf8")).toBe(String(dead.pid));
});

test("the lock is created with the pid already in it", async () => {
  const dir = tmp();
  const s = openStore(dir);
  expect(await s.withLock(async () => readFileSync(join(dir, "lock"), "utf8"))).toBe(String(process.pid));
  expect(readdirSync(dir)).toEqual([]); // the temp file is gone, and release removed the lock
});

/** Run `code` in a child bun under a file-size limit of `kb` KiB (none when null). */
function underLimit(kb: number | null, state: string, code: string): number {
  const SRC = join(import.meta.dir, "..", "src");
  const script = `const SRC = ${JSON.stringify(SRC)};\n${code}`;
  const limit = kb === null ? "" : `ulimit -f ${kb}; `;
  const p = Bun.spawnSync(["bash", "-c", `${limit}exec bun -e "$0"`, script], {
    env: { ...process.env, BATON_STATE_DIR: state }, stdout: "pipe", stderr: "pipe",
  });
  return p.exitCode ?? -1;
}

test("a short write never replaces run.json: the old file survives and no temp file is left", () => {
  const dir = tmp();
  const s = openStore(dir);
  s.writeRun(sample("r1"));
  const before = readFileSync(join(s.runDir("r1"), "run.json"), "utf8");
  const big = `const { openStore } = await import(SRC + "/state.ts");
    const run = { id: "r1", dir: "", recipe_sha256: "x".repeat(20000), params: {}, armed_at: "a", status: "armed", units: {} };
    openStore(process.env.BATON_STATE_DIR).writeRun(run);`;
  // 4 KiB limit, a ~20 KB run: the first write is short (4096 bytes, no throw)
  expect(underLimit(4, dir, big)).not.toBe(0);
  expect(readFileSync(join(s.runDir("r1"), "run.json"), "utf8")).toBe(before);
  expect(readdirSync(s.runDir("r1"))).toEqual(["run.json"]);
  // adjacent control: with no limit the same write lands whole
  expect(underLimit(null, dir, big)).toBe(0);
  expect(s.readRun("r1").recipe_sha256).toBe("x".repeat(20000));
  expect(readdirSync(s.runDir("r1"))).toEqual(["run.json"]);
});

test("a short write never replaces a claim: the old claim survives and no temp file is left", () => {
  const dir = tmp();
  const cwd = mkdtempSync(join(tmpdir(), "baton-claim-cwd-"));
  const claim = (env: string) => `const { writeClaim } = await import(SRC + "/claims.ts");
    writeClaim(${JSON.stringify(cwd)}, ${env}, "r1/a/work/1");`;
  expect(underLimit(null, dir, claim(`{ K: "small" }`))).toBe(0);
  const claims = join(dir, "claims");
  const [file] = readdirSync(claims);
  const before = readFileSync(join(claims, file), "utf8");
  expect(underLimit(4, dir, claim(`{ K: "v".repeat(20000) }`))).not.toBe(0);
  expect(readFileSync(join(claims, file), "utf8")).toBe(before);
  expect(readdirSync(claims)).toEqual([file]);
  // adjacent control: with no limit the large claim lands whole
  expect(underLimit(null, dir, claim(`{ K: "v".repeat(20000) }`))).toBe(0);
  expect(readFileSync(join(claims, file), "utf8")).toContain("v".repeat(20000));
});

// ---- run.json shape (#920) ------------------------------------------------------------

/** Write `run` as r1's run.json by hand, as a hand edit would leave it. */
function handWritten(run: unknown): ReturnType<typeof openStore> {
  const s = openStore(tmp());
  mkdirSync(s.runDir("r1"), { recursive: true });
  writeFileSync(join(s.runDir("r1"), "run.json"), JSON.stringify(run));
  return s;
}
const unitOf = (id: string) => ({ id, group: 0, order: 0, vars: {}, stage: "work", launches: {}, stalls: 0 });

test("readRun refuses a run.json whose units is an array, naming the run and the field", () => {
  // The #920 shape: `jq '.units |= map(...)'` turned the object into an array of the same units.
  const s = handWritten({ ...sample("r1"), units: [unitOf("a")] });
  expect(() => s.readRun("r1")).toThrow("run r1: run.json: units is not an object");
  // adjacent control: the same unit keyed by its id loads
  const ok = handWritten({ ...sample("r1"), units: { a: unitOf("a") } });
  expect(ok.readRun("r1").units.a.stage).toBe("work");
});

test("readRun refuses a units that is null, a string or missing", () => {
  for (const units of [null, "a", undefined]) {
    const s = handWritten({ ...sample("r1"), units });
    expect(() => s.readRun("r1")).toThrow("run r1: run.json: units is not an object");
  }
});

test("readRun refuses a unit record that is not an object or is keyed by another id", () => {
  expect(() => handWritten({ ...sample("r1"), units: { a: null } }).readRun("r1"))
    .toThrow("run r1: run.json: units.a is not an object");
  expect(() => handWritten({ ...sample("r1"), units: { a: [] } }).readRun("r1"))
    .toThrow("run r1: run.json: units.a is not an object");
  expect(() => handWritten({ ...sample("r1"), units: { a: unitOf("b") } }).readRun("r1"))
    .toThrow('run r1: run.json: units.a has id "b"');
});

test("readRun refuses a run.json that is not an object, has another run's id, or an unknown status", () => {
  expect(() => handWritten([]).readRun("r1")).toThrow("run r1: run.json is not an object");
  expect(() => handWritten(null).readRun("r1")).toThrow("run r1: run.json is not an object");
  // A copied run directory keeps the old id: a save would write the old run's directory.
  expect(() => handWritten(sample("r0")).readRun("r1")).toThrow('run r1: run.json: id is "r0"');
  expect(() => handWritten({ ...sample("r1"), status: "paused" }).readRun("r1"))
    .toThrow('run r1: run.json: status "paused" is not one of armed, parked, disarmed, done');
  // adjacent control: every known status loads
  for (const status of ["armed", "parked", "disarmed", "done"]) {
    expect(handWritten({ ...sample("r1"), status }).readRun("r1").status).toBe(status);
  }
});

test("readRun of a run with no run.json still throws ENOENT", () => {
  const s = openStore(tmp());
  let code: string | undefined;
  try { s.readRun("nope"); } catch (e) { code = (e as NodeJS.ErrnoException).code; }
  expect(code).toBe("ENOENT");
});
