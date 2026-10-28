import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { close, find, record, type DeliveryRec } from "../src/deliveries.ts";
import { blockedOffer, offerFor, type Offer, type Picker } from "../src/offer.ts";
import { serve } from "../src/serve.ts";
import { spoolNotice } from "../src/spool.ts";
import { handleTap } from "../src/tap.ts";
import { captureErr, COLOURS, defaultRun, HEAD, makeEnv, P1, P5, PR, screenJson, serveOpts, type Env } from "./helpers.ts";

const T0 = new Date("2026-10-27T17:00:00Z");
const PARK = `r1/u1/park/${P1}`;
const BLOCKED = `r1/u5/park/${P5}`;
const MOVE = "r1/u2/review/2026-10-27T11:00:00.000Z";
let env: Env;
beforeEach(() => {
  env = makeEnv();
  // r1/u2 has a PR and a reviewed head
  const out = join(env.dir, "baton", "runs", "r1", "out", "u2");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "review.md"), `verdict: approve\nhead: ${HEAD}\n`);
});
afterEach(() => env.cleanup());

const ctx = () => ({ bot: env.bot, runner: env.runner, now: () => T0 });
const park = (): DeliveryRec => {
  const offer = offerFor({ kind: "unit-park", run: "r1", unit: "u1", at: P1 }, "baton r1/u1 parked in build: second prompt", "r1")!;
  const r: DeliveryRec = { key: PARK, phase: "asked", run: "r1", unit: "u1", park_at: P1, title: offer.title, offer, ask_id: "d1" };
  record(r);
  return r;
};
const move = (): DeliveryRec => {
  const offer = offerFor({ kind: "unit-move", run: "r1", unit: "u2", stage: "review" }, "baton r1/u2 moved to review", "r1")!;
  const r: DeliveryRec = { key: MOVE, phase: "asked", run: "r1", unit: "u2", title: offer.title, offer, ask_id: "d1" };
  record(r);
  return r;
};
const blocked = (picker: Picker = COLOURS as Picker, draft = { summary: "S", recommended: 2, why: "W" }): DeliveryRec => {
  const offer = blockedOffer("m", "r1", "u5", picker, draft);
  const r: DeliveryRec = { key: BLOCKED, phase: "asked", run: "r1", unit: "u5", park_at: P5, title: offer.title, offer, picker, ask_id: "d1" };
  record(r);
  return r;
};
const next = (key: string, n = 1) => find(`${key}#${n}`)!;
const labels = (o: Offer | undefined) => o!.options.map((x) => x.label);
const taps = (): Record<string, unknown>[] =>
  readFileSync(join(env.dir, "state", "taps.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("Unpark runs baton unpark and reports the result", async () => {
  const r = park();
  await handleTap(r, "Unpark", ctx());
  expect(env.runs).toEqual([["baton", "unpark", "r1", "u1"]]);
  expect(find(PARK)).toMatchObject({ phase: "closed", closed_by: "tap" });
  expect(next(PARK)).toMatchObject({ phase: "asked", say: "r1/u1 parked: Unpark — done" });
  expect(next(PARK).ask_id).toBeUndefined();
  expect(taps()).toEqual([{ at: T0.toISOString(), key: PARK, label: "Unpark", other: false, act: "unpark", rc: 0 }]);
});

test("Unpark on a question whose park was replaced runs nothing (CodeRabbit #938)", async () => {
  const r = park();
  const run = defaultRun();
  (run.units as Record<string, any>).u1.parked = { reason: "stalled", at: "2026-10-27T16:00:00.000Z" };
  env.writeRun(run);
  for (const label of ["Unpark", "Unpark to stage…"]) {
    record({ ...r, phase: "asked" });
    await handleTap(r, label, ctx());
  }
  expect(env.runs).toEqual([]);
  expect(next(PARK).say).toBe("r1/u1 parked: the park this question was for is gone; nothing ran.");
  // and a stage tapped on the stage list of the old park
  const stage = { ...r, key: `${PARK}#9`, offer: { ...r.offer!, options: [{ label: "review", act: { do: "unpark-stage" as const, stage: "review" } }] } };
  record(stage);
  await handleTap(stage, "review", ctx());
  expect(env.runs).toEqual([]);
});

