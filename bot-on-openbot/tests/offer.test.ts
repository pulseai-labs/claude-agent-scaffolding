import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  blockedOffer, confirmOffer, LABELS, MAX_SHOWN, moreOffer, offerFor, refusedOffer, shownLabels, stageOffer, type Offer, type Picker,
} from "../src/offer.ts";

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
  expect(shownLabels(o)).toEqual(["b (recommended)", "a", "c", "More…"]);
  expect(o.options[0]!.act).toEqual({ do: "pick", n: 2, label: "b" });
  expect(o.options[1]!.act).toEqual({ do: "pick", n: 1, label: "a" });
  expect(o.text).toBe("It asks which.\nRecommended: b is safest");
});

test("blocked offer with a draft whose number is not on the picker has no mark", () => {
  const o = blockedOffer(MSG, "r1", "u5", pick3, { summary: "It asks which.", recommended: 9, why: "?" });
  expect(shownLabels(o)).toEqual(["a", "b", "c", "More…"]);
  expect(o.text).toBe("It asks which.");
});

test("blocked offer with a picker and no draft keeps screen order and the notice text", () => {
  const o = blockedOffer(MSG, "r1", "u5", pick3, null);
  expect(shownLabels(o)).toEqual(["a", "b", "c", "More…"]);
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

test("a worker label equal to an action label is the worker's; the action is on the More… question", () => {
  const p: Picker = { kind: "numbered", question: "Q", other: null, options: [{ n: 1, label: "Disarm" }, { n: 2, label: "keep" }] };
  const o = blockedOffer(MSG, "r1", "u5", p, null);
  expect(shownLabels(o)).toEqual(["Disarm", "keep", "More…"]);
  expect(o.options.filter((x) => x.label === "Disarm").length).toBe(1);
  expect(o.options[0]!.act).toEqual({ do: "pick", n: 1, label: "Disarm" });
  expect(labels(moreOffer(o))).toEqual(["Show question", "Unpark", "Disarm"]);
});

test("a recommended mark that would repeat another label is dropped", () => {
  const p: Picker = { kind: "numbered", question: "Q", other: null, options: [{ n: 1, label: "b" }, { n: 2, label: "b (recommended)" }] };
  const o = blockedOffer(MSG, "r1", "u5", p, { summary: "s", recommended: 1, why: "w" });
  expect(shownLabels(o)).toEqual(["b", "b (recommended)", "More…"]);
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

// ---- issue #941: an OpenBot question shows at most 5 options ----------------------------------

const picker = (n: number, other: number | null = n + 1): Picker => ({
  kind: "omp-ask", question: "which?", other,
  options: Array.from({ length: n }, (_, i) => ({ n: i + 1, label: `opt${i + 1}` })),
});
const hidden = (o: Offer) => o.options.filter((x) => x.shown === false).map((x) => x.label);

function withStages(n: number, f: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), "bot-ob-stages-"));
  const rd = join(dir, "runs", "r9");
  mkdirSync(rd, { recursive: true });
  writeFileSync(join(rd, "recipe.json"), JSON.stringify({ stages: Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i + 1}`, {}])) }));
  const was = process.env.BATON_STATE_DIR;
  process.env.BATON_STATE_DIR = dir;
  try {
    f();
  } finally {
    process.env.BATON_STATE_DIR = was;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("MAX_SHOWN is 5", () => {
  expect(MAX_SHOWN).toBe(5);
});

test("no builder shows more than 5 labels, and labels within an offer are unique", () => {
  const offers: Offer[] = [
    offerFor({ kind: "unit-park", run: "r1", unit: "u1", at: "x" }, MSG, "r1")!,
    offerFor({ kind: "unit-move", run: "r1", unit: "u2", stage: "spine_ack" }, "m", "r1")!,
    offerFor({ kind: "run-park", run: "r1" }, "m", "r1")!,
    blockedOffer(MSG, "r1", "u5", null, null),
    confirmOffer("disarm", { do: "disarm-yes" }, "t", "Disarm run r1?"),
    refusedOffer("t", "Not sent: x"),
    stageOffer("r1", "t"),
  ];
  for (let n = 1; n <= 9; n++) {
    for (const draft of [null, { summary: "s", recommended: 1, why: "w" }]) {
      const o = blockedOffer(MSG, "r1", "u5", picker(n), draft);
      offers.push(o, moreOffer(o));
    }
  }
  withStages(13, () => {
    for (let from = 0; from < 13; from += 4) offers.push(stageOffer("r9", "t", from));
  });
  for (const o of offers) {
    expect(shownLabels(o).length).toBeGreaterThan(0);
    expect(shownLabels(o).length).toBeLessThanOrEqual(MAX_SHOWN);
    expect(new Set(labels(o)).size).toBe(labels(o).length);
  }
});

test("shown defaults to true; shownLabels keeps the offer's order", () => {
  const o: Offer = {
    title: "t", text: "x", allowOther: false,
    options: [{ label: "a", act: { do: "no" } }, { label: "b", act: { do: "no" }, shown: false }, { label: "c", act: { do: "no" }, shown: true }],
  };
  expect(shownLabels(o)).toEqual(["a", "c"]);
});

test("a blocked park with 4 options shows the 4, the recommended first, then More…", () => {
  const o = blockedOffer(MSG, "r1", "u5", picker(4), { summary: "S", recommended: 3, why: "W" });
  expect(shownLabels(o)).toEqual(["opt3 (recommended)", "opt1", "opt2", "opt4", "More…"]);
  expect(hidden(o)).toEqual(["Show question", "Unpark", "Disarm"]);
  expect(o.options.find((x) => x.label === "Disarm")!.act).toEqual({ do: "disarm" });
  expect(o.options[4]!.act).toEqual({ do: "more" });
  expect(o.allowOther).toBe(true);
  expect(o.text).toBe("S\nRecommended: W");
});

test("More… asks Show question, Unpark, Disarm, and Show question goes back to the worker's options", () => {
  const o = blockedOffer(MSG, "r1", "u5", picker(2), null);
  const m = moreOffer(o);
  expect(labels(m)).toEqual(["Show question", "Unpark", "Disarm"]);
  expect(m.options.map((x) => x.act)).toEqual([{ do: "show" }, { do: "unpark" }, { do: "disarm" }]);
  expect(m.title).toBe(o.title);
  expect(m.allowOther).toBe(false);
  expect(m.back).toEqual(o);
});

test("a worker label equal to More… shows no worker buttons", () => {
  const p: Picker = { kind: "numbered", question: "Q", other: null, options: [{ n: 1, label: "More…" }, { n: 2, label: "keep" }] };
  const o = blockedOffer(MSG, "r1", "u5", p, null);
  expect(shownLabels(o)).toEqual(["Show question", "Unpark", "Disarm"]);
  expect(hidden(o)).toEqual(["More…", "keep"]);
});

test("a blocked park with 5 or more options shows only the escapes, and accepts every worker label typed", () => {
  for (const n of [5, 7]) {
    const o = blockedOffer(MSG, "r1", "u5", picker(n), null);
    expect(shownLabels(o)).toEqual(["Show question", "Unpark", "Disarm"]);
    expect(hidden(o)).toEqual(Array.from({ length: n }, (_, i) => `opt${i + 1}`));
    expect(o.options.find((x) => x.label === `opt${n}`)!.act).toEqual({ do: "pick", n, label: `opt${n}` });
    expect(o.allowOther).toBe(true);
    const last = o.text.split("\n").at(-1)!;
    expect(last).toBe(`Type one option's exact label to answer: ${Array.from({ length: n }, (_, i) => `"opt${i + 1}"`).join(", ")}`);
    expect(o.text.startsWith(`${MSG}\n`)).toBe(true);
  }
  // control: 4 is still shown as buttons
  expect(shownLabels(blockedOffer(MSG, "r1", "u5", picker(4), null))).toEqual(["opt1", "opt2", "opt3", "opt4", "More…"]);
});

test("5 or more options with a draft: the summary, the recommended label named, then the typing line", () => {
  const o = blockedOffer(MSG, "r1", "u5", picker(6, null), { summary: "S", recommended: 2, why: "W" });
  expect(o.text).toBe(`S\nRecommended: opt2 (W)\nType one option's exact label to answer: "opt1", "opt2", "opt3", "opt4", "opt5", "opt6"`);
  expect(o.allowOther).toBe(false);
});

test("5 or more options: a worker label equal to an escape is the escape's", () => {
  const p = picker(5);
  p.options[0] = { n: 1, label: "Disarm" };
  const o = blockedOffer(MSG, "r1", "u5", p, null);
  expect(o.options.filter((x) => x.label === "Disarm").map((x) => x.act)).toEqual([{ do: "disarm" }]);
});

test("the stage list pages 4 at a time with More stages…, and accepts every stage on every page", () => {
  withStages(9, () => {
    const all = Array.from({ length: 9 }, (_, i) => `s${i + 1}`);
    const p1 = stageOffer("r9", "t");
    expect(shownLabels(p1)).toEqual(["s1", "s2", "s3", "s4", "More stages…"]);
    expect(p1.options.find((x) => x.label === "More stages…")!.act).toEqual({ do: "stages", from: 4 });
    const p2 = stageOffer("r9", "t", 4);
    expect(shownLabels(p2)).toEqual(["s5", "s6", "s7", "s8", "More stages…"]);
    expect(p2.options.find((x) => x.label === "More stages…")!.act).toEqual({ do: "stages", from: 8 });
    const p3 = stageOffer("r9", "t", 8);
    expect(shownLabels(p3)).toEqual(["s9", "Cancel"]);
    for (const p of [p1, p2, p3]) {
      expect(labels(p).filter((l) => /^s\d$/.test(l)).sort()).toEqual(all);
      expect(p.options.find((x) => x.label === "s7")!.act).toEqual({ do: "unpark-stage", stage: "s7" });
      expect(p.options.find((x) => x.label === "Cancel")!.act).toEqual({ do: "no" });
    }
  });
  // exactly 4 stages: one page, with Cancel
  withStages(4, () => expect(shownLabels(stageOffer("r9", "t"))).toEqual(["s1", "s2", "s3", "s4", "Cancel"]));
});
