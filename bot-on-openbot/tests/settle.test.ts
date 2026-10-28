import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { find, open, record, type DeliveryRec } from "../src/deliveries.ts";
import { blockedOffer, offerFor } from "../src/offer.ts";
import { serve } from "../src/serve.ts";
import { SETTLE_MODE, sweepSettled, wellFormed } from "../src/settle.ts";
import { handleTap } from "../src/tap.ts";
import { captureErr, COLOURS, defaultRun, FIX, makeEnv, P1, P5, serveOpts, type Env } from "./helpers.ts";

const TOKEN = "FIXTURE-OPENBOT-TOKEN-do-not-leak";
const AGENT_ID = "agent-7a6bdc91-f17f-4c79-9dae-4a7d3b1a0eb6";
const T0 = new Date("2026-10-27T17:00:00Z");
const PARK = `r1/u1/park/${P1}`;
let env: Env;
let server: ReturnType<typeof Bun.serve>;
let prompts: unknown[];
let posts: { path: string; body: unknown }[];
let gets: string[];
const B_ID = "agent-b";

beforeEach(() => {
  env = makeEnv();
  // A question's prompt shows while its delivery runs (spike: status-running-while-prompt-pending.json).
  env.status("d1", "running", "turn-1");
  env.status("d2", "running", "turn-2");
  prompts = [];
  posts = [];
  gets = [];
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return new Response("", { status: 401 });
      gets.push(path);
      if (path === "/v1/agents") return Response.json([{ id: AGENT_ID, name: "Autopilot" }, { id: B_ID, name: "B" }]);
      if (path === `/v1/agents/${AGENT_ID}/pending` || path === `/v1/agents/${B_ID}/pending`) return Response.json({ prompts, approvals: [], browserTakeovers: [] });
      if (req.method === "POST" && path.endsWith("/answer")) {
        posts.push({ path, body: await req.json() });
        return Response.json({ ok: true });
      }
      return new Response("", { status: 404 });
    },
  });
  const auto = join(env.dir, "automation");
  mkdirSync(auto, { recursive: true });
  writeFileSync(join(auto, "url"), `http://127.0.0.1:${server.port}`);
  writeFileSync(join(auto, "token"), TOKEN);
});
afterEach(() => {
  server.stop(true);
  env.cleanup();
});

const MSG = "baton r1/u1 parked in build: second prompt";
const parkRec = (over: Partial<DeliveryRec> = {}): DeliveryRec => {
  const offer = offerFor({ kind: "unit-park", run: "r1", unit: "u1", at: P1 }, MSG, "r1")!;
  const r: DeliveryRec = { key: PARK, phase: "asked", run: "r1", unit: "u1", park_at: P1, title: offer.title, offer, ask_id: "d1", ...over };
  record(r);
  return r;
};
// The prompt OpenBot shows for a record: its title and text joined by a line break, its labels.
const promptOf = (r: DeliveryRec, requestId = "req-1", labels?: string[]) => ({
  requestId,
  questions: [{
    id: "reply",
    header: `${r.title}\n${r.offer!.text}`,
    question: `${r.title}\n${r.offer!.text}`,
    options: (labels ?? r.offer!.options.map((o) => o.label)).map((label) => ({ label, description: "" })),
  }],
  requiresOpenBot: false,
});
const clearPark = () => env.writeRun(defaultRun({ units: { u1: { id: "u1", stage: "build", parked: null, vars: {} } } }));

test("settling answers on the record's agent", async () => {
  const r = parkRec({ agent: "B" });
  prompts = [promptOf(r)];
  clearPark();
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(1);
  expect(env.calls().map((c) => c.argv)).toEqual([["status", "B", "d1", "--json"]]);
  expect(gets.filter((p) => p.endsWith("/pending"))).toEqual([`/v1/agents/${B_ID}/pending`]);
  expect(posts).toEqual([{ path: `/v1/agents/${B_ID}/prompts/req-1/answer`, body: { answers: { reply: ["settled"] } } }]);
});

test("SETTLE_MODE is answer (spike: an unoffered label is accepted)", () => {
  expect(SETTLE_MODE).toBe("answer");
});

test("a cleared park settles once, answering its prompt with settled", async () => {
  const r = parkRec();
  prompts = [promptOf(r)];
  clearPark();
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(1);
  expect(posts).toEqual([{ path: `/v1/agents/${AGENT_ID}/prompts/req-1/answer`, body: { answers: { reply: ["settled"] } } }]);
  expect(find(PARK)).toMatchObject({ phase: "closed", closed_by: "settled", closed_at: T0.toISOString() });
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(0);
  expect(posts.length).toBe(1);
});