test("a failing command reports its first stderr line", async () => {
  env.reply.fn = () => ({ rc: 2, stdout: "", stderr: "\nbaton unpark: not parked\nmore\n" });
  await handleTap(park(), "Unpark", ctx());
  expect(next(PARK).say).toBe("r1/u1 parked: Unpark — failed: baton unpark: not parked");
});

test("Unpark to stage asks the stage list; a stage runs unpark --to", async () => {
  await handleTap(park(), "Unpark to stage…", ctx());
  expect(env.runs).toEqual([]);
  const f = next(PARK);
  expect(labels(f.offer)).toEqual(["build", "review", "Cancel"]);
  expect(f).toMatchObject({ run: "r1", unit: "u1", park_at: P1 });
  await handleTap(f, "review", ctx());
  expect(env.runs).toEqual([["baton", "unpark", "r1", "u1", "--to", "review"]]);
  expect(next(PARK, 2).say).toBe("r1/u1 parked: Unpark to review — done");
});

test("Show question asks again with the same options and the park's details", async () => {
  writeFileSync(join(env.dir, "baton", "runs", "r1", "events.jsonl"),
    JSON.stringify({ kind: "park", unit: "u1", reason: "second prompt", thread: "th-2", questions: JSON.stringify([{ question: "which db?" }]) }) + "\n");
  const r = park();
  await handleTap(r, "Show question", ctx());
  expect(env.runs).toEqual([]);
  const f = next(PARK);
  expect(labels(f.offer)).toEqual(labels(r.offer));
  expect(f.offer!.text).toBe("r1/u1\nstage: build\nreason: second prompt\nquestions:\n- which db?\nthread: th-2");
});

test("Show question on a blocked park adds the screen's tail", async () => {
  env.reply.fn = (argv) => (argv[1] === "screen" ? { rc: 0, stdout: screenJson(), stderr: "" } : { rc: 0, stdout: "", stderr: "" });
  const r = blocked();
  await handleTap(r, "Show question", ctx());
  expect(env.runs).toEqual([["baton", "screen", "r1", "u5"]]);
  const f = next(BLOCKED);
  expect(labels(f.offer)).toEqual(labels(r.offer));
  expect(f.offer!.text).toContain("screen:\n╭─ Ask\n│ spike: which colour?\n│ ❯ ○ red");
  expect(f.picker).toEqual(COLOURS as Picker);
  expect(f.offer!.allowOther).toBe(true);
});

test("Disarm asks Yes/No; Yes runs baton disarm; No cancels", async () => {
  await handleTap(park(), "Disarm", ctx());
  expect(env.runs).toEqual([]);
  const f = next(PARK);
  expect(labels(f.offer)).toEqual(["Yes", "No"]);
  expect(f.offer!.text).toBe("Disarm run r1?");
  await handleTap(f, "Yes", ctx());
  expect(env.runs).toEqual([["baton", "disarm", "r1"]]);
  expect(next(PARK, 2).say).toBe("r1/u1 parked: Disarm — done");
  close(next(PARK, 2), "sent", T0);
  await handleTap(park(), "Disarm", ctx());
  await handleTap(next(PARK, 3), "No", ctx());
  expect(env.runs.length).toBe(1);
  expect(next(PARK, 4).say).toBe("Cancelled.");
});

test("Merge checks the PR, asks Yes/No, and Yes merges at the reviewed head", async () => {
  env.reply.fn = (argv) => (argv[2] === "view" ? { rc: 0, stdout: '{"number":7,"baseRefName":"main"}', stderr: "" } : { rc: 0, stdout: "", stderr: "" });
  await handleTap(move(), "Merge", ctx());
  expect(env.runs).toEqual([["gh", "pr", "view", PR, "--json", "number,baseRefName"]]);
  const f = next(MOVE);
  expect(labels(f.offer)).toEqual(["Yes", "No"]);
  expect(f.offer!.text).toBe("Merge PR #7 (head aaaaaaa) into main?");
  await handleTap(f, "Yes", ctx());
  expect(env.runs[1]).toEqual(["gh", "pr", "merge", PR, "--merge", "--match-head-commit", HEAD]);
});

