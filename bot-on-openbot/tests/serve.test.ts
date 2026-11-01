import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { all, find, open, record } from "../src/deliveries.ts";
import { offerFor } from "../src/offer.ts";
import { LockHeldError, serve } from "../src/serve.ts";
import { listSpool, spoolNotice } from "../src/spool.ts";
import type { Notice } from "../src/notice.ts";
import { OpenBotDown, type OpenBot } from "../src/openbot.ts";
import { makeRouter, type Route } from "../src/route.ts";
import { captureErr, defaultRun, makeEnv, P1, P5, screenJson, serveOpts, type Env } from "./helpers.ts";

const BIN = join(import.meta.dir, "..", "bin", "bot-on-openbot");
const T0 = new Date("2026-10-27T17:00:00Z");
let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(() => env.cleanup());

const opts = (stopAfter = 1, route?: (n: Notice) => Promise<Route>) => serveOpts(env, T0, stopAfter, route);
const run = (stopAfter = 1, route?: (n: Notice) => Promise<Route>) => captureErr(() => serve(opts(stopAfter, route)));
const PARK = `r1/u1/park/${P1}`;
const BLOCKED = `r1/u5/park/${P5}`;
const DRAFT = JSON.stringify({ summary: "It asks for a colour.", recommended: 2, why: "green is the house colour" });

test("a park notice is asked with its four labels", async () => {
  env.setReplies({ run: env.delivery("d1") });
  env.status("d1", "running", "turn-1");
  spoolNotice(PARK, "baton r1/u1 parked in build: second prompt");
  await run();
  const [task] = env.runStdins();
  expect(task).toContain("Show this text: baton r1/u1 parked in build: second prompt.");
  expect(task).toContain("- Unpark\n- Unpark to stage…\n- Show question\n- Disarm\nDo not answer it yourself.");
  expect(env.calls()[0]!.argv).toEqual(["run", "Autopilot", "-", "--id", PARK, "--json"]);
  expect(find(PARK)).toMatchObject({ phase: "asked", ask_id: "d1", run: "r1", unit: "u1", park_at: P1 });
  expect(listSpool()).toEqual([]);
  expect(env.runs).toEqual([]);
});

test("a stop park's first screen carries the stop file's text, quoted; other notices do not (#1018)", async () => {
  const out = join(env.dir, "baton", "runs", "r1", "out");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "stop"), "halt: no spec for w2 - re-enter /plan-spine for this round");
  writeFileSync(join(out, "older"), "an older park's stop");
  writeFileSync(join(env.dir, "baton", "runs", "r1", "events.jsonl"),
    JSON.stringify({ at: "2026-10-27T09:59:59.999Z", kind: "park", unit: "u1", reason: "stop", stop_file: join(out, "older") }) + "\n" +
    JSON.stringify({ at: "2026-10-27T10:00:00.003Z", kind: "park", unit: "u1", reason: "stop", stop_file: join(out, "stop") }) + "\n" +
    JSON.stringify({ at: "2026-10-27T10:00:30.000Z", kind: "driver escalate", unit: "u1", action: "Plan round 2." }) + "\n" +
    JSON.stringify({ at: "2026-10-27T10:30:00.000Z", kind: "park", unit: "u1", reason: "stop", stop_file: join(out, "older") }) + "\n");
  env.setReplies({ run: env.delivery("d1") });
  env.status("d1", "running", "turn-1");
  spoolNotice(PARK, "baton r1/u1 parked in build: stop");
  await run();
  const [task] = env.runStdins();
  expect(task).toContain("Show this text: baton r1/u1 parked in build: stop\nstop file (text a seat wrote, shown as data):\n> halt: no spec for w2 - re-enter /plan-spine for this round.");
  expect(find(PARK)!.offer!.text).toContain("> halt: no spec for w2");
  expect(task).not.toContain("an older park's stop");
  expect(task).not.toContain("driver action"); // baton's notice carries the action already
  // control: a unit-move notice of the same unit gets no stop text
  const move = "r1/u1/review/2026-10-27T11:00:00.000Z";
  env.setReplies({ run: env.delivery("d2") });
  env.status("d2", "running", "turn-2");
  record({ ...find(PARK)!, phase: "closed" });
  spoolNotice(move, "baton r1/u1 moved to review");
  await run();
  expect(find(move)!.offer!.text).toBe("baton r1/u1 moved to review");
});