test("a park that moved on (a newer park) settles", async () => {
  const r = parkRec({ park_at: "2026-10-27T09:00:00.000Z" });
  prompts = [promptOf(r)];
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(1);
  expect(posts.length).toBe(1);
});

test("a disarmed run settles its questions; so does a done run", async () => {
  for (const status of ["disarmed", "done"]) {
    env.writeRun(defaultRun({ status }));
    const r = parkRec();
    prompts = [promptOf(r)];
    posts = [];
    expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(1);
    expect(posts.length).toBe(1);
    record({ ...r, phase: "asked" }); // reopen for the next status
  }
});

test("an unreadable run settles nothing", async () => {
  const r = parkRec();
  prompts = [promptOf(r)];
  writeFileSync(join(env.dir, "baton", "runs", "r1", "run.json"), "{garbage");
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(0);
  expect(posts).toEqual([]);
  expect(open().map((x) => x.key)).toEqual([PARK]);
});

test("a still-parked unit stays open and calls nothing", async () => {
  const r = parkRec();
  prompts = [promptOf(r)];
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(0);
  expect(posts).toEqual([]);
  expect(env.calls()).toEqual([]);
  expect(find(PARK)!.phase).toBe("asked");
});

test("follow-up questions of a settled notice settle too", async () => {
  const r = parkRec();
  record({ ...r, phase: "closed", closed_by: "tap" });
  const f: DeliveryRec = { ...r, key: `${PARK}#1`, title: r.title, offer: { ...r.offer!, text: "Disarm run r1?" }, ask_id: "d2" };
  record(f);
  prompts = [promptOf(f, "req-2")];
  clearPark();
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(1);
  expect(find(`${PARK}#1`)).toMatchObject({ phase: "closed", closed_by: "settled" });
  expect(posts.map((p) => p.path)).toEqual([`/v1/agents/${AGENT_ID}/prompts/req-2/answer`]);
});

test("answers the matching prompt with settled, and only that one", async () => {
  const r = parkRec();
  const other = { ...promptOf(r, "req-other"), questions: [{ ...promptOf(r).questions[0], question: "someone else's question" }] };
  prompts = [other, promptOf(r, "req-mine")];
  clearPark();
  await sweepSettled(env.botFor, env.defaultAgent, T0);
  expect(posts.map((p) => p.path)).toEqual([`/v1/agents/${AGENT_ID}/prompts/req-mine/answer`]);
});

test("a prompt of its title with other labels is its own prompt, malformed: settle dismisses it", async () => {
  const r = parkRec();
  env.status("d1", "running", "turn-1");
  // same question; one label differs (the agent asked it its own way)
  prompts = [promptOf(r, "req-1", ["Unpark", "Unpark to stage…", "Show question", "Merge"])];
  clearPark();
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(1);
  expect(posts).toEqual([{ path: `/v1/agents/${AGENT_ID}/prompts/req-1/answer`, body: { answers: { reply: ["settled"] } } }]);
  expect(find(PARK)).toMatchObject({ phase: "closed", closed_by: "settled" });
  expect(find(PARK)!.unanswered).toBeUndefined();
});

test("the exact prompt wins over a malformed one of the same title", async () => {
  const r = parkRec();
  prompts = [promptOf(r, "req-bad", ["Unpark"]), promptOf(r, "req-exact")];
  clearPark();
  await sweepSettled(env.botFor, env.defaultAgent, T0);
  expect(posts.map((p) => p.path)).toEqual([`/v1/agents/${AGENT_ID}/prompts/req-exact/answer`]);
});

// The prompt recorded in the dry run (issue #939): options null, the labels a list in the question.
const NO_OPTIONS = () => JSON.parse(readFileSync(join(FIX, "pending-prompt-no-options.json"), "utf8")).prompts[0];
const blockedRec = (): DeliveryRec => {
  const offer = blockedOffer("m", "r1", "u5", COLOURS as never, null);
  const r: DeliveryRec = { key: `r1/u5/park/${P5}`, phase: "asked", run: "r1", unit: "u5", park_at: P5, title: offer.title, offer, ask_id: "d1" };
  record(r);
  return r;
};
const clearBlocked = () => env.writeRun(defaultRun({ units: { u5: { id: "u5", stage: "build", parked: null, vars: {} } } }));

