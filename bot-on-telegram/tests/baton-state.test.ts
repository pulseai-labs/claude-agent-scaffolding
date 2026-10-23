import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { newestPark, readUnit, reviewedHead, stageNames } from "../src/baton-state.ts";

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
    reason: "second prompt", thread: "th-2",
    questions: expect.stringMatching(/^\[\{"id":"q1","header":"Database","question":"which db\?"/),
  });
  expect(newestPark("r1", "u2")).toEqual({ reason: "other" });
  expect(newestPark("r1", "u4")).toBeNull();
  expect(newestPark("nope", "u1")).toBeNull();
});

test("units is an object keyed by id: a unit is found by key, not by array search", () => {
  // a prototype-ish name must not resolve, and a null `parked` is not parked
  expect(readUnit("r1", "constructor")).toBeNull();
  expect(readUnit("r1", "u4")).toEqual({ stage: "build" });
  expect(readUnit("r2", "u1")).toBeNull();
});