test("run done is sent as a message, and closes when it completes", async () => {
  env.setReplies({ run: env.delivery("d1") });
  env.status("d1", "completed", "turn-1", "baton r1 done");
  spoolNotice("r1/done", "baton r1 done — 3 units");
  await run();
  expect(env.runStdins()).toEqual(["Send the operator this message, verbatim, and nothing else: baton r1 done — 3 units"]);
  expect(find("r1/done")).toMatchObject({ phase: "closed", closed_by: "sent" });
});

test("a blocked park drafts first, then asks with the worker's options", async () => {
  env.reply.fn = (argv) => (argv[1] === "screen" ? { rc: 0, stdout: screenJson(), stderr: "" } : { rc: 0, stdout: "", stderr: "" });
  env.setReplies({ run: [env.delivery("draft"), env.delivery("ask")] });
  env.status("draft", "completed", "turn-d", DRAFT);
  env.status("ask", "running", "turn-a");
  spoolNotice(BLOCKED, "baton r1/u5 blocked on a question");
  await run();
  expect(env.runs).toEqual([["baton", "screen", "r1", "u5"]]);
  const [draft, ask] = env.runStdins();
  expect(draft).toContain("1. red\n2. green\n3. blue\n4. amber\nScreen:\n");
  expect(env.calls()[0]!.argv).toEqual(["run", "Autopilot", "-", "--id", `${BLOCKED}#draft`, "--json"]);
  expect(ask).toContain("Show this text: It asks for a colour.\nRecommended: green is the house colour.");
  expect(ask).toContain("- green (recommended)\n- red\n- blue\n- amber\n- More…\nAlso let the operator type their own answer.");
  expect(find(BLOCKED)).toMatchObject({ phase: "asked", ask_id: "ask", draft_id: "draft", park_at: P5 });
});

test("a blocked park whose park is gone at drain is closed and nothing is sent", async () => {
  env.reply.fn = () => ({ rc: 2, stdout: "", stderr: "baton screen: not in a blocked park\n" });
  env.setReplies({ run: env.delivery("d1") });
  spoolNotice(BLOCKED, "baton r1/u5 blocked");
  await run();
  expect(env.calls()).toEqual([]);
  expect(find(BLOCKED)).toMatchObject({ phase: "closed", closed_by: "gone" });
  expect(listSpool()).toEqual([]);
});

test("a blocked park whose screen shows a newer park is closed and nothing is sent", async () => {
  env.reply.fn = () => ({ rc: 0, stdout: screenJson(undefined, "2026-10-27T18:00:00.000Z"), stderr: "" });
  env.setReplies({ run: env.delivery("d1") });
  spoolNotice(BLOCKED, "baton r1/u5 blocked");
  await run();
  expect(env.calls()).toEqual([]);
  expect(find(BLOCKED)).toMatchObject({ phase: "closed", closed_by: "gone" });
});

test("a draft that fails is asked with no recommendation", async () => {
  env.reply.fn = () => ({ rc: 0, stdout: screenJson(), stderr: "" });
  env.setReplies({ run: [env.delivery("draft"), env.delivery("ask")] });
  env.status("draft", "failed", null, DRAFT);
  env.status("ask", "running", "turn-a");
  spoolNotice(BLOCKED, "baton r1/u5 blocked on a question");
  await run();
  const ask = env.runStdins()[1]!;
  expect(ask).toContain("Show this text: baton r1/u5 blocked on a question.");
  expect(ask).toContain("- red\n- green\n- blue\n- amber\n- More…\n");
  expect(ask).not.toContain("recommended");
});

test("a draft reply that is not the JSON asked for is asked with no recommendation", async () => {
  env.reply.fn = () => ({ rc: 0, stdout: screenJson(), stderr: "" });
  env.setReplies({ run: [env.delivery("draft"), env.delivery("ask")] });
  env.status("draft", "completed", "turn-d", "I would pick green.");
  env.status("ask", "running", "turn-a");
  spoolNotice(BLOCKED, "m");
  await run();
  expect(env.runStdins()[1]).toContain("- red\n- green\n");
  expect(env.runStdins()[1]).not.toContain("recommended");
});

