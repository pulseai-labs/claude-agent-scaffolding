import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentOf, all, close, find, followUp, followUpKey, open, record, type DeliveryRec } from "../src/deliveries.ts";
import { serve } from "../src/serve.ts";
import { captureErr, makeEnv, serveOpts } from "./helpers.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bot-deliv-"));
  process.env.BOT_ON_OPENBOT_STATE_DIR = dir;
});
afterEach(() => {
  delete process.env.BOT_ON_OPENBOT_STATE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const rec = (key: string, over: Partial<DeliveryRec> = {}): DeliveryRec =>
  ({ key, phase: "asked", run: "r1", unit: "u1", park_at: "p", title: "t", ask_id: "d", ...over });
const T = new Date("2026-10-27T12:00:00Z");

test("the last record per key wins; open leaves out closed ones", () => {
  record(rec("a"));
  record(rec("b", { phase: "drafting" }));
  close(rec("a"), "tap", T);
  expect(all().map((r) => [r.key, r.phase])).toEqual([["a", "closed"], ["b", "drafting"]]);
  expect(open().map((r) => r.key)).toEqual(["b"]);
  expect(find("a")).toMatchObject({ closed_by: "tap", closed_at: T.toISOString() });
  expect(find("nope")).toBeUndefined();
});

test("a torn line is skipped", () => {
  record(rec("a"));
  appendFileSync(join(dir, "deliveries.jsonl"), '{"key":"b","pha');
  appendFileSync(join(dir, "deliveries.jsonl"), "\n");
  record(rec("c"));
  expect(all().map((r) => r.key)).toEqual(["a", "c"]);
});

test("a torn tail with no newline does not swallow the next record (review #938 1)", () => {
  record(rec("a"));
  appendFileSync(join(dir, "deliveries.jsonl"), '{"key":"b","pha');
  record(rec("c"));
  expect(all().map((r) => r.key)).toEqual(["a", "c"]);
});

test("follow-up keys count past the highest in use, from the notice key", () => {
  expect(followUpKey("r1/u1/park/x")).toBe("r1/u1/park/x#1");
  record(rec("r1/u1/park/x#1"));
  record(rec("r1/u1/park/x#3"));
  expect(followUpKey("r1/u1/park/x#3")).toBe("r1/u1/park/x#4");
  // another notice's follow-ups do not count
  expect(followUpKey("r1/u1/park/y")).toBe("r1/u1/park/y#1");
});

test("a follow-up carries the parent's run, unit and park and opens unsent", () => {
  const parent = rec("k");
  const f = followUp(parent, { say: "done" });
  expect(f).toEqual({ key: "k#1", phase: "asked", run: "r1", unit: "u1", park_at: "p", title: "t", say: "done" });
  expect(f.ask_id).toBeUndefined();
});

test("a follow-up carries the parent's agent", () => {
  expect(followUp(rec("k", { agent: "p_bot" }), { say: "done" }).agent).toBe("p_bot");
  expect("agent" in followUp(rec("j"), { say: "done" })).toBe(false);
});

test("a 0.1.x record without agent reads as the default", async () => {
  expect(agentOf(rec("a"), "Autopilot")).toBe("Autopilot");
  expect(agentOf(rec("a", { agent: "p_bot" }), "Autopilot")).toBe("p_bot");
  const env = makeEnv();
  try {
    record({ key: "r1/done", phase: "asked", run: "r1", title: "t", say: "t", ask_id: "d1" }); // as 0.1.x wrote it
    env.status("d1", "running", "turn-1");
    await captureErr(() => serve(serveOpts(env, T)));
    expect(env.calls().map((c) => c.argv)).toEqual([["status", "Autopilot", "d1", "--json"]]);
  } finally {
    env.cleanup();
  }
});
