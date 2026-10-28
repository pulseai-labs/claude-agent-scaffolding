// Issue #943: an OpenBot restart expires the open question (openbot-db-prompt-resolved-expired.json)
// and interrupts its delivery (status-interrupted-after-restart.json). Nothing runs. The question is
// asked again once while its park is open; else, or the second time, it closes with a message.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { find, record } from "../src/deliveries.ts";
import { serve } from "../src/serve.ts";
import { spoolNotice } from "../src/spool.ts";
import { messageTask } from "../src/task.ts";
import { captureErr, defaultRun, FIX, makeEnv, P1, serveOpts, type Env } from "./helpers.ts";

const T0 = new Date("2026-10-28T02:00:00Z");
const PARK = `r1/u1/park/${P1}`;
const FIRM = "Use your question tool";
const EXPIRED = "r1/u1 parked: the question expired in OpenBot (OpenBot restarted), so nothing ran. Act in the Orca terminal or with baton.";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(() => env.cleanup());

const run = (stopAfter = 1) => captureErr(() => serve(serveOpts(env, T0, stopAfter)));
const runIds = () => env.calls().filter((c) => c.argv[0] === "run").map((c) => c.argv[4]);

// The recorded expired row, moved to `turnId`.
function expire(turnId: string): void {
  env.resolve(turnId, "x", (p) => {
    const e = JSON.parse(readFileSync(join(FIX, "openbot-db-prompt-resolved-expired.json"), "utf8"));
    e.detail.turnId = turnId;
    e.changedMessages[0].turnId = turnId;
    Object.assign(p, e);
  });
}

// The recorded status of a delivery a restart interrupted, for `id` (exit 1, as recorded). Replies
// restart their lists when set, so `next` are the deliveries the following runs return.
function interrupted(id: string, turnId: string, next: string[]): void {
  const rec = JSON.parse(readFileSync(join(FIX, "status-interrupted-after-restart.json"), "utf8"));
  env.setReplies({ [`status ${id}`]: { stdout: JSON.stringify({ ...rec, id, turnId }), rc: 1 }, run: next.map((d) => env.delivery(d)) });
}

// A park asked (d1, turn-1) and then expired by a restart; the re-ask is d2 (turn-2), a message d3.
async function askedThenExpired(): Promise<void> {
  env.setReplies({ run: [env.delivery("d1"), env.delivery("d2"), env.delivery("d3")] });
  env.status("d1", "running", "turn-1");
  env.status("d2", "running", "turn-2");
  env.status("d3", "running", "turn-3");
  spoolNotice(PARK, "baton r1/u1 parked in build: second prompt");
  await run();
  expect(find(PARK)).toMatchObject({ phase: "asked", ask_id: "d1" });
  interrupted("d1", "turn-1", ["d2", "d3"]);
  expire("turn-1");
}

test("a delivery that is starting is not a state the bot does not know: the question stays open", async () => {
  env.setReplies({ run: env.delivery("d1") });
  env.setReplies({ "status d1": { stdout: JSON.stringify({ ok: true, exitCode: 0, id: "d1", status: "starting", turnId: null, answer: null }), rc: 0 } });
  spoolNotice(PARK, "m");
  const r = await run(2);
  expect(r.err.join("")).not.toContain("does not know");
  expect(r.err.filter((l) => l.includes("poll"))).toEqual([]);
  expect(find(PARK)).toMatchObject({ phase: "asked", ask_id: "d1" });
});

test("an expired question whose park is still open is asked again once, with the normal wording", async () => {
  await askedThenExpired();
  const r = await run();
  expect(r.err.join("")).toContain(`${PARK}: the question expired in OpenBot; asked again`);
  expect(runIds()).toEqual([PARK, `${PARK}#reask`]);
  const [first, again] = env.runStdins();
  expect(again).toBe(first); // the first ask had its options: nothing to be firmer about
  expect(again).not.toContain(FIRM);
  expect(find(PARK)).toMatchObject({ phase: "asked", ask_id: "d2", reasks: 1, expired: true });
  expect(env.runs).toEqual([]); // nothing ran
  // the re-ask waits like any question: no third run
  await run(2);
  expect(runIds()).toEqual([PARK, `${PARK}#reask`]);
});