test("a blocked park with no picker on screen, or a screen that fails, is asked at once with the escapes", async () => {
  for (const r of [{ rc: 0, stdout: screenJson(null) }, { rc: 4, stdout: "" }, { rc: 0, stdout: "not json" }]) {
    env.cleanup();
    env = makeEnv();
    env.reply.fn = () => ({ ...r, stderr: "" });
    env.setReplies({ run: env.delivery("ask") });
    env.status("ask", "running", "turn-a");
    spoolNotice(BLOCKED, "m");
    await run();
    expect(env.runStdins().length).toBe(1);
    expect(env.runStdins()[0]).toContain("answer it in the Orca terminal.");
    expect(env.runStdins()[0]).toContain("- Show question\n- Unpark\n- Disarm\nDo not answer");
  }
});

test("a refused run keeps the notice and its order", async () => {
  env.setReplies({
    run: [{ stdout: '{"ok":false,"exitCode":1,"error":"limit"}', rc: 1 }, env.delivery("d1"), env.delivery("d2")],
  });
  env.status("d1", "completed", "t1", "x");
  env.status("d2", "completed", "t2", "y");
  spoolNotice("a/1", "first");
  spoolNotice("b/2", "second");
  const r1 = await run();
  expect(listSpool().map((s) => s.item.key)).toEqual(["a/1", "b/2"]);
  expect(env.runStdins().length).toBe(1);
  expect(r1.err.join("")).toContain("bot-on-openbot: drain stopped:");
  await run(2);
  expect(listSpool()).toEqual([]);
  expect(env.runStdins().slice(1)).toEqual([
    "Send the operator this message, verbatim, and nothing else: first",
    "Send the operator this message, verbatim, and nothing else: second",
  ]);
});

test("OpenBot down keeps the notice too", async () => {
  env.setReplies({ run: { stdout: "", rc: 5 } });
  spoolNotice("a/1", "first");
  await run();
  expect(listSpool().map((s) => s.item.key)).toEqual(["a/1"]);
  expect(all()).toEqual([]);
});

test("the same notice twice is asked once", async () => {
  env.setReplies({ run: [env.delivery("d1"), env.delivery("d2")] });
  env.status("d1", "completed", "turn-1", "x"); // no answer row: it closes as gone
  spoolNotice(PARK, "m");
  spoolNotice(PARK, "m");
  await run(2);
  expect(env.runStdins().length).toBe(1);
  expect(listSpool()).toEqual([]);
});

test("a second notice waits while a question is open, then goes once the first closes", async () => {
  env.setReplies({ run: [env.delivery("d1"), env.delivery("d2")] });
  env.status("d1", "running", "turn-1");
  spoolNotice(PARK, "m1");
  spoolNotice("r1/done", "m2");
  await run(2);
  expect(env.runStdins().length).toBe(1);
  expect(listSpool().map((s) => s.item.key)).toEqual(["r1/done"]);
  expect(open().map((r) => r.key)).toEqual([PARK]);
  // the question ends with no answer row: closed, and the next loop sends the second
  env.status("d1", "completed", "turn-1", "x");
  env.status("d2", "running", "turn-2");
  await run(2);
  expect(find(PARK)).toMatchObject({ phase: "closed", closed_by: "gone" });
  expect(env.runStdins().length).toBe(2);
  expect(listSpool()).toEqual([]);
});

test("an unreadable answer row runs nothing and tells the operator", async () => {
  env.setReplies({ run: [env.delivery("d1"), env.delivery("d2")] });
  env.status("d1", "running", "turn-1");
  env.status("d2", "completed", "turn-2", "sent");
  env.resolve("turn-1", "Unpark", (p) => delete p.changedMessages[0].questionPrompt.resolution);
  spoolNotice(PARK, "m");
  const r = await run(2);
  expect(env.runs).toEqual([]);
  expect(find(PARK)).toMatchObject({ phase: "closed", closed_by: "gone" });
  expect(r.err.filter((l) => l.includes("unreadable"))).toEqual([`bot-on-openbot: ${PARK}: the answer in openbot.db is unreadable; nothing ran\n`]);
  expect(env.runStdins()[1]).toBe(
    "Send the operator this message, verbatim, and nothing else: r1/u1 parked: your answer could not be read, so nothing ran. Act in the Orca terminal or with baton.",
  );
  expect(find(`${PARK}#1`)).toMatchObject({ phase: "closed", closed_by: "sent", ask_id: "d2" });
});

