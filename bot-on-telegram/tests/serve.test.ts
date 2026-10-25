import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "../src/actions.ts";
import { keyboardFor, setMessageId, type Keyboard } from "../src/buttons.ts";
import { LockHeldError, serve } from "../src/serve.ts";
import { makeApi } from "../src/telegram.ts";
import { FakeTelegram } from "./fake-telegram.ts";

const CHAT = 42;
const TOKEN = "123456:FIXTURE-TOKEN-do-not-leak";
const T0 = new Date("2026-10-23T12:00:00Z");
const BIN = join(import.meta.dir, "..", "bin", "bot-on-telegram");

let dir: string;
let fake: FakeTelegram;
let base: string;
let runs: string[][];
let runner: Runner;

let errLines: string[];
const realWrite = process.stderr.write.bind(process.stderr);
beforeEach(async () => {
  errLines = [];
  process.stderr.write = ((c: string | Uint8Array) => (errLines.push(String(c)), true)) as typeof process.stderr.write;
  dir = mkdtempSync(join(tmpdir(), "bot-serve-"));
  process.env.BOT_ON_TELEGRAM_STATE_DIR = join(dir, "state");
  process.env.BATON_STATE_DIR = join(import.meta.dir, "fixtures", "baton");
  fake = new FakeTelegram();
  base = await fake.start();
  runs = [];
  runner = async (argv) => {
    runs.push(argv);
    return { rc: 0, stdout: "", stderr: "" };
  };
});
afterEach(() => {
  process.stderr.write = realWrite;
  fake.stop();
  delete process.env.BOT_ON_TELEGRAM_STATE_DIR;
  delete process.env.BATON_STATE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const state = () => process.env.BOT_ON_TELEGRAM_STATE_DIR!;
const opts = (over: Record<string, unknown> = {}) => ({
  api: makeApi(TOKEN, { base, backoffMs: 1 }),
  chatId: CHAT,
  runner,
  now: () => T0,
  stopAfter: 2,
  backoffMs: 1,
  ...over,
});

// An unpark button bound to message 7, and the update that presses it.
function pressUpdate(updateId: number) {
  const k: Keyboard = keyboardFor({ kind: "unit-park", run: "r1", unit: "u1", at: "" }, T0)!;
  const btns = k.inline_keyboard.flat().filter((b): b is { text: string; callback_data: string } => "callback_data" in b);
  setMessageId(btns.map((b) => b.callback_data), 7);
  const unpark = btns.find((b) => b.text === "Unpark")!.callback_data;
  return {
    update_id: updateId,
    callback_query: {
      id: `cq${updateId}`,
      from: { id: CHAT },
      message: { message_id: 7, chat: { id: CHAT }, text: "baton r1/u1 parked in build: x" },
      data: unpark,
    },
  };
}

test("serve sends the spooled notice, handles the press, and persists offset = update_id + 1", async () => {
  const { spoolNotice } = await import("../src/spool.ts");
  spoolNotice("plain-1", "hello");
  fake.updates = [pressUpdate(500)];
  await serve(opts());
  const methods = fake.calls.map((c) => c.method);
  expect(methods[0]).toBe("sendMessage");
  expect(fake.calls[0]!.body.text).toBe("🔴 ACTION — hello");
  expect(methods).toContain("getUpdates");
  expect(runs.length).toBe(1);
  expect(runs[0]).toContain("unpark");
  expect(readFileSync(join(state(), "offset"), "utf8").trim()).toBe("501");
  const getu = fake.calls.find((c) => c.method === "getUpdates")!;
  expect(getu.body.timeout).toBe(25);
  expect(getu.body.allowed_updates).toEqual(["callback_query", "message"]);
  // the lock is released
  expect(readdirSync(state())).not.toContain("serve.lock");
});

test("a restarted serve does not handle that update again", async () => {
  fake.updates = [pressUpdate(500)];
  await serve(opts());
  expect(runs.length).toBe(1);
  // Telegram would drop it on offset 501; if it came back anyway the buttons are spent, so only
  // the offset the second serve sends proves the persistence.
  await serve(opts({ stopAfter: 1 }));
  const offsets = fake.calls.filter((c) => c.method === "getUpdates").map((c) => c.body.offset);
  expect(offsets[offsets.length - 1]).toBe(501);
  expect(fake.updates).toEqual([]);
});

test("an update whose handling throws is not handled again, on the next loop or after a restart", async () => {
  let calls = 0;
  runner = async () => {
    calls++;
    throw new Error("runner exploded");
  };
  fake.updates = [pressUpdate(600)];
  await serve(opts({ stopAfter: 3 }));
  expect(calls).toBe(1);
  expect(errLines).toEqual(["bot-on-telegram: update 600: runner exploded\n"]);
  expect(readFileSync(join(state(), "offset"), "utf8").trim()).toBe("601");
  await serve(opts({ stopAfter: 1 }));
  expect(calls).toBe(1);
  // A spent button would make a second handling harmless to the runner, but it would still log a press.
  const logged = readFileSync(join(state(), "presses.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(logged.filter((l) => l.update_id === 600).length).toBe(1);
});

test("one failing update does not stop the updates after it", async () => {
  let n = 0;
  runner = async () => {
    if (n++ === 0) throw new Error("first fails");
    return { rc: 0, stdout: "", stderr: "" };
  };
  fake.updates = [pressUpdate(700), { update_id: 701, message: { chat: { id: CHAT }, from: { id: CHAT }, text: "hi" } } as never];
  await serve(opts({ stopAfter: 1 }));
  expect(fake.calls.some((c) => c.method === "sendMessage" && c.body.text === "this bot takes button presses only")).toBe(true);
  expect(readFileSync(join(state(), "offset"), "utf8").trim()).toBe("702");
});

test("a second serve while the lock is held fails with LockHeldError; a stale lock is replaced", async () => {
  mkdirSync(state(), { recursive: true });
  writeFileSync(join(state(), "serve.lock"), String(process.pid));
  await expect(serve(opts())).rejects.toBeInstanceOf(LockHeldError);
  expect(readFileSync(join(state(), "serve.lock"), "utf8").trim()).toBe(String(process.pid)); // untouched
  writeFileSync(join(state(), "serve.lock"), "2147483000"); // no such pid
  await serve(opts({ stopAfter: 1 }));
  expect(readdirSync(state())).not.toContain("serve.lock");
});

test("the CLI exits 3 with 'another serve holds the lock' when the lock is held", () => {
  mkdirSync(state(), { recursive: true });
  writeFileSync(join(state(), "serve.lock"), String(process.pid));
  const cfg = join(dir, "cfg");
  mkdirSync(cfg);
  writeFileSync(join(cfg, "token"), TOKEN, { mode: 0o600 });
  writeFileSync(join(cfg, "config.json"), JSON.stringify({ chat_id: CHAT }));
  const p = Bun.spawnSync([BIN, "serve"], {
    env: { ...process.env, BOT_ON_TELEGRAM_CONFIG_DIR: cfg, BOT_ON_TELEGRAM_API_BASE: base, BOT_ON_TELEGRAM_STOP_AFTER: "1" },
  });
  expect(p.exitCode).toBe(3);
  expect(p.stderr.toString()).toContain("another serve holds the lock");
});

test("the CLI exits non-zero with a one-line error, before polling, on a bad token or config", () => {
  const cfg = join(dir, "cfg");
  mkdirSync(cfg);
  const env = { ...process.env, BOT_ON_TELEGRAM_CONFIG_DIR: cfg, BOT_ON_TELEGRAM_API_BASE: base, BOT_ON_TELEGRAM_STOP_AFTER: "1" };
  let p = Bun.spawnSync([BIN, "serve"], { env });
  expect(p.exitCode).toBe(1);
  expect(p.stderr.toString().trim().split("\n").length).toBe(1);
  writeFileSync(join(cfg, "token"), TOKEN, { mode: 0o644 });
  writeFileSync(join(cfg, "config.json"), JSON.stringify({ chat_id: CHAT }));
  p = Bun.spawnSync([BIN, "serve"], { env });
  expect(p.exitCode).toBe(1);
  expect(p.stderr.toString()).not.toContain(TOKEN);
  expect(p.stderr.toString()).toContain("mode 600");
  writeFileSync(join(cfg, "token"), TOKEN, { mode: 0o600 });
  statSync(join(cfg, "token"));
  writeFileSync(join(cfg, "config.json"), "{}");
  p = Bun.spawnSync([BIN, "serve"], { env });
  expect(p.exitCode).toBe(1);
  expect(fake.calls).toEqual([]);
});

test("token sweep: after a CLI serve run no file under the state dir, nor stdout or stderr, holds the token", async () => {
  const { spoolNotice } = await import("../src/spool.ts");
  spoolNotice("plain-1", "hello");
  spoolNotice("bad", "will be rejected");
  fake.failures = [];
  fake.updates = [
    { update_id: 800, message: { chat: { id: 9 }, from: { id: 9 }, text: "stranger" } } as never,
    { update_id: 801, callback_query: { id: "c", from: { id: CHAT }, message: { message_id: 1, chat: { id: CHAT } }, data: "nope" } } as never,
  ];
  const cfg = join(dir, "cfg");
  mkdirSync(cfg);
  writeFileSync(join(cfg, "token"), TOKEN, { mode: 0o600 });
  writeFileSync(join(cfg, "config.json"), JSON.stringify({ chat_id: CHAT }));
  const proc = Bun.spawn([BIN, "serve"], {
    env: { ...process.env, BOT_ON_TELEGRAM_CONFIG_DIR: cfg, BOT_ON_TELEGRAM_API_BASE: base, BOT_ON_TELEGRAM_STOP_AFTER: "2" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, rc] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(rc).toBe(0);
  expect(out + err).not.toContain(TOKEN);
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const files = walk(state()).map((f) => f.slice(state().length + 1));
  expect(files).toContain("offset");
  expect(files).toContain("presses.jsonl");
  for (const f of walk(state())) expect(readFileSync(f, "utf8")).not.toContain(TOKEN);
  // control: the token did reach the (fake) server, so the sweep is not vacuous
  expect(fake.calls.length).toBeGreaterThan(0);
  expect(fake.calls.every((c) => c.token === TOKEN)).toBe(true);
});

test("serve sweeps settled actions each loop: an open action on an unparked unit is edited", async () => {
  const { recordOpen } = await import("../src/settle.ts");
  recordOpen({ message_id: 9, run: "r1", unit: "u2", park_at: "2026-10-23T10:00:00Z", text: "🔴 ACTION — x" });
  await serve(opts());
  const edit = fake.calls.find((c) => c.method === "editMessageText");
  expect(edit?.body.text).toBe("✅ settled — 🔴 ACTION — x");
});