test("an expired question whose park is gone, or whose run ended, is closed with a message and nothing runs", async () => {
  const gone: [string, Record<string, unknown>][] = [
    ["unparked", defaultRun({ units: { u1: { id: "u1", stage: "build", parked: null, vars: {} } } })],
    ["a newer park", defaultRun({ units: { u1: { id: "u1", stage: "build", parked: { reason: "r", at: "2026-10-28T01:00:00.000Z" }, vars: {} } } })],
    ["run disarmed", defaultRun({ status: "disarmed" })],
    ["a run status this bot does not know", defaultRun({ status: "paused" })], // unknown is not open
  ];
  for (const [what, doc] of gone) {
    env.cleanup();
    env = makeEnv();
    await askedThenExpired();
    env.writeRun(doc);
    const r = await run(3);
    expect([what, r.err.join("")]).toEqual([what, expect.stringContaining(`${PARK}: the question expired in OpenBot; closed`)]);
    expect([what, find(PARK)]).toEqual([what, expect.objectContaining({ phase: "closed", closed_by: "gone" })]);
    expect([what, find(PARK)!.reasks]).toEqual([what, undefined]);
    expect([what, runIds()]).toEqual([what, [PARK, `${PARK}#1`]]); // one message, never a re-ask
    expect(env.runStdins()[1]).toBe(messageTask(EXPIRED));
    expect(env.runs).toEqual([]);
  }
});

test("an expired re-ask is closed with the message: a question is asked at most twice", async () => {
  await askedThenExpired();
  await run();
  expect(find(PARK)).toMatchObject({ reasks: 1, ask_id: "d2" });
  interrupted("d2", "turn-2", ["d3"]);
  expire("turn-2");
  const r = await run(3);
  expect(r.err.join("")).toContain(`${PARK}: the question expired in OpenBot; closed`);
  expect(find(PARK)).toMatchObject({ phase: "closed", closed_by: "gone", reasks: 1 });
  expect(runIds()).toEqual([PARK, `${PARK}#reask`, `${PARK}#1`]);
  expect(env.runStdins()[2]).toBe(messageTask(EXPIRED));
  expect(env.runs).toEqual([]);
});

test("a malformed re-ask spends the budget too: an expiry after it closes", async () => {
  // a re-ask already spent on a malformed prompt (#939), as recorded before the restart
  await askedThenExpired();
  record({ ...find(PARK)!, reasks: 1, ask_id: "d1" });
  await run(3);
  expect(find(PARK)).toMatchObject({ phase: "closed", closed_by: "gone" });
  expect(runIds()).toEqual([PARK, `${PARK}#1`]);
  expect(env.runStdins()[1]).toBe(messageTask(EXPIRED));
});

test("a re-ask OpenBot refuses, or one recorded but never sent (a crash), goes once on a later loop with its own id", async () => {
  await askedThenExpired();
  env.setReplies({ run: [{ stdout: '{"ok":false,"exitCode":1,"error":"limit"}', rc: 1 }, env.delivery("d2")] });
  const r = await run();
  expect(r.err.join("")).toContain("poll:");
  const rec = find(PARK)!;
  expect(rec).toMatchObject({ phase: "asked", reasks: 1, expired: true });
  expect(rec.ask_id).toBeUndefined(); // the expired turn is never read again
  await run(3);
  expect(find(PARK)).toMatchObject({ phase: "asked", reasks: 1, ask_id: "d2" });
  expect(runIds()).toEqual([PARK, `${PARK}#reask`, `${PARK}#reask`]); // the same --id: OpenBot returns one delivery
  expect(env.runStdins()[2]).not.toContain(FIRM);
  expect(env.runs).toEqual([]);
});

test("the closing message is sent once across loops", async () => {
  await askedThenExpired();
  env.writeRun(defaultRun({ status: "done" }));
  await run(2);
  expect(find(`${PARK}#1`)).toMatchObject({ phase: "asked", ask_id: "d2", say: EXPIRED });
  env.status("d2", "completed", "turn-2", "sent");
  env.setReplies({ run: env.delivery("d9") });
  await run(3);
  expect(runIds()).toEqual([PARK, `${PARK}#1`]);
  expect(find(`${PARK}#1`)).toMatchObject({ phase: "closed", closed_by: "sent", say: EXPIRED, ask_id: "d2" });
});
