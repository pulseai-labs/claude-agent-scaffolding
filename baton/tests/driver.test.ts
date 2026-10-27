import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ledgerLine, readDriverResult, renderDriverState } from "../src/driver.ts";
import type { DriverStage } from "../src/recipe.ts";
import type { RunState, UnitState } from "../src/state.ts";

let dir: string;
beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), "baton-driver-"))); });
afterEach(() => {});

const L = { q: "q", a: "a", why: "w", rejected: "r" };
const d = { clearing: ["rebase", "retry"], resume_to: { correct: ["reclose"] } } as unknown as DriverStage;
const put = (name: string, body: unknown) => {
  const p = join(dir, name);
  writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body));
  return p;
};
const inv = (body: unknown, park = "correct") => readDriverResult(put("r.json", body), d, park);

test("reads each result shape", () => {
  const a = { result: "resume", to: "reclose", cleared: "rebase", ledger: L };
  const b = { result: "escalate", action: "do x", ledger: L };
  const c = { result: "stop", reason: "done", ledger: L };
  expect(inv(a)).toEqual(a as never);
  expect(inv(b)).toEqual(b as never);
  expect(inv(c)).toEqual(c as never);
});

test("refusals", () => {
  expect(readDriverResult(join(dir, "none.json"), d, "correct")).toEqual({ invalid: "no result file" });
  expect(inv("{nope")).toEqual({ invalid: "not JSON" });
  expect(inv({ result: "maybe" })).toEqual({ invalid: 'unknown result "maybe"' });
  expect(inv({ result: "resume", cleared: "reboot", ledger: L }))
    .toEqual({ invalid: `cleared "reboot" is not in the recipe's clearing list` });
  expect(inv({ result: "resume", ledger: L })).toEqual({ invalid: "resume needs cleared" });
  expect(inv({ result: "resume", cleared: "rebase", to: "close", ledger: L }))
    .toEqual({ invalid: 'resume to "close" is not allowed from "correct"' });
  expect(inv({ result: "resume", cleared: "rebase", to: "done", ledger: L }))
    .toEqual({ invalid: 'resume to "done" is not allowed from "correct"' });
  expect(inv({ result: "resume", cleared: "rebase", to: "reclose", ledger: L }, "other"))
    .toEqual({ invalid: 'resume to "reclose" is not allowed from "other"' });
  expect(inv({ result: "escalate", action: "", ledger: L })).toEqual({ invalid: "escalate needs an action" });
  expect(inv({ result: "stop", reason: "", ledger: L })).toEqual({ invalid: "stop needs a reason" });
  expect(inv({ result: "stop", reason: "x", ledger: { a: "a", why: "w", rejected: "r" } }))
    .toEqual({ invalid: "ledger needs q, a, why, rejected" });
  expect(inv({ result: "stop", reason: "x" })).toEqual({ invalid: "ledger needs q, a, why, rejected" });
  expect(inv([1])).toEqual({ invalid: "not JSON" });
});

test("resume in place", () => {
  const r = readDriverResult(put("p.json", { result: "resume", cleared: "retry", ledger: L }), d, "anything");
  expect(r).toEqual({ result: "resume", cleared: "retry", ledger: L } as never);
});

test("clearing and resume_to are own-property lookups", () => {
  expect(inv({ result: "resume", cleared: "toString", ledger: L })).toEqual({ invalid: `cleared "toString" is not in the recipe's clearing list` });
  expect(inv({ result: "resume", cleared: "rebase", to: "x", ledger: L }, "constructor"))
    .toEqual({ invalid: 'resume to "x" is not allowed from "constructor"' });
});

test("ledgerLine collapses newlines", () => {
  const s = ledgerLine("2026-10-25T10:00:00Z", "b", { ...L, q: "a\nb", rejected: "x\r\ny" });
  expect(s).toBe("- 2026-10-25T10:00:00Z b driver | Q: a b | A: a | why: w | rejected: x y\n");
});

