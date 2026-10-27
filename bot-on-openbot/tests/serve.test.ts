import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { all, find, open } from "../src/deliveries.ts";
import { LockHeldError, serve } from "../src/serve.ts";
import { listSpool, spoolNotice } from "../src/spool.ts";
import { captureErr, makeEnv, P1, P5, screenJson, type Env } from "./helpers.ts";

const BIN = join(import.meta.dir, "..", "bin", "bot-on-openbot");
const T0 = new Date("2026-10-27T17:00:00Z");
let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(() => env.cleanup());

const opts = (stopAfter = 1) => ({ bot: env.bot, runner: env.runner, now: () => T0, stopAfter, pollMs: 0 });
const run = (stopAfter = 1) => captureErr(() => serve(opts(stopAfter)));
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