test("merge without a matching base asks nothing and says why", async () => {
  env.reply.fn = () => ({ rc: 1, stdout: "", stderr: "GraphQL: Could not resolve to a PullRequest\n" });
  await handleTap(move(), "Merge", ctx());
  expect(env.runs).toEqual([["gh", "pr", "view", PR, "--json", "number,baseRefName"]]);
  expect(next(MOVE).offer).toBeUndefined();
  expect(next(MOVE).say).toBe("r1/u2 at review: Merge — failed: GraphQL: Could not resolve to a PullRequest");
  // a reply with no base is no confirm either
  close(next(MOVE), "sent", T0);
  env.reply.fn = () => ({ rc: 0, stdout: '{"number":7}', stderr: "" });
  await handleTap(move(), "Merge", ctx());
  expect(next(MOVE, 2).say).toBe("r1/u2 at review: Merge — failed: gh pr view gave no PR number and base");
  // a URL of another shape never reaches gh
  close(next(MOVE, 2), "sent", T0);
  const r = move();
  const bad = { ...r, offer: { ...r.offer!, options: [{ label: "Merge", act: { do: "merge" as const, pr_url: "https://evil.example/pull/7", head_sha: HEAD } }] } };
  record(bad);
  await handleTap(bad, "Merge", ctx());
  expect(env.runs.length).toBe(2);
  expect(next(MOVE, 3).say).toBe("r1/u2 at review: Merge — failed: not a PR URL");
});

test("Open PR replies with the URL and runs nothing", async () => {
  await handleTap(move(), "Open PR", ctx());
  expect(env.runs).toEqual([]);
  expect(next(MOVE).say).toBe(`r1/u2 at review: ${PR}`);
});

test("a worker option runs the screen-checked answer", async () => {
  await handleTap(blocked(), "red", ctx());
  expect(env.runs).toEqual([["baton", "answer", "r1", "u5", "--park", P5, "--screen", "1", "red"]]);
  expect(next(BLOCKED).say).toBe('r1/u5 waits on a question: sent "red" to the worker');
});

test("a recommended label maps to its plain label's pick", async () => {
  await handleTap(blocked(), "green (recommended)", ctx());
  expect(env.runs).toEqual([["baton", "answer", "r1", "u5", "--park", P5, "--screen", "2", "green"]]);
  expect(taps()[0]).toMatchObject({ label: "green (recommended)", other: false, act: "pick", rc: 0 });
});

test("a refused pick asks again with the refusal", async () => {
  env.reply.fn = () => ({ rc: 2, stdout: "", stderr: 'baton answer: line 2 is not "green"\n' });
  await handleTap(blocked(), "green (recommended)", ctx());
  const f = next(BLOCKED);
  expect(labels(f.offer)).toEqual(["Show question", "Disarm"]);
  expect(f.offer!.text).toBe('Not sent: baton answer: line 2 is not "green"');
  expect(f).toMatchObject({ run: "r1", unit: "u5", park_at: P5 });
  expect(f.offer!.allowOther).toBe(false);
});

test("free text reaches answerText as one argv element, and is not logged", async () => {
  const text = "use main; then $(rm -rf /) && echo `x`";
  await handleTap(blocked(), text, ctx());
  expect(env.runs).toEqual([["baton", "answer", "r1", "u5", "--park", P5, "--screen-text", text, "--question", "spike: which colour?"]]);
  expect(next(BLOCKED).say).toBe("r1/u5 waits on a question: sent your text to the worker");
  expect(taps()).toEqual([{ at: T0.toISOString(), key: BLOCKED, other: true, act: "text", rc: 0 }]);
  expect(readFileSync(join(env.dir, "state", "taps.jsonl"), "utf8")).not.toContain("rm -rf");
});

test("a refused text asks again with the refusal", async () => {
  env.reply.fn = () => ({ rc: 2, stdout: "", stderr: "baton answer: control bytes\n" });
  await handleTap(blocked(), "x", ctx());
  expect(next(BLOCKED).offer!.text).toBe("Not sent: baton answer: control bytes");
});