test("a second serve exits 3", async () => {
  mkdirSync(join(env.dir, "state"), { recursive: true });
  writeFileSync(join(env.dir, "state", "serve.lock"), String(process.pid));
  await expect(serve(opts())).rejects.toBeInstanceOf(LockHeldError);
  const cfg = join(env.dir, "cfg");
  mkdirSync(cfg);
  writeFileSync(join(cfg, "config.json"), JSON.stringify({ agent: "Autopilot", cli: [join(import.meta.dir, "fake-openbot")] }));
  const p = Bun.spawnSync([BIN, "serve"], {
    env: { ...process.env, BOT_ON_OPENBOT_CONFIG_DIR: cfg, BOT_ON_OPENBOT_STOP_AFTER: "1" },
  });
  expect(p.exitCode).toBe(3);
  expect(p.stderr.toString()).toContain("another serve holds the lock");
  // a stale lock is replaced, and released after
  writeFileSync(join(env.dir, "state", "serve.lock"), "2147483000");
  await run();
  expect(readdirSync(join(env.dir, "state"))).not.toContain("serve.lock");
});

test("the CLI serve exits 1 with one line on a missing config, before any OpenBot call", () => {
  const p = Bun.spawnSync([BIN, "serve"], {
    env: { ...process.env, BOT_ON_OPENBOT_CONFIG_DIR: join(env.dir, "nowhere"), BOT_ON_OPENBOT_STOP_AFTER: "1" },
  });
  expect(p.exitCode).toBe(1);
  expect(p.stderr.toString().trim().split("\n").length).toBe(1);
  expect(env.calls()).toEqual([]);
});

