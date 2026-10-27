import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { find, open, record, type DeliveryRec } from "../src/deliveries.ts";
import { blockedOffer, offerFor } from "../src/offer.ts";
import { serve } from "../src/serve.ts";
import { SETTLE_MODE, sweepSettled } from "../src/settle.ts";
import { handleTap } from "../src/tap.ts";
import { captureErr, COLOURS, defaultRun, makeEnv, P1, P5, type Env } from "./helpers.ts";

const TOKEN = "FIXTURE-OPENBOT-TOKEN-do-not-leak";
const AGENT_ID = "agent-7a6bdc91-f17f-4c79-9dae-4a7d3b1a0eb6";
const T0 = new Date("2026-10-27T17:00:00Z");
const PARK = `r1/u1/park/${P1}`;
let env: Env;
let server: ReturnType<typeof Bun.serve>;
let prompts: unknown[];
let posts: { path: string; body: unknown }[];

beforeEach(() => {
  env = makeEnv();
  prompts = [];
  posts = [];
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return new Response("", { status: 401 });
      if (path === "/v1/agents") return Response.json([{ id: AGENT_ID, name: "Autopilot" }]);
      if (path === `/v1/agents/${AGENT_ID}/pending`) return Response.json({ prompts, approvals: [], browserTakeovers: [] });
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

test("SETTLE_MODE is answer (spike: an unoffered label is accepted)", () => {
  expect(SETTLE_MODE).toBe("answer");
});

test("a cleared park settles once, answering its prompt with settled", async () => {
  const r = parkRec();
  prompts = [promptOf(r)];
  clearPark();
  expect(await sweepSettled(env.bot, T0)).toBe(1);
  expect(posts).toEqual([{ path: `/v1/agents/${AGENT_ID}/prompts/req-1/answer`, body: { answers: { reply: ["settled"] } } }]);
  expect(find(PARK)).toMatchObject({ phase: "closed", closed_by: "settled", closed_at: T0.toISOString() });
  expect(await sweepSettled(env.bot, T0)).toBe(0);
  expect(posts.length).toBe(1);
});

test("a park that moved on (a newer park) settles", async () => {
  const r = parkRec({ park_at: "2026-10-27T09:00:00.000Z" });
  prompts = [promptOf(r)];
  expect(await sweepSettled(env.bot, T0)).toBe(1);
  expect(posts.length).toBe(1);
});

test("a disarmed run settles its questions; so does a done run", async () => {
  for (const status of ["disarmed", "done"]) {
    env.writeRun(defaultRun({ status }));
    const r = parkRec();
    prompts = [promptOf(r)];
    posts = [];
    expect(await sweepSettled(env.bot, T0)).toBe(1);
    expect(posts.length).toBe(1);
    record({ ...r, phase: "asked" }); // reopen for the next status
  }
});

test("an unreadable run settles nothing", async () => {
  const r = parkRec();
  prompts = [promptOf(r)];
  writeFileSync(join(env.dir, "baton", "runs", "r1", "run.json"), "{garbage");
  expect(await sweepSettled(env.bot, T0)).toBe(0);
  expect(posts).toEqual([]);
  expect(open().map((x) => x.key)).toEqual([PARK]);
});

test("a still-parked unit stays open and calls nothing", async () => {
  const r = parkRec();
  prompts = [promptOf(r)];
  expect(await sweepSettled(env.bot, T0)).toBe(0);
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
  expect(await sweepSettled(env.bot, T0)).toBe(1);
  expect(find(`${PARK}#1`)).toMatchObject({ phase: "closed", closed_by: "settled" });
  expect(posts.map((p) => p.path)).toEqual([`/v1/agents/${AGENT_ID}/prompts/req-2/answer`]);
});

test("answers the matching prompt with settled, and only that one", async () => {
  const r = parkRec();
  const other = { ...promptOf(r, "req-other"), questions: [{ ...promptOf(r).questions[0], question: "someone else's question" }] };
  prompts = [other, promptOf(r, "req-mine")];
  clearPark();
  await sweepSettled(env.bot, T0);
  expect(posts.map((p) => p.path)).toEqual([`/v1/agents/${AGENT_ID}/prompts/req-mine/answer`]);
});

test("leaves a prompt with other labels alone", async () => {
  const r = parkRec();
  env.status("d1", "running", "turn-1");
  // same question; one label differs, and another prompt has fewer labels
  prompts = [promptOf(r, "req-1", ["Unpark", "Unpark to stage…", "Show question", "Merge"]), promptOf(r, "req-2", ["Unpark", "Disarm"])];
  clearPark();
  expect(await sweepSettled(env.bot, T0)).toBe(1);
  expect(posts).toEqual([]);
  expect(find(PARK)).toMatchObject({ phase: "closed", closed_by: "settled" });
});

test("a question not yet shown is closed now and answered once it shows", async () => {
  const r = parkRec();
  env.status("d1", "running", "turn-1");
  clearPark();
  expect(await sweepSettled(env.bot, T0)).toBe(1);
  expect(posts).toEqual([]);
  expect(find(PARK)).toMatchObject({ phase: "closed", closed_by: "settled", unanswered: true });
  // a tap meanwhile runs nothing
  await captureErr(() => handleTap(r, "Unpark", { bot: env.bot, runner: env.runner, now: () => T0 }));
  expect(env.runs).toEqual([]);
  prompts = [promptOf(r)];
  expect(await sweepSettled(env.bot, T0)).toBe(0);
  expect(posts.length).toBe(1);
  expect(find(PARK)!.unanswered).toBeUndefined();
  await sweepSettled(env.bot, T0);
  expect(posts.length).toBe(1);
});

test("a question whose delivery ended is not waited for", async () => {
  parkRec();
  env.status("d1", "completed", "turn-1", "x");
  clearPark();
  await sweepSettled(env.bot, T0);
  expect(find(PARK)!.unanswered).toBeUndefined();
});

test("a drafting record of a settled park closes with no question asked", async () => {
  record({ key: `r1/u5/park/${P5}`, phase: "drafting", run: "r1", unit: "u5", park_at: P5, title: "t", picker: COLOURS as never, draft_id: "dr", message: "m" });
  env.writeRun(defaultRun({ units: { u5: { id: "u5", stage: "build", parked: null, vars: {} } } }));
  expect(await sweepSettled(env.bot, T0)).toBe(1);
  expect(find(`r1/u5/park/${P5}`)).toMatchObject({ phase: "closed", closed_by: "settled" });
  expect(find(`r1/u5/park/${P5}`)!.unanswered).toBeUndefined();
  expect(posts).toEqual([]);
  expect(env.calls()).toEqual([]);
});

test("a message is never settled", async () => {
  record({ key: "r1/done", phase: "asked", run: "r1", title: "t", say: "done", ask_id: "d9" });
  env.writeRun(defaultRun({ status: "done" }));
  expect(await sweepSettled(env.bot, T0)).toBe(0);
  expect(find("r1/done")!.phase).toBe("asked");
});

test("OpenBot down while settling keeps the record open for the next loop", async () => {
  parkRec();
  clearPark();
  server.stop(true);
  const { value } = await captureErr(() => sweepSettled(env.bot, T0));
  expect(value).toBe(0);
  expect(find(PARK)!.phase).toBe("asked");
});

test("a blocked park's question settles when its park clears", async () => {
  const offer = blockedOffer("m", "r1", "u5", COLOURS as never, null);
  const r: DeliveryRec = { key: `r1/u5/park/${P5}`, phase: "asked", run: "r1", unit: "u5", park_at: P5, title: offer.title, offer, ask_id: "d1" };
  record(r);
  prompts = [promptOf(r)];
  env.writeRun(defaultRun({ units: { u5: { id: "u5", stage: "build", parked: null, vars: {} } } }));
  expect(await sweepSettled(env.bot, T0)).toBe(1);
  expect(posts.length).toBe(1);
});

test("serve settles each loop", async () => {
  const r = parkRec();
  env.status("d1", "running", "turn-1");
  prompts = [promptOf(r)];
  clearPark();
  await captureErr(() => serve({ bot: env.bot, runner: env.runner, now: () => T0, stopAfter: 1, pollMs: 0 }));
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
    await serve({ bot: env.bot, runner: env.runner, now: () => T0, stopAfter: 1, pollMs: 0 });
    server.stop(true); // OpenBot gone: the next sweeps fail and log
    record({ ...r, phase: "asked" });
    await serve({ bot: env.bot, runner: env.runner, now: () => T0, stopAfter: 1, pollMs: 0 });
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
