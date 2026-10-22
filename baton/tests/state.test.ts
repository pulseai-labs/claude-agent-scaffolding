import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type RunState } from "../src/state.ts";

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