test("state file sections", () => {
  const mk = (id: string, order: number, over: Partial<UnitState> = {}): UnitState =>
    ({ id, group: 1, order, vars: {}, stage: "land", launches: { land: 1 }, stalls: 0, ...over });
  const run = {
    id: "r1", dir: "/x", recipe_sha256: "s", params: { repo: "o/r" }, armed_at: "2026-10-25T09:00:00Z", status: "armed",
    units: {
      a: mk("a", 1, { vars: { pr_url: "https://pr/1" } }),
      b: mk("b", 2, { parked: { reason: "outcome", at: "2026-10-25T10:05:00Z" } }),
    },
  } as RunState;
  const ev = [
    { at: "t1", kind: "transition", unit: "b", from: "x", to: "land" },
    { at: "t2", kind: "park", unit: "b", stage: "land", reason: "outcome", thread: "th1", pr: "https://pr/2", pr_state: "red", failing: ["tests"] },
    { at: "t4", kind: "transition", unit: "a", from: "x", to: "land" },
  ];
  const old = [
    { at: "t0", kind: "park", unit: "b", stage: "land", reason: "old" },
    { at: "t0b", kind: "transition", unit: "b", from: "land", to: "elsewhere" },
  ];
  const text = renderDriverState(run, run.units.b!, [...old, ...ev].map((e) => JSON.stringify(e)).join("\n") + "\n",
    { result_file: "/p/result.json", ledger: "/p/ledger.md", stop_file: "/p/stop" });
  expect(text).toContain("# Driver state — r1/b");
  expect(text).toContain("- repo: o/r");
  expect(text).toContain("| b | land | 1 | 0 | outcome @");
  expect(text).toContain("| a | land | 1 | 0 | - | https://pr/1 |");
  expect(text).toContain("- failing: tests");
  expect(text).toContain("- pr_state: red");
  expect(text).toContain("- thread: th1");
  const after = text.slice(text.indexOf("## Events since"));
  expect(after).toContain('"t2"');
  expect(after).not.toContain('"t1"');
  expect(after).not.toContain('"t0"');
  expect(after).not.toContain('"t4"');
  expect(text).toContain("/p/stop");
  const order = ["# Driver", "## Run", "## Units", "## This park", "## Events since", "## Paths"].map((s) => text.indexOf(s));
  expect(order).toEqual([...order].sort((x, y) => x - y));
  expect(order.every((i) => i >= 0)).toBe(true);
});

test("events are capped at 50 and no stop file omits the line", () => {
  const u: UnitState = { id: "a", group: 1, order: 1, vars: {}, stage: "s", launches: {}, stalls: 0 };
  const run = { id: "r", dir: "/x", recipe_sha256: "", params: {}, armed_at: "z", status: "armed", units: { a: u } } as RunState;
  const evs = Array.from({ length: 60 }, (_, i) => JSON.stringify({ at: `e${i}`, kind: "x", unit: "a" })).join("\n");
  const text = renderDriverState(run, u, evs, { result_file: "/r", ledger: "/l" });
  expect(text).toContain('"e59"');
  expect(text).toContain('"e10"');
  expect(text).not.toContain('"e9"');
  expect(text).not.toContain("stop");
});

test("an unpark or unit event also starts the window", () => {
  const u: UnitState = { id: "a", group: 1, order: 1, vars: {}, stage: "s", launches: {}, stalls: 0 };
  const run = { id: "r", dir: "/x", recipe_sha256: "", params: {}, armed_at: "z", status: "armed", units: { a: u } } as RunState;
  const mkText = (k: string) => renderDriverState(run, u, [
    { at: "before", kind: "park", unit: "a" }, { at: "mid", kind: k, unit: "a" }, { at: "after", kind: "park", unit: "a" },
  ].map((e) => JSON.stringify(e)).join("\n"), { result_file: "/r", ledger: "/l" });
  for (const k of ["unpark", "unit"]) {
    expect(mkText(k)).toContain('"after"');
    expect(mkText(k)).not.toContain('"before"');
  }
});

test("a driver resume into the unit's stage starts the window; one into another stage does not", () => {
  const u: UnitState = { id: "a", group: 1, order: 1, vars: {}, stage: "s", launches: {}, stalls: 0 };
  const run = { id: "r", dir: "/x", recipe_sha256: "", params: {}, armed_at: "z", status: "armed", units: { a: u } } as RunState;
  const mkText = (to: string) => renderDriverState(run, u, [
    { at: "before", kind: "park", unit: "a" }, { at: "mid", kind: "driver resume", unit: "a", from: "p", to },
    { at: "after", kind: "park", unit: "a" },
  ].map((e) => JSON.stringify(e)).join("\n"), { result_file: "/r", ledger: "/l" });
  const window = (t: string) => t.slice(t.indexOf("## Events since"), t.indexOf("## Paths"));
  expect(window(mkText("s"))).toContain('"after"');
  expect(window(mkText("s"))).not.toContain('"before"');
  expect(window(mkText("other"))).toContain('"before"');
});