test("settle dismisses the malformed prompt (options null) of a settled park, found by its title", async () => {
  const r = blockedRec();
  env.status("d1", "running", "turn-1");
  prompts = [NO_OPTIONS()];
  clearBlocked();
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(1);
  expect(posts).toEqual([{ path: `/v1/agents/${AGENT_ID}/prompts/5b0e9c4a-8d31-4f6e-b2a7-c94e1f03d6b8/answer`, body: { answers: { reply: ["settled"] } } }]);
  expect(find(r.key)).toMatchObject({ phase: "closed", closed_by: "settled" });
  expect(find(r.key)!.unanswered).toBeUndefined();
});

test("a prompt is found by its header alone, or by its question's first line alone", async () => {
  for (const [header, question] of [["r1/u5 waits on a question", "Pick one:\n- red"], ["Pick one", "r1/u5 waits on a question\n- red"]]) {
    posts = [];
    const r = blockedRec();
    env.status("d1", "running", "turn-1");
    prompts = [{ ...NO_OPTIONS(), questions: [{ id: "reply", header, question, options: null }] }];
    clearBlocked();
    expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(1);
    expect(posts.length).toBe(1);
    expect(find(r.key)).toMatchObject({ phase: "closed", closed_by: "settled" });
  }
});

test("a prompt with another title is never answered, whatever its labels", async () => {
  const r = blockedRec();
  env.status("d1", "running", "turn-1");
  const other = (header: string, question: string, options: unknown) =>
    ({ ...NO_OPTIONS(), requestId: `req-${header}`, questions: [{ id: "reply", header, question, options }] });
  const labels = r.offer!.options.map((o) => ({ label: o.label, description: "" }));
  prompts = [
    other("r1/u5 waits on a question?", "r1/u5 waits on a question?\n- red", null), // a title that only nearly matches
    other("Something else", "Something else\nr1/u5 waits on a question", labels), // our title on line 2, our labels
    other("", "", null),
  ];
  clearBlocked();
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(1);
  expect(posts).toEqual([]);
  expect(find(r.key)).toMatchObject({ phase: "closed", closed_by: "settled", unanswered: true });
});

test("a question not yet shown is closed now and answered once it shows", async () => {
  const r = parkRec();
  env.status("d1", "running", "turn-1");
  clearPark();
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(1);
  expect(posts).toEqual([]);
  expect(find(PARK)).toMatchObject({ phase: "closed", closed_by: "settled", unanswered: true });
  // a tap meanwhile runs nothing
  await captureErr(() => handleTap(r, "Unpark", { bot: env.bot, runner: env.runner, now: () => T0 }));
  expect(env.runs).toEqual([]);
  prompts = [promptOf(r)];
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(0);
  expect(posts.length).toBe(1);
  expect(find(PARK)!.unanswered).toBeUndefined();
  await sweepSettled(env.botFor, env.defaultAgent, T0);
  expect(posts.length).toBe(1);
});

test("a question whose delivery ended is not waited for", async () => {
  parkRec();
  env.status("d1", "completed", "turn-1", "x");
  clearPark();
  await sweepSettled(env.botFor, env.defaultAgent, T0);
  expect(find(PARK)!.unanswered).toBeUndefined();
});

test("a settled question whose delivery ended never answers a newer prompt of the same title", async () => {
  const r = parkRec();
  env.status("d1", "running", "turn-1");
  clearPark();
  await sweepSettled(env.botFor, env.defaultAgent, T0);
  expect(find(PARK)).toMatchObject({ phase: "closed", unanswered: true });
  // Its turn ends without a prompt; a later park of the same unit asks under the same title.
  env.status("d1", "completed", "turn-1", "x");
  prompts = [promptOf(r, "req-new")];
  await sweepSettled(env.botFor, env.defaultAgent, T0);
  expect(posts).toEqual([]);
  expect(find(PARK)!.unanswered).toBeUndefined();
  // and an asked record whose own delivery ended settles without touching a same-title prompt
  const r2 = parkRec({ key: `${PARK}#2`, ask_id: "d2" });
  env.status("d2", "completed", "turn-2", "x");
  prompts = [promptOf(r2, "req-new")];
  await sweepSettled(env.botFor, env.defaultAgent, T0);
  expect(posts).toEqual([]);
});

test("a drafting record of a settled park closes with no question asked", async () => {
  record({ key: `r1/u5/park/${P5}`, phase: "drafting", run: "r1", unit: "u5", park_at: P5, title: "t", picker: COLOURS as never, draft_id: "dr", message: "m" });
  env.writeRun(defaultRun({ units: { u5: { id: "u5", stage: "build", parked: null, vars: {} } } }));
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(1);
  expect(find(`r1/u5/park/${P5}`)).toMatchObject({ phase: "closed", closed_by: "settled" });
  expect(find(`r1/u5/park/${P5}`)!.unanswered).toBeUndefined();
  expect(posts).toEqual([]);
  expect(env.calls()).toEqual([]);
});