test("typed text on any other question runs nothing", async () => {
  await handleTap(park(), "please unpark", ctx());
  expect(env.runs).toEqual([]);
  expect(next(PARK).say).toBe("Typed answers only go to a blocked worker; nothing ran.");
  // a blocked park whose picker has no Other row takes no text either
  close(next(PARK), "sent", T0);
  await handleTap(blocked({ ...(COLOURS as Picker), other: null }), "x", ctx());
  expect(env.runs).toEqual([]);
  expect(next(BLOCKED).say).toBe("Typed answers only go to a blocked worker; nothing ran.");
});

test("an answer that matches nothing and is no text runs nothing", async () => {
  const { err } = await captureErr(() => handleTap(park(), "", ctx()));
  expect(env.runs).toEqual([]);
  expect(err).toEqual([`bot-on-openbot: ${PARK}: unmatched label; nothing ran\n`]);
  expect(next(PARK).say).toBe("That option is not one I offered; nothing ran.");
});

test("a tap on a closed delivery runs nothing", async () => {
  const r = park();
  close(r, "settled", T0);
  await handleTap(r, "Unpark", ctx());
  expect(env.runs).toEqual([]);
  expect(find(PARK)).toMatchObject({ closed_by: "settled" });
  expect(next(PARK).say).toBe("r1/u1 parked: this question is no longer open; nothing ran.");
  expect(taps()[0]).toMatchObject({ key: PARK, label: "Unpark", act: "closed" });
});

test("serve hands a tapped label to handleTap", async () => {
  env.setReplies({ run: [env.delivery("d1"), env.delivery("d2")] });
  env.status("d1", "running", "turn-1");
  env.status("d2", "running", "turn-2");
  env.resolve("turn-1", "Unpark");
  spoolNotice(PARK, "baton r1/u1 parked");
  await captureErr(() => serve(serveOpts(env, T0, 2)));
  expect(env.runs).toEqual([["baton", "unpark", "r1", "u1"]]);
  expect(env.runStdins()[1]).toBe("Send the operator this message, verbatim, and nothing else: r1/u1 parked: Unpark — done");
});

test("Yes on a merge whose URL is of another shape never reaches gh", async () => {
  const r = move();
  const bad = { ...r, offer: { ...r.offer!, options: [{ label: "Yes", act: { do: "merge-yes" as const, pr_url: "https://github.com/o/r/pull/7/../../x", head_sha: HEAD } }] } };
  record(bad);
  await handleTap(bad, "Yes", ctx());
  expect(env.runs).toEqual([]);
  expect(next(MOVE).say).toBe("r1/u2 at review: Merge — failed: not a PR URL");
});

// ---- issue #941: More…, typed labels not shown, stage pages -----------------------------------

const six: Picker = {
  kind: "omp-ask", question: "which?", other: 7,
  options: ["a1", "b2", "c3", "d4", "e5", "f6"].map((label, i) => ({ n: i + 1, label })),
};

test("More… asks Show question, Unpark, Disarm with the park; Unpark there runs baton unpark", async () => {
  const r = blocked();
  await handleTap(r, "More…", ctx());
  expect(env.runs).toEqual([]);
  const f = next(BLOCKED);
  expect(labels(f.offer)).toEqual(["Show question", "Unpark", "Disarm"]);
  expect(f).toMatchObject({ run: "r1", unit: "u5", park_at: P5, title: r.title });
  expect(f.picker).toEqual(COLOURS as Picker);
  expect(taps()[0]).toMatchObject({ label: "More…", act: "more" });
  await handleTap(f, "Unpark", ctx());
  expect(env.runs).toEqual([["baton", "unpark", "r1", "u5"]]);
});

test("Show question on the More… question asks the worker's options again", async () => {
  env.reply.fn = (argv) => (argv[1] === "screen" ? { rc: 0, stdout: screenJson(), stderr: "" } : { rc: 0, stdout: "", stderr: "" });
  const r = blocked();
  await handleTap(r, "More…", ctx());
  await handleTap(next(BLOCKED), "Show question", ctx());
  const f = next(BLOCKED, 2);
  expect(labels(f.offer)).toEqual(labels(r.offer));
  expect(f.offer!.allowOther).toBe(true);
  expect(f.offer!.text).toContain("screen:\n╭─ Ask");
  // and Disarm on the More… question asks Yes/No as before
  close(f, "sent", T0);
  await handleTap(blocked(), "More…", ctx());
  await handleTap(next(BLOCKED, 3), "Disarm", ctx());
  expect(labels(next(BLOCKED, 4).offer)).toEqual(["Yes", "No"]);
});

