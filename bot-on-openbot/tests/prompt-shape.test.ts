// Issue #939: the agent can ask a question without its options. After an ask, serve finds its prompt
// on /pending by title and checks the labels; a malformed one is dismissed and asked again once, then
// the question is closed with a plain message.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { find, type DeliveryRec } from "../src/deliveries.ts";
import { serve } from "../src/serve.ts";
import { spoolNotice } from "../src/spool.ts";
import { messageTask } from "../src/task.ts";
import { captureErr, FIX, makeEnv, P1, P5, screenJson, type Env } from "./helpers.ts";

const TOKEN = "FIXTURE-OPENBOT-TOKEN-do-not-leak";
const AGENT_ID = "agent-7a6bdc91-f17f-4c79-9dae-4a7d3b1a0eb6";
const T0 = new Date("2026-10-27T17:00:00Z");
const PARK = `r1/u1/park/${P1}`;
const BLOCKED = `r1/u5/park/${P5}`;
const DRAFT = JSON.stringify({ summary: "It asks for a colour.", recommended: 2, why: "green is the house colour" });
const NO_OPTIONS_ID = "5b0e9c4a-8d31-4f6e-b2a7-c94e1f03d6b8";
const FIRM = "never as text inside the question";
const GIVE_UP = "r1/u5 waits on a question: the question could not be asked with options; act in the Orca terminal or with baton.";

let env: Env;
let server: ReturnType<typeof Bun.serve>;
let prompts: any[];
let posts: { path: string; body: unknown }[];
let answerStatus: number;

