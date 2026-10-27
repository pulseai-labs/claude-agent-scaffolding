import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { blockedOffer, confirmOffer, LABELS, offerFor, stageOffer, type Offer, type Picker } from "../src/offer.ts";

beforeEach(() => {
  process.env.BATON_STATE_DIR = join(import.meta.dir, "fixtures", "baton");
});
afterEach(() => {
  delete process.env.BATON_STATE_DIR;
});

const labels = (o: Offer | null) => o!.options.map((x) => x.label);
const MSG = "baton r1/u1 parked in build: second prompt";
const PR = "https://github.com/o/r/pull/7";
const pick3: Picker = {
  kind: "omp-ask", question: "which?", other: 4,
  options: [{ n: 1, label: "a" }, { n: 2, label: "b" }, { n: 3, label: "c" }],
};

test("unit park offers the four actions", () => {
  const o = offerFor({ kind: "unit-park", run: "r1", unit: "u1", at: "x" }, MSG, "r1")!;
  expect(labels(o)).toEqual(["Unpark", "Unpark to stage…", "Show question", "Disarm"]);
  expect(o.options.map((x) => x.act)).toEqual([{ do: "unpark" }, { do: "unpark-to" }, { do: "show" }, { do: "disarm" }]);
  expect(o.text).toBe(MSG);
  expect(o.allowOther).toBe(false);
});

test("unit move with PR and reviewed head offers Merge, Open PR, Disarm", () => {
  const o = offerFor({ kind: "unit-move", run: "r1", unit: "u2", stage: "spine_ack" }, "moved", "r1")!;
  expect(labels(o)).toEqual(["Merge", "Open PR", "Disarm"]);
  expect(o.options[0]!.act).toEqual({ do: "merge", pr_url: PR, head_sha: "a".repeat(40) });
  expect(o.options[1]!.act).toEqual({ do: "open-pr", pr_url: PR });
});

test("unit move without reviewed head: Open PR, Disarm", () => {
  expect(labels(offerFor({ kind: "unit-move", run: "r1", unit: "u3", stage: "spine_ack" }, "m", "r1"))).toEqual(["Open PR", "Disarm"]);
});

test("unit move without PR: Disarm", () => {
  expect(labels(offerFor({ kind: "unit-move", run: "r1", unit: "u4", stage: "build" }, "m", "r1"))).toEqual(["Disarm"]);
});

test("run park offers Disarm", () => {
  expect(labels(offerFor({ kind: "run-park", run: "r1" }, "m", "r1"))).toEqual(["Disarm"]);
});

test("run done and plain are null; so is a unit or run that cannot be read", () => {
  expect(offerFor({ kind: "run-done", run: "r1" }, "m", "r1")).toBeNull();
  expect(offerFor({ kind: "plain" }, "m", "")).toBeNull();
  expect(offerFor({ kind: "unit-park", run: "r1", unit: "nope", at: "x" }, "m", "r1")).toBeNull();
  expect(offerFor({ kind: "run-park", run: "r3" }, "m", "r3")).toBeNull();
});

test("blocked offer puts the recommended option first with the mark", () => {
  const o = blockedOffer(MSG, "r1", "u5", pick3, { summary: "It asks which.", recommended: 2, why: "b is safest" });
  expect(labels(o)).toEqual(["b (recommended)", "a", "c", "Show question", "Unpark", "Disarm"]);
  expect(o.options[0]!.act).toEqual({ do: "pick", n: 2, label: "b" });
  expect(o.options[1]!.act).toEqual({ do: "pick", n: 1, label: "a" });
  expect(o.text).toBe("It asks which.\nRecommended: b is safest");
});

test("blocked offer with a draft whose number is not on the picker has no mark", () => {
  const o = blockedOffer(MSG, "r1", "u5", pick3, { summary: "It asks which.", recommended: 9, why: "?" });
  expect(labels(o)).toEqual(["a", "b", "c", "Show question", "Unpark", "Disarm"]);
  expect(o.text).toBe("It asks which.");
});

test("blocked offer with a picker and no draft keeps screen order and the notice text", () => {
  const o = blockedOffer(MSG, "r1", "u5", pick3, null);
  expect(labels(o)).toEqual(["a", "b", "c", "Show question", "Unpark", "Disarm"]);
  expect(o.text).toBe(MSG);
});

test("blocked offer with no picker", () => {
  const o = blockedOffer(MSG, "r1", "u5", null, null);
  expect(labels(o)).toEqual(["Show question", "Unpark", "Disarm"]);
  expect(o.text.endsWith("answer it in the Orca terminal")).toBe(true);
  expect(o.allowOther).toBe(false);
});

test("blocked offer allows Other only when the picker has an Other row", () => {
  expect(blockedOffer(MSG, "r1", "u5", pick3, null).allowOther).toBe(true);
  expect(blockedOffer(MSG, "r1", "u5", { ...pick3, other: null }, null).allowOther).toBe(false);
});

test("a worker label equal to an action label is offered once, as the worker's", () => {
  const p: Picker = { kind: "numbered", question: "Q", other: null, options: [{ n: 1, label: "Disarm" }, { n: 2, label: "keep" }] };
  const o = blockedOffer(MSG, "r1", "u5", p, null);
  expect(labels(o)).toEqual(["Disarm", "keep", "Show question", "Unpark"]);
  expect(o.options[0]!.act).toEqual({ do: "pick", n: 1, label: "Disarm" });
});

test("a recommended mark that would repeat another label is dropped", () => {
  const p: Picker = { kind: "numbered", question: "Q", other: null, options: [{ n: 1, label: "b" }, { n: 2, label: "b (recommended)" }] };
  const o = blockedOffer(MSG, "r1", "u5", p, { summary: "s", recommended: 1, why: "w" });
  expect(labels(o)).toEqual(["b", "b (recommended)", "Show question", "Unpark", "Disarm"]);
  expect(new Set(labels(o)).size).toBe(labels(o).length);
});

test("a picker with a repeated label offers no worker options", () => {
  const p: Picker = { kind: "numbered", question: "Q", other: null, options: [{ n: 1, label: "x" }, { n: 2, label: "x" }] };
  expect(labels(blockedOffer(MSG, "r1", "u5", p, null))).toEqual(["Show question", "Unpark", "Disarm"]);
});

test("stage offer lists the recipe's stages", () => {
  const o = stageOffer("r1", "r1/u1 parked");
  expect(labels(o)).toEqual(["build", "review", "spine_ack", "Cancel"]);
  expect(o.options[0]!.act).toEqual({ do: "unpark-stage", stage: "build" });
  expect(o.options[3]!.act).toEqual({ do: "no" });
  expect(o.title).toBe("r1/u1 parked");
});

test("confirm offers Yes with the carried act, and No", () => {
  const carry = { do: "merge-yes" as const, pr_url: PR, head_sha: "a".repeat(40) };
  const o = confirmOffer("merge", carry, "t", "Merge PR #7 (head aaaaaaa) into main?");
  expect(o.options).toEqual([{ label: LABELS.yes, act: carry }, { label: LABELS.no, act: { do: "no" } }]);
  expect(o.text).toBe("Merge PR #7 (head aaaaaaa) into main?");
  expect(confirmOffer("disarm", { do: "disarm-yes" }, "t", "Disarm run r1?").options[0]!.act).toEqual({ do: "disarm-yes" });
});