test("5 or more worker options: a typed exact label picks that option with its screen n", async () => {
  const r = blocked(six, { summary: "S", recommended: 2, why: "W" });
  expect(r.offer!.options.filter((o) => o.shown !== false).map((o) => o.label)).toEqual(["Show question", "Unpark", "Disarm"]);
  await handleTap(r, "e5", ctx());
  expect(env.runs).toEqual([["baton", "answer", "r1", "u5", "--park", P5, "--screen", "5", "e5"]]);
  expect(next(BLOCKED).say).toBe('r1/u5 waits on a question: sent "e5" to the worker');
  expect(taps()[0]).toMatchObject({ label: "e5", other: false, act: "pick" });
});

test("5 or more worker options: typed text that is no label goes as text; without Other it runs nothing", async () => {
  await handleTap(blocked(six), "e 5", ctx());
  expect(env.runs).toEqual([["baton", "answer", "r1", "u5", "--park", P5, "--screen-text", "e 5", "--question", "which?"]]);
  close(next(BLOCKED), "sent", T0);
  await handleTap(blocked({ ...six, other: null }), "e 5", ctx());
  expect(env.runs.length).toBe(1);
  expect(next(BLOCKED, 2).say).toBe("Typed answers only go to a blocked worker; nothing ran.");
});

test("the stage list pages with More stages…; a typed exact stage from another page unparks to it", async () => {
  writeFileSync(join(env.dir, "baton", "runs", "r1", "recipe.json"),
    JSON.stringify({ stages: Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((s) => [s, {}])) }));
  await handleTap(park(), "Unpark to stage…", ctx());
  const p1 = next(PARK);
  expect(p1.offer!.options.filter((o) => o.shown !== false).map((o) => o.label)).toEqual(["a", "b", "c", "d", "More stages…"]);
  await handleTap(p1, "More stages…", ctx());
  expect(env.runs).toEqual([]);
  const p2 = next(PARK, 2);
  expect(p2.offer!.options.filter((o) => o.shown !== false).map((o) => o.label)).toEqual(["e", "f", "Cancel"]);
  expect(p2).toMatchObject({ unit: "u1", park_at: P1 });
  await handleTap(p2, "b", ctx());
  expect(env.runs).toEqual([["baton", "unpark", "r1", "u1", "--to", "b"]]);
  // a typed stage on page 1 that page 1 does not show
  close(next(PARK, 3), "sent", T0);
  await handleTap(park(), "Unpark to stage…", ctx());
  await handleTap(next(PARK, 4), "f", ctx());
  expect(env.runs[1]).toEqual(["baton", "unpark", "r1", "u1", "--to", "f"]);
});

test("More stages… on a question whose park was replaced runs nothing and asks nothing", async () => {
  writeFileSync(join(env.dir, "baton", "runs", "r1", "recipe.json"),
    JSON.stringify({ stages: Object.fromEntries(["a", "b", "c", "d", "e"].map((s) => [s, {}])) }));
  await handleTap(park(), "Unpark to stage…", ctx());
  const run = defaultRun();
  (run.units as Record<string, any>).u1.parked = { reason: "stalled", at: "2026-10-27T16:00:00.000Z" };
  env.writeRun(run);
  writeFileSync(join(env.dir, "baton", "runs", "r1", "recipe.json"),
    JSON.stringify({ stages: Object.fromEntries(["a", "b", "c", "d", "e"].map((s) => [s, {}])) }));
  await handleTap(next(PARK), "More stages…", ctx());
  expect(next(PARK, 2).say).toBe("r1/u1 parked: the park this question was for is gone; nothing ran.");
});

test("on a blocked park with 1-4 options, a typed escape label is that escape, not text for the worker", async () => {
  await handleTap(blocked(), "Disarm", ctx());
  expect(env.runs).toEqual([]);
  expect(labels(next(BLOCKED).offer)).toEqual(["Yes", "No"]);
});