test("a message is never settled", async () => {
  record({ key: "r1/done", phase: "asked", run: "r1", title: "t", say: "done", ask_id: "d9" });
  env.writeRun(defaultRun({ status: "done" }));
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(0);
  expect(find("r1/done")!.phase).toBe("asked");
});

test("OpenBot down while settling keeps the record open for the next loop", async () => {
  parkRec();
  clearPark();
  server.stop(true);
  const { value } = await captureErr(() => sweepSettled(env.botFor, env.defaultAgent, T0));
  expect(value).toBe(0);
  expect(find(PARK)!.phase).toBe("asked");
});

test("a blocked park's question settles when its park clears", async () => {
  const offer = blockedOffer("m", "r1", "u5", COLOURS as never, null);
  const r: DeliveryRec = { key: `r1/u5/park/${P5}`, phase: "asked", run: "r1", unit: "u5", park_at: P5, title: offer.title, offer, ask_id: "d1" };
  record(r);
  prompts = [promptOf(r)];
  env.writeRun(defaultRun({ units: { u5: { id: "u5", stage: "build", parked: null, vars: {} } } }));
  expect(await sweepSettled(env.botFor, env.defaultAgent, T0)).toBe(1);
  expect(posts.length).toBe(1);
});

test("serve settles each loop", async () => {
  const r = parkRec();
  env.status("d1", "running", "turn-1");
  prompts = [promptOf(r)];
  clearPark();
  await captureErr(() => serve(serveOpts(env, T0)));
  expect(posts.length).toBe(1);
  expect(find(PARK)!.closed_by).toBe("settled");
});

test("token sweep: after serve settles, taps and fails, no state file and no stderr line holds the token", async () => {
  const r = parkRec();
  env.status("d1", "running", "turn-1");
  prompts = [promptOf(r)];
  clearPark();
  const { readdirSync, readFileSync } = await import("node:fs");
  const { err } = await captureErr(async () => {
    await serve(serveOpts(env, T0));
    server.stop(true); // OpenBot gone: the next sweeps fail and log
    record({ ...r, phase: "asked" });
    await serve(serveOpts(env, T0));
  });
  expect(err.join("")).toContain("settle");
  expect(err.join("")).not.toContain(TOKEN);
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const files = walk(join(env.dir, "state"));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) expect(readFileSync(f, "utf8")).not.toContain(TOKEN);
  // control: the token did reach the stub, so the sweep is not vacuous
  expect(posts.length).toBe(1);
});

// Issue #941: labels accepted but not shown are no part of the prompt's shape.
test("wellFormed compares the shown labels only, in order", () => {
  const six = { ...COLOURS, options: ["a1", "b2", "c3", "d4", "e5", "f6"].map((label, i) => ({ n: i + 1, label })) };
  const offer = blockedOffer("m", "r1", "u5", six as never, null);
  const r: DeliveryRec = { key: "k", phase: "asked", run: "r1", title: offer.title, offer };
  const p = (options: string[]) => ({ requestId: "q", questionId: "reply", header: r.title, question: r.title, options });
  expect(wellFormed(r, p(["Show question", "Unpark", "Disarm"]))).toBe(true);
  expect(wellFormed(r, p(offer.options.map((o) => o.label)))).toBe(false);
  expect(wellFormed(r, p(["Unpark", "Show question", "Disarm"]))).toBe(false);
});

test("settle finds the exact prompt of an offer with labels not shown", async () => {
  const six = { ...COLOURS, options: ["a1", "b2", "c3", "d4", "e5", "f6"].map((label, i) => ({ n: i + 1, label })) };
  const offer = blockedOffer("m", "r1", "u5", six as never, null);
  const r: DeliveryRec = { key: `r1/u5/park/${P5}`, phase: "asked", run: "r1", unit: "u5", park_at: P5, title: offer.title, offer, ask_id: "d1" };
  record(r);
  env.status("d1", "running", "turn-1");
  prompts = [promptOf(r, "req-bad", ["Show question"]), promptOf(r, "req-exact", ["Show question", "Unpark", "Disarm"])];
  env.writeRun(defaultRun({ units: { u5: { id: "u5", stage: "build", parked: null, vars: {} } } }));
  await sweepSettled(env.botFor, env.defaultAgent, T0);
  expect(posts.map((x) => x.path)).toEqual([`/v1/agents/${AGENT_ID}/prompts/req-exact/answer`]);
});