test("a record written by serve is the full record each time", async () => {
  env.setReplies({ run: env.delivery("d1") });
  env.status("d1", "running", "turn-1");
  spoolNotice(PARK, "m");
  await run();
  const lines = readFileSync(join(env.dir, "state", "deliveries.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(lines.at(-1).offer.options.length).toBe(4);
});

// ---- one open delivery per agent (#945) --------------------------------------------------------

const PARK2 = `r2/u1/park/${P1}`;
// r1 is the pulse360 project, r2 another; anything else goes to the default agent.
const AGENTS: Record<string, string> = { r1: "pulse360_autopilot", r2: "other_autopilot" };
const byRun = async (n: Notice): Promise<Route> => ({ agent: n.kind === "plain" ? "Autopilot" : AGENTS[n.run]! });
const runAgents = () => env.calls().filter((c) => c.argv[0] === "run").map((c) => c.argv[1]);

test("two projects' parks are open at once, each on its own agent", async () => {
  env.writeRun(defaultRun(), "r2");
  env.setReplies({ run: [env.delivery("d1"), env.delivery("d2")] });
  env.status("d1", "running", "turn-1");
  env.status("d2", "running", "turn-2");
  spoolNotice(PARK, "baton r1/u1 parked");
  spoolNotice(PARK2, "baton r2/u1 parked");
  await run(1, byRun);
  expect(runAgents()).toEqual(["pulse360_autopilot", "other_autopilot"]);
  expect(find(PARK)).toMatchObject({ phase: "asked", ask_id: "d1", agent: "pulse360_autopilot" });
  expect(find(PARK2)).toMatchObject({ phase: "asked", ask_id: "d2", agent: "other_autopilot" });
  expect(listSpool()).toEqual([]);
});

test("a second park in one project waits behind the first", async () => {
  env.setReplies({ run: [env.delivery("d1"), env.delivery("d2")] });
  env.status("d1", "running", "turn-1");
  spoolNotice(PARK, "baton r1/u1 parked");
  spoolNotice("r1/done", "baton r1 done");
  await run(1, byRun);
  expect(runAgents()).toEqual(["pulse360_autopilot"]);
  expect(listSpool().map((s) => s.item.key)).toEqual(["r1/done"]);
});

test("a refused run holds only its own agent", async () => {
  env.writeRun(defaultRun(), "r2");
  env.setReplies({ run: [{ stdout: '{"ok":false,"exitCode":1,"error":"limit"}', rc: 1 }, env.delivery("d2")] });
  env.status("d2", "running", "turn-2");
  spoolNotice(PARK, "baton r1/u1 parked");
  spoolNotice(PARK2, "baton r2/u1 parked");
  spoolNotice("r1/done", "baton r1 done"); // behind the refused one, in its agent: not tried
  const r = await run(1, byRun);
  expect(runAgents()).toEqual(["pulse360_autopilot", "other_autopilot"]);
  expect(listSpool().map((s) => s.item.key)).toEqual([PARK, "r1/done"]);
  expect(find(PARK)).toBeUndefined();
  expect(find(PARK2)).toMatchObject({ phase: "asked", agent: "other_autopilot" });
  expect(r.err.join("")).toContain("bot-on-openbot: drain stopped: pulse360_autopilot:");
});

test("a fallback note heads the text", async () => {
  env.setReplies({ run: env.delivery("d1") });
  env.status("d1", "running", "turn-1");
  spoolNotice(PARK, "baton r1/u1 parked in build: second prompt");
  const r = await run(1, async () => ({ agent: "Autopilot", note: "[run r1: no project — sent to Autopilot]" }));
  expect(r.err.filter((l) => l.includes("no project"))).toEqual([`bot-on-openbot: ${PARK}: [run r1: no project — sent to Autopilot]\n`]);
  const [task] = env.runStdins();
  expect(task).toContain("Show this text: [run r1: no project — sent to Autopilot]\nbaton r1/u1 parked in build: second prompt.");
  expect(runAgents()).toEqual(["Autopilot"]);
  expect(find(PARK)).toMatchObject({ phase: "asked", agent: "Autopilot" });
});

test("a fallback note heads a blocked park's question on every path", async () => {
  const NOTE = "[run r1: no project — sent to Autopilot]";
  const fallback = async (): Promise<Route> => ({ agent: "Autopilot", note: NOTE });
  const cases: { screen: { rc: number; stdout: string }; draft?: [string, string | null]; text: string }[] = [
    { screen: { rc: 0, stdout: screenJson() }, draft: ["completed", DRAFT], text: "It asks for a colour." },
    { screen: { rc: 0, stdout: screenJson() }, draft: ["failed", null], text: "baton r1/u5 blocked on a question" },
    { screen: { rc: 0, stdout: screenJson(null) }, text: "baton r1/u5 blocked on a question" },
  ];
  for (const c of cases) {
    env.cleanup();
    env = makeEnv();
    env.reply.fn = () => ({ ...c.screen, stderr: "" });
    env.setReplies({ run: c.draft ? [env.delivery("draft"), env.delivery("ask")] : env.delivery("ask") });
    if (c.draft) env.status("draft", c.draft[0], c.draft[0] === "failed" ? null : "turn-d", c.draft[1]);
    env.status("ask", "running", "turn-a");
    spoolNotice(BLOCKED, "baton r1/u5 blocked on a question");
    await run(1, fallback);
    const ask = env.runStdins().at(-1)!;
    expect(ask).toContain(`Show this text: ${NOTE}\n${c.text}`);
    expect(find(BLOCKED)!.offer!.text.startsWith(`${NOTE}\n${c.text}`)).toBe(true);
  }
});

test("a refused run drops its cached route, so a deleted agent falls back on the next loop", async () => {
  env.writeRun(defaultRun({ params: { repo: "/r" } }));
  env.reply.fn = () => ({ rc: 0, stdout: "https://github.com/o/pulse360.git\n", stderr: "" });
  const known = new Set(["pulse360_autopilot"]);
  const probe = (agent: string) => ({ ...env.botFor(agent), exists: async () => known.has(agent) }) as OpenBot;
  const router = makeRouter({ agent: "Autopilot", agents: {}, cli: [], db: "/x", automationDir: "/x" }, probe, env.runner);
  const o = { ...serveOpts(env, T0, 1, router), forget: router.forget };
  env.setReplies({ run: [{ stdout: '{"ok":false,"exitCode":1,"error":"no such agent"}', rc: 1 }, env.delivery("d1")] });
  env.status("d1", "running", "turn-1");
  spoolNotice(PARK, "baton r1/u1 parked");
  await captureErr(() => serve(o)); // routed (and cached) to pulse360_autopilot; refused
  known.delete("pulse360_autopilot"); // the agent was deleted or renamed
  const r = await captureErr(() => serve(o));
  expect(runAgents()).toEqual(["pulse360_autopilot", "Autopilot"]);
  expect(env.runStdins()[1]).toContain("Show this text: [pulse360: no OpenBot agent pulse360_autopilot — sent to Autopilot]\n");
  expect(find(PARK)).toMatchObject({ phase: "asked", agent: "Autopilot" });
  expect(r.err.join("")).toContain(`bot-on-openbot: ${PARK}: [pulse360: no OpenBot agent`);
});

test("agent names differing only in case or spaces are one queue", async () => {
  record({ key: "k0", phase: "asked", run: "r9", title: "t", say: "x", ask_id: "d0", agent: "autopilot" });
  env.setReplies({ run: [{ stdout: '{"ok":false,"exitCode":1,"error":"limit"}', rc: 1 }, env.delivery("d2")] });
  env.status("d0", "running");
  spoolNotice("a/1", "m"); // routed to Autopilot, which has k0 open as autopilot
  await run(1, async () => ({ agent: "Autopilot" }));
  expect(runAgents()).toEqual([]);
  expect(listSpool().map((s) => s.item.key)).toEqual(["a/1"]);

  record({ key: "k0", phase: "closed", run: "r9", title: "t", say: "x", ask_id: "d0", agent: "autopilot" });
  spoolNotice("b/done", "m2");
  await run(1, async (n) => ({ agent: n.kind === "plain" ? "Autopilot" : " AUTOPILOT" }));
  expect(runAgents()).toEqual(["Autopilot"]); // refused: holds " AUTOPILOT" too, so b/done waits
  expect(listSpool().map((s) => s.item.key)).toEqual(["a/1", "b/done"]);
});

test("route down keeps the notice and stops the drain", async () => {
  env.setReplies({ run: env.delivery("d1") });
  spoolNotice(PARK, "m");
  spoolNotice("r1/done", "m2"); // the same project: must never overtake it
  spoolNotice("a/1", "m3"); // the default agent: not sent this loop either
  const r = await run(1, async (n) => {
    if (n.kind === "unit-park") throw new OpenBotDown("OpenBot agents: no answer");
    return { agent: n.kind === "plain" ? "Autopilot" : "pulse360_autopilot" };
  });
  expect(env.calls()).toEqual([]);
  expect(listSpool().map((s) => s.item.key)).toEqual([PARK, "r1/done", "a/1"]);
  expect(all()).toEqual([]);
  expect(r.err.join("")).toContain("bot-on-openbot: drain stopped: OpenBot agents: no answer");
});

test("a follow-up stays on its parent's agent", async () => {
  const offer = offerFor({ kind: "unit-park", run: "r1", unit: "u1", at: P1 }, "baton r1/u1 parked", "r1")!;
  record({ key: PARK, phase: "asked", run: "r1", unit: "u1", park_at: P1, title: offer.title, offer, ask_id: "d1", agent: "p_bot" });
  env.setReplies({ run: env.delivery("d2") });
  env.status("d1", "running", "turn-1");
  env.status("d2", "running", "turn-2");
  env.resolve("turn-1", "Unpark to stage…");
  await run(2, byRun); // the tap opens the follow-up; the next loop sends it
  expect(env.calls()[0]!.argv).toEqual(["status", "p_bot", "d1", "--json"]);
  expect(runAgents()).toEqual(["p_bot"]);
  expect(find(`${PARK}#1`)).toMatchObject({ phase: "asked", ask_id: "d2", agent: "p_bot" });
});
