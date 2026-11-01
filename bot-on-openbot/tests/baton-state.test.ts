import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { newestPark, readHead, readUnit, reviewedHead, runRepo, stageNames } from "../src/baton-state.ts";

beforeEach(() => {
  process.env.BATON_STATE_DIR = join(import.meta.dir, "fixtures", "baton");
});
afterEach(() => {
  delete process.env.BATON_STATE_DIR;
});

test("readUnit returns stage, parked and pr_url", () => {
  expect(readUnit("r1", "u1")).toEqual({
    stage: "build", parked: { reason: "second prompt", at: "2026-10-23T10:00:00Z" },
  });
  expect(readUnit("r1", "u2")).toEqual({
    stage: "spine_ack", pr_url: "https://github.com/o/r/pull/7",
  });
});

test("readUnit is null for a missing run or unit", () => {
  expect(readUnit("nope", "u1")).toBeNull();
  expect(readUnit("r1", "nope")).toBeNull();
});

test("stageNames are the sorted recipe stage keys", () => {
  expect(stageNames("r1")).toEqual(["build", "review", "spine_ack"]);
  expect(stageNames("nope")).toEqual([]);
});

test("reviewedHead accepts only a full 40-hex sha on line 2", () => {
  expect(reviewedHead("r1", "u2")).toBe("a".repeat(40));
  expect(reviewedHead("r1", "u3")).toBeNull(); // short sha
  expect(reviewedHead("r1", "u4")).toBeNull(); // no line 2
  expect(reviewedHead("r1", "u1")).toBeNull(); // no file
});

test("newestPark is the last park event for the unit, skipping garbage", () => {
  expect(newestPark("r1", "u1")).toEqual({
    at: "t2", reason: "second prompt", thread: "th-2",
    questions: expect.stringMatching(/^\[\{"id":"q1","header":"Database","question":"which db\?"/),
  });
  expect(newestPark("r1", "u2")).toEqual({ at: "t1b", reason: "other" });
  expect(newestPark("r1", "u4")).toBeNull();
  expect(newestPark("nope", "u1")).toBeNull();
});

test("units is an object keyed by id: a unit is found by key, not by array search", () => {
  // a prototype-ish name must not resolve, and a null `parked` is not parked
  expect(readUnit("r1", "constructor")).toBeNull();
  expect(readUnit("r1", "u4")).toEqual({ stage: "build" });
  expect(readUnit("r2", "u1")).toBeNull();
});

test("readUnit marks a blocked park only when parked.blocked is an object", () => {
  expect(readUnit("r1", "u5")).toEqual({
    stage: "build", parked: { reason: "blocked", at: "2026-10-27T16:50:00.000Z", blocked: true },
  });
  // control: a string where baton writes an object is not a blocked park
  expect(readUnit("r1", "u6")).toEqual({
    stage: "build", parked: { reason: "blocked", at: "2026-10-27T16:50:00.000Z" },
  });
});

test("runRepo is params.repo when it is an absolute path, else null", () => {
  const root = mkdtempSync(join(tmpdir(), "bot-runrepo-"));
  try {
    process.env.BATON_STATE_DIR = root;
    const put = (run: string, doc: unknown) => {
      mkdirSync(join(root, "runs", run), { recursive: true });
      writeFileSync(join(root, "runs", run, "run.json"), JSON.stringify(doc));
    };
    put("a", { params: { repo: "/home/dev/agent-ops" } });
    put("b", { units: {} });
    put("c", { params: { repo: 3 } });
    put("d", { params: { repo: "rel/path" } });
    expect(runRepo("a")).toBe("/home/dev/agent-ops");
    expect(runRepo("b")).toBeNull();
    expect(runRepo("c")).toBeNull();
    expect(runRepo("d")).toBeNull();
    expect(runRepo("missing")).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("newestPark carries a stop_file path and the driver escalate action that follows its park", () => {
  const root = mkdtempSync(join(tmpdir(), "bot-park-"));
  try {
    process.env.BATON_STATE_DIR = root;
    mkdirSync(join(root, "runs", "a"), { recursive: true });
    const ev = (...lines: unknown[]) => writeFileSync(join(root, "runs", "a", "events.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    ev({ at: "t1", kind: "park", unit: "u", reason: "stop", stop_file: "/s/stop" },
      { at: "t2", kind: "driver escalate", unit: "u", action: "Plan round 2." },
      { at: "t2", kind: "driver escalate", unit: "other", action: "not mine" });
    expect(newestPark("a", "u")).toEqual({ at: "t1", reason: "stop", stop_file: "/s/stop", action: "Plan round 2." });
    // a newer park drops the older park's action; a relative stop_file is not a path baton wrote
    ev({ at: "t1", kind: "park", unit: "u", reason: "stop", stop_file: "/s/stop" },
      { at: "t2", kind: "driver escalate", unit: "u", action: "Plan round 2." },
      { at: "t3", kind: "park", unit: "u", reason: "stall", stop_file: "rel/stop" });
    expect(newestPark("a", "u")).toEqual({ at: "t3", reason: "stall" });
    // an escalate with no park before it belongs to nothing
    ev({ at: "t2", kind: "driver escalate", unit: "u", action: "x" });
    expect(newestPark("a", "u")).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readHead reads at most 8 KiB of a regular file and nothing else", () => {
  const root = mkdtempSync(join(tmpdir(), "bot-head-"));
  try {
    writeFileSync(join(root, "big"), "x".repeat(20000));
    writeFileSync(join(root, "small"), "halt: no spec");
    expect(readHead(join(root, "big"))!.length).toBe(8192);
    expect(readHead(join(root, "small"))).toBe("halt: no spec");
    expect(readHead(join(root, "missing"))).toBeNull();
    expect(readHead(root)).toBeNull(); // a directory
    execFileSync("mkfifo", [join(root, "fifo")]); // control: opening it must not block
    expect(readHead(join(root, "fifo"))).toBeNull();
    symlinkSync("/dev/zero", join(root, "zero")); // a device reads forever and never errors
    expect(readHead(join(root, "zero"))).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("newestPark(since) is the park's own event: the first one at or after since, a later park's ends the search", () => {
  const root = mkdtempSync(join(tmpdir(), "bot-since-"));
  try {
    process.env.BATON_STATE_DIR = root;
    mkdirSync(join(root, "runs", "a"), { recursive: true });
    const ev = (...lines: unknown[]) => writeFileSync(join(root, "runs", "a", "events.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    // parked.at is T2.000; baton appends its event a ms later
    ev({ at: "T1.002", kind: "park", unit: "u", reason: "first" },
      { at: "T1.500", kind: "driver escalate", unit: "u", action: "first action" },
      { at: "T2.001", kind: "park", unit: "u", reason: "second" },
      { at: "T2.500", kind: "driver escalate", unit: "u", action: "second action" },
      { at: "T3.001", kind: "park", unit: "u", reason: "third" },
      { at: "T3.500", kind: "driver escalate", unit: "u", action: "third action" });
    expect(newestPark("a", "u", "T2.000")).toEqual({ at: "T2.001", reason: "second", action: "second action" });
    expect(newestPark("a", "u", "T1.000")).toMatchObject({ reason: "first", action: "first action" });
    // control: without since it is the newest
    expect(newestPark("a", "u")).toMatchObject({ reason: "third", action: "third action" });
    // no event at or after since, or an event with no `at`, is no event
    expect(newestPark("a", "u", "T9")).toBeNull();
    ev({ kind: "park", unit: "u", reason: "no at" });
    expect(newestPark("a", "u", "T0")).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
