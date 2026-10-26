import { expect, test } from "bun:test";
import { runSummary } from "../src/summary.ts";
import type { RunState } from "../src/state.ts";

const run = (units: string[], armed = "2026-10-23T19:05:38Z"): RunState => ({
  id: "r3-s2", dir: "/x", recipe_sha256: "", params: {}, armed_at: armed, status: "done",
  units: Object.fromEntries(units.map((id) => [id, {} as never])),
});
const log = (...evs: Record<string, unknown>[]) => evs.map((e) => JSON.stringify({ at: "t", ...e })).join("\n") + "\n";
const NOW = "2026-10-25T05:12:04Z";

test("summary counts", () => {
  const text = log(
    { kind: "park", unit: "a" }, { kind: "park", unit: "b" }, { kind: "park", unit: "c" },
    { kind: "park", reason: "run level" }, // no unit: not a unit park
    { kind: "unpark", unit: "a" }, { kind: "unpark", unit: "b" }, { kind: "unpark", unit: "c" },
    { kind: "unpark" }, // run level
    { kind: "merged", unit: "a", pr: "https://h/pr/1" }, { kind: "merged", unit: "b", pr: "https://h/pr/2" },
    { kind: "merged", unit: "c", pr: "https://h/pr/3" }, { kind: "merged", unit: "d", pr: "https://h/pr/4" },
  );
  const s = runSummary(run(["a", "b", "c", "d"]), text, NOW);
  expect(s).toBe(
    "baton r3-s2 done — 4 units, 4 merged (https://h/pr/1, https://h/pr/2, https://h/pr/3, https://h/pr/4); " +
    "parks 3: driver resumed 0, sent to you 0, operator unparks 3; drivers 0; wall 34h06m");
});

test("summary driver counts, ledger, no merges, bad lines", () => {
  const text = log(
    { kind: "park", unit: "a" }, { kind: "driver", unit: "a" }, { kind: "driver resume", unit: "a" },
    { kind: "driver", unit: "b" }, { kind: "driver escalate", unit: "b" },
    { kind: "driver", unit: "c" }, { kind: "driver stop", unit: "c" },
  ) + "not json\n";
  const s = runSummary(run(["a"], "2026-10-25T05:00:00Z"), text, "2026-10-25T05:07:00Z", "/l/ledger.md");
  expect(s).toBe(
    "baton r3-s2 done — 1 units, 0 merged; parks 1: driver resumed 1, sent to you 2, operator unparks 0; " +
    "drivers 3; wall 0h07m; ledger /l/ledger.md");
});