beforeEach(() => {
  env = makeEnv();
  prompts = [];
  posts = [];
  answerStatus = 200;
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return new Response("", { status: 401 });
      if (path === "/v1/agents") return Response.json([{ id: AGENT_ID, name: "Autopilot" }]);
      if (path === `/v1/agents/${AGENT_ID}/pending`) return Response.json({ prompts, approvals: [], browserTakeovers: [] });
      if (req.method === "POST" && path.endsWith("/answer")) {
        posts.push({ path, body: await req.json() });
        if (answerStatus !== 200) return Response.json({ error: "This prompt is no longer active." }, { status: answerStatus });
        prompts = prompts.filter((p) => !path.includes(`/prompts/${p.requestId}/`)); // an answered prompt leaves /pending
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

const run = (stopAfter = 1) => captureErr(() => serve({ bot: env.bot, runner: env.runner, now: () => T0, stopAfter, pollMs: 0 }));
const answerPath = (id: string) => `/v1/agents/${AGENT_ID}/prompts/${id}/answer`;
const SETTLED = { answers: { reply: ["settled"] } };

// The prompt recorded in the dry run: options null, the labels a list in the question, no summary.
const noOptions = (requestId = NO_OPTIONS_ID) => ({ ...JSON.parse(readFileSync(join(FIX, "pending-prompt-no-options.json"), "utf8")).prompts[0], requestId });
// The prompt a well-asked question shows (pending-prompt.json's shape).
const wellFormed = (r: DeliveryRec, requestId = "req-ok", labels?: string[]) => ({
  requestId,
  questions: [{
    id: "reply",
    header: `${r.title}\n${r.offer!.text}`,
    question: `${r.title}\n${r.offer!.text}`,
    options: (labels ?? r.offer!.options.map((o) => o.label)).map((label) => ({ label, description: "" })),
  }],
  requiresOpenBot: false,
});

// A blocked park drafted and asked (ids draft, ask), then a re-ask (reask) and a message (msg).
function blockedAsked(): void {
  env.reply.fn = (argv) => (argv[1] === "screen" ? { rc: 0, stdout: screenJson(), stderr: "" } : { rc: 0, stdout: "", stderr: "" });
  env.setReplies({ run: [env.delivery("draft"), env.delivery("ask"), env.delivery("reask"), env.delivery("msg")] });
  env.status("draft", "completed", "turn-d", DRAFT);
  env.status("ask", "running", "turn-a");
  env.status("reask", "running", "turn-b");
  env.status("msg", "running", "turn-m");
  spoolNotice(BLOCKED, "baton r1/u5 blocked on a question");
}

test("a malformed prompt (options null) is dismissed with settled and asked again once, with firmer wording", async () => {
  blockedAsked();
  prompts = [noOptions()];
  await run();
  expect(posts).toEqual([{ path: answerPath(NO_OPTIONS_ID), body: SETTLED }]);
  const stdins = env.runStdins();
  expect(stdins.length).toBe(3); // draft, ask, re-ask
  expect(stdins[1]).not.toContain(FIRM);
  expect(stdins[2]).toContain(FIRM);
  expect(stdins[2]).toContain("Use your question tool");
  expect(stdins[2]).toContain("- green (recommended)\n- red\n- blue\n- amber\n- Show question\n- Unpark\n- Disarm\n");
  expect(env.calls().filter((c) => c.argv[0] === "run").map((c) => c.argv[4])).toEqual([`${BLOCKED}#draft`, BLOCKED, `${BLOCKED}#reask`]);
  expect(find(BLOCKED)).toMatchObject({ phase: "asked", ask_id: "reask", reasks: 1 });
  expect(env.runs).toEqual([["baton", "screen", "r1", "u5"]]); // nothing ran
  // the re-ask has not shown yet: the next loop waits and answers nothing
  await run();
  expect(posts.length).toBe(1);
  expect(env.runStdins().length).toBe(3);
  expect(find(BLOCKED)).toMatchObject({ phase: "asked", ask_id: "reask", reasks: 1 });
});

test("a second malformed prompt is dismissed and the question closed with a plain message", async () => {
  blockedAsked();
  prompts = [noOptions()];
  await run();
  prompts = [noOptions("req-second")];
  await run(2);
  expect(posts).toEqual([
    { path: answerPath(NO_OPTIONS_ID), body: SETTLED },
    { path: answerPath("req-second"), body: SETTLED },
  ]);
  expect(find(BLOCKED)).toMatchObject({ phase: "closed", closed_by: "gone", reasks: 1 });
  const stdins = env.runStdins();
  expect(stdins.length).toBe(4); // no third ask
  expect(stdins[3]).toBe(messageTask(GIVE_UP));
  expect(find(`${BLOCKED}#1`)).toMatchObject({ say: GIVE_UP, ask_id: "msg" });
  expect(env.runs).toEqual([["baton", "screen", "r1", "u5"]]);
});

test("a re-ask OpenBot refuses is kept unsent, and goes on a later loop", async () => {
  blockedAsked();
  env.setReplies({ run: [env.delivery("draft"), env.delivery("ask"), { stdout: '{"ok":false,"exitCode":1,"error":"limit"}', rc: 1 }, env.delivery("reask")] });
  prompts = [noOptions()];
  await run();
  expect(posts.length).toBe(1);
  const rec = find(BLOCKED)!;
  expect(rec).toMatchObject({ phase: "asked", reasks: 1 });
  expect(rec.ask_id).toBeUndefined(); // the old turn, answered settled, is never read again
  await run();
  expect(find(BLOCKED)).toMatchObject({ phase: "asked", reasks: 1, ask_id: "reask" });
  expect(env.runStdins().at(-1)).toContain(FIRM);
  expect(env.runs).toEqual([["baton", "screen", "r1", "u5"]]);
});

test("a well-formed prompt is left alone", async () => {
  env.setReplies({ run: [env.delivery("d1"), env.delivery("d2")] });
  env.status("d1", "running", "turn-1");
  spoolNotice(PARK, "baton r1/u1 parked in build: second prompt");
  await run();
  prompts = [wellFormed(find(PARK)!)];
  await run(2);
  expect(posts).toEqual([]);
  expect(env.runStdins().length).toBe(1);
  expect(find(PARK)).toMatchObject({ phase: "asked", ask_id: "d1" });
  expect(find(PARK)!.reasks).toBeUndefined();
});

test("our title with the labels out of order, or one short, is malformed", async () => {
  for (const labels of [["Unpark to stage…", "Unpark", "Show question", "Disarm"], ["Unpark", "Unpark to stage…", "Show question"]]) {
    env.cleanup();
    env = makeEnv();
    const auto = join(env.dir, "automation");
    mkdirSync(auto, { recursive: true });
    writeFileSync(join(auto, "url"), `http://127.0.0.1:${server.port}`);
    writeFileSync(join(auto, "token"), TOKEN);
    posts = [];
    env.setReplies({ run: [env.delivery("d1"), env.delivery("d2")] });
    env.status("d1", "running", "turn-1");
    spoolNotice(PARK, "m");
    await run();
    prompts = [wellFormed(find(PARK)!, "req-bad", labels)];
    await run();
    expect(posts).toEqual([{ path: answerPath("req-bad"), body: SETTLED }]);
    expect(find(PARK)).toMatchObject({ reasks: 1, ask_id: "d2" });
  }
});

test("no prompt yet means wait", async () => {
  env.setReplies({ run: [env.delivery("d1"), env.delivery("d2")] });
  env.status("d1", "running", "turn-1");
  spoolNotice(PARK, "m");
  await run(3);
  expect(posts).toEqual([]);
  expect(env.runStdins().length).toBe(1);
  expect(find(PARK)).toMatchObject({ phase: "asked", ask_id: "d1" });
});

test("a malformed prompt with another title is never answered", async () => {
  env.setReplies({ run: [env.delivery("d1"), env.delivery("d2")] });
  env.status("d1", "running", "turn-1");
  spoolNotice(PARK, "m");
  await run();
  const theirs = (header: string, question: string) => ({ ...noOptions(`req-${header}`), questions: [{ id: "reply", header, question, options: null }] });
  prompts = [
    theirs("r1/u1 parked.", "r1/u1 parked.\n- Unpark"),        // nearly our title
    theirs("Lunch?", "Lunch?\nr1/u1 parked"),                  // our title, but not on the first line
    noOptions("req-u5"),                                        // another unit's title
  ];
  await run(2);
  expect(posts).toEqual([]);
  expect(env.runStdins().length).toBe(1);
  expect(find(PARK)!.reasks).toBeUndefined();
});

test("a prompt answered first by someone else (409) is not asked again", async () => {
  env.setReplies({ run: [env.delivery("d1"), env.delivery("d2")] });
  env.status("d1", "running", "turn-1");
  spoolNotice(PARK, "m");
  await run();
  prompts = [wellFormed(find(PARK)!, "req-bad", ["Unpark"])];
  answerStatus = 409;
  await run();
  expect(posts.length).toBe(1);
  expect(env.runStdins().length).toBe(1);
  expect(find(PARK)).toMatchObject({ phase: "asked", ask_id: "d1" });
  expect(find(PARK)!.reasks).toBeUndefined();
});

test("a resolved settled that was never offered runs nothing, even where typed text would go to the worker", async () => {
  // a crash between dismissing a malformed prompt and recording the re-ask leaves the old turn answered `settled`
  blockedAsked();
  env.status("ask", "running", "turn-a");
  await run(); // drafted and asked; no prompt yet
  expect(find(BLOCKED)).toMatchObject({ phase: "asked", ask_id: "ask" });
  expect(find(BLOCKED)!.offer!.allowOther).toBe(true);
  env.resolve("turn-a", "settled");
  const r = await run();
  expect(env.runs).toEqual([["baton", "screen", "r1", "u5"]]); // no `baton answer --screen-text settled`
  expect(r.err.join("")).toContain(`${BLOCKED}: the prompt was answered settled`);
  // read as our own dismissal: asked again once
  expect(find(BLOCKED)).toMatchObject({ phase: "asked", ask_id: "reask", reasks: 1 });
  // and on the re-ask, the same answer gives up with the plain message
  env.resolve("turn-b", "settled");
  await run(2);
  expect(env.runs).toEqual([["baton", "screen", "r1", "u5"]]);
  expect(find(BLOCKED)).toMatchObject({ phase: "closed", closed_by: "gone" });
  expect(env.runStdins().at(-1)).toBe(messageTask(GIVE_UP));
  expect(posts).toEqual([]);
});
