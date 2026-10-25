import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { idsOnMessage } from "../src/buttons.ts";
import { drainSpool } from "../src/send.ts";
import { spoolNotice } from "../src/spool.ts";
import { makeApi } from "../src/telegram.ts";
import { FakeTelegram } from "./fake-telegram.ts";

let dir: string;
let fake: FakeTelegram;
let base: string;
const now = () => new Date("2026-10-23T12:00:00Z");
const api = () => makeApi("1:T", { base, backoffMs: 1 });
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "bot-send-"));
  process.env.BOT_ON_TELEGRAM_STATE_DIR = dir;
  process.env.BATON_STATE_DIR = join(import.meta.dir, "fixtures", "baton");
  fake = new FakeTelegram();
  base = await fake.start();
});
afterEach(() => {
  fake.stop();
  delete process.env.BOT_ON_TELEGRAM_STATE_DIR;
  delete process.env.BATON_STATE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

test("two spooled notices are sent in order and both spool files are gone", async () => {
  const p1 = spoolNotice("plain-1", "first");
  const p2 = spoolNotice("plain-2", "second");
  expect(await drainSpool(api(), 42, now)).toEqual({ sent: 2, failed: 0 });
  expect(fake.calls.map((c) => c.body.text)).toEqual(["🔴 ACTION — first", "🔴 ACTION — second"]);
  expect(fake.calls[0]!.body.chat_id).toBe(42);
  expect(existsSync(p1) || existsSync(p2)).toBe(false);
});

test("a unit-park notice is sent with the four-button keyboard", async () => {
  spoolNotice("r1/u1/park/2026-10-23T11:00:00Z", "parked");
  await drainSpool(api(), 42, now);
  const kb = fake.calls[0]!.body.reply_markup as { inline_keyboard: { text: string }[][] };
  expect(kb.inline_keyboard.flat().map((b) => b.text)).toEqual(["Unpark", "Unpark to stage…", "Show question", "Disarm"]);
});

test("a failing first send keeps order: nothing sent, both files remain, second never attempted", async () => {
  const p1 = spoolNotice("plain-1", "first");
  const p2 = spoolNotice("plain-2", "second");
  fake.drops = 6;
  expect(await drainSpool(api(), 42, now)).toEqual({ sent: 0, failed: 1 });
  expect(existsSync(p1) && existsSync(p2)).toBe(true);
  expect(fake.calls).toHaveLength(0);
  expect(fake.dropped).toBe(5); // 5 tries on the first item; the second item was never tried
  // healthy again: both go out exactly once
  expect(await drainSpool(api(), 42, now)).toEqual({ sent: 2, failed: 0 });
  expect(fake.calls.map((c) => c.body.text)).toEqual(["🔴 ACTION — first", "🔴 ACTION — second"]);
  expect(await drainSpool(api(), 42, now)).toEqual({ sent: 0, failed: 0 });
  expect(fake.calls).toHaveLength(2);
});

test("after a send, idsOnMessage(message_id) equals the minted ids", async () => {
  spoolNotice("r1/u1/park/2026-10-23T11:00:00Z", "parked");
  await drainSpool(api(), 42, now);
  const kb = fake.calls[0]!.body.reply_markup as { inline_keyboard: { callback_data: string }[][] };
  const minted = kb.inline_keyboard.flat().map((b) => b.callback_data);
  expect(minted).toHaveLength(4);
  expect(idsOnMessage(100).sort()).toEqual([...minted].sort());
});

test("a notice whose run dir is absent goes out with no reply_markup, and the drain continues", async () => {
  spoolNotice("no-such-run/u1/park/2026-10-23T11:00:00Z", "orphan");
  spoolNotice("plain-2", "second");
  expect(await drainSpool(api(), 42, now)).toEqual({ sent: 2, failed: 0 });
  expect("reply_markup" in fake.calls[0]!.body).toBe(false);
  expect(fake.calls.map((c) => c.body.text)).toEqual(["🔴 ACTION — orphan", "🔴 ACTION — second"]);
});

test("a permanent 400 moves that item to spool-failed/ and the drain goes on", async () => {
  const p1 = spoolNotice("plain-1", "first");
  const p2 = spoolNotice("plain-2", "second");
  fake.failures = [{ error_code: 400, description: "Bad Request: message is too long" }];
  const errs: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void errs.push(a.join(" "));
  try {
    expect(await drainSpool(api(), 42, now)).toEqual({ sent: 1, failed: 1 });
  } finally {
    console.error = orig;
  }
  expect(existsSync(p1)).toBe(false);
  expect(existsSync(join(dir, "spool-failed", basename(p1)))).toBe(true);
  expect(existsSync(p2)).toBe(false);
  expect(fake.calls.map((c) => c.body.text)).toEqual(["🔴 ACTION — first", "🔴 ACTION — second"]);
  expect(errs).toEqual(["bot-on-telegram: dropped notice plain-1: Bad Request: message is too long"]);
});

test("a state-dir write error from keyboardFor counts as a failed item, not a rejection", async () => {
  spoolNotice("r1/u1/park/2026-10-23T11:00:00Z", "parked");
  writeFileSync(join(dir, "buttons.jsonl"), "");
  chmodSync(join(dir, "buttons.jsonl"), 0o444);
  try {
    if (process.getuid?.() === 0) return; // root ignores modes
    expect(await drainSpool(api(), 42, now)).toEqual({ sent: 0, failed: 1 });
  } finally {
    chmodSync(join(dir, "buttons.jsonl"), 0o644);
  }
});

for (const code of [401, 403, 404]) {
  test(`a ${code} on the first of two notices stops the drain: both stay in spool/, nothing set aside`, async () => {
    const p1 = spoolNotice("plain-1", "first");
    const p2 = spoolNotice("plain-2", "second");
    fake.failures = [{ error_code: code, description: "Unauthorized" }];
    expect(await drainSpool(api(), 42, now)).toEqual({ sent: 0, failed: 1 });
    expect(existsSync(p1) && existsSync(p2)).toBe(true);
    expect(existsSync(join(dir, "spool-failed"))).toBe(false);
    expect(fake.calls).toHaveLength(1);
  });
}

test("adjacent control: a 400 on the same shape is still set aside", async () => {
  const p1 = spoolNotice("plain-1", "first");
  fake.failures = [{ error_code: 400, description: "Bad Request: chat not found" }];
  const orig = console.error;
  console.error = () => {};
  try {
    expect(await drainSpool(api(), 42, now)).toEqual({ sent: 0, failed: 1 });
  } finally {
    console.error = orig;
  }
  expect(existsSync(join(dir, "spool-failed", basename(p1)))).toBe(true);
});

test("a 400 on a send with buttons is retried once without reply_markup and delivered buttonless", async () => {
  const p1 = spoolNotice("r1/u1/park/2026-10-23T11:00:00Z", "parked");
  fake.failures = [{ error_code: 400, description: "Bad Request: BUTTON_DATA_INVALID" }];
  expect(await drainSpool(api(), 42, now)).toEqual({ sent: 1, failed: 0 });
  expect(fake.calls).toHaveLength(2);
  expect("reply_markup" in fake.calls[0]!.body).toBe(true);
  expect("reply_markup" in fake.calls[1]!.body).toBe(false);
  expect(fake.calls[1]!.body.text).toBe("🔴 ACTION — parked");
  expect(existsSync(p1)).toBe(false);
  expect(existsSync(join(dir, "spool-failed"))).toBe(false);
  expect(idsOnMessage(100)).toEqual([]); // the unsent buttons are bound to no message
});

test("a 400 on the buttonless retry too: set aside after two tries", async () => {
  const p1 = spoolNotice("r1/u1/park/2026-10-23T11:00:00Z", "parked");
  fake.failures = [
    { error_code: 400, description: "Bad Request: BUTTON_DATA_INVALID" },
    { error_code: 400, description: "Bad Request: message is too long" },
  ];
  const orig = console.error;
  console.error = () => {};
  try {
    expect(await drainSpool(api(), 42, now)).toEqual({ sent: 0, failed: 1 });
  } finally {
    console.error = orig;
  }
  expect(fake.calls).toHaveLength(2);
  expect(existsSync(join(dir, "spool-failed", basename(p1)))).toBe(true);
});

test("a 400 on a send with no buttons is not retried", async () => {
  spoolNotice("plain-1", "first");
  fake.failures = [{ error_code: 400, description: "Bad Request: message is too long" }];
  const orig = console.error;
  console.error = () => {};
  try {
    await drainSpool(api(), 42, now);
  } finally {
    console.error = orig;
  }
  expect(fake.calls).toHaveLength(1);
});

test("action marker: a unit-park item is sent as an action, with sound", async () => {
  spoolNotice("r1/u1/park/2026-10-23T10:00:00Z", "baton r1/u1 parked");
  await drainSpool(api(), 42, now);
  const body = fake.calls[0]!.body;
  expect(String(body.text).startsWith("🔴 ACTION — baton r1/u1 parked")).toBe(true);
  expect("disable_notification" in body).toBe(false);
});

test("summary is silent: a run-done item has disable_notification and no marker", async () => {
  spoolNotice("r1/done", "baton r1 done");
  await drainSpool(api(), 42, now);
  const body = fake.calls[0]!.body;
  expect(body.disable_notification).toBe(true);
  expect(body.text).toBe("baton r1 done");
});

test("plain notice is an action", async () => {
  spoolNotice("auth/2026-10-25", "token expired");
  await drainSpool(api(), 42, now);
  expect(fake.calls[0]!.body.text).toBe("🔴 ACTION — token expired");
});

test("a unit-park send records an open action", async () => {
  spoolNotice("r1/u1/park/2026-10-23T10:00:00Z", "parked");
  await drainSpool(api(), 42, now);
  const rec = JSON.parse(readFileSync(join(dir, "open-actions.jsonl"), "utf8").trim());
  expect(rec).toEqual({
    message_id: 100, run: "r1", unit: "u1", park_at: "2026-10-23T10:00:00Z", text: "🔴 ACTION — parked",
  });
});

test("a 4096-char action fits Telegram's limit with the marker kept, and is recorded as sent", async () => {
  spoolNotice("r1/u1/park/2026-10-23T11:00:00Z", "m".repeat(4096));
  expect(await drainSpool(api(), 42, now)).toEqual({ sent: 1, failed: 0 });
  const text = fake.calls[0]!.body.text as string;
  expect(text.length).toBeLessThanOrEqual(4096);
  expect(text.startsWith("🔴 ACTION — m")).toBe(true);
  expect(text.endsWith("m…")).toBe(true);
  const rec = JSON.parse(readFileSync(join(dir, "open-actions.jsonl"), "utf8").trim());
  expect(rec.text).toBe(text);
});

test("a run-done summary that fits is sent unchanged", async () => {
  const msg = "s".repeat(4096);
  spoolNotice("r1/done", msg);
  await drainSpool(api(), 42, now);
  expect(fake.calls[0]!.body.text).toBe(msg);
});

test("a record that cannot be written after a delivered send: the notice is not sent again, the next one is", async () => {
  mkdirSync(join(dir, "open-actions.jsonl")); // appendFileSync now fails (EISDIR)
  const errors: string[] = [];
  const spy = spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a.join(" ")); });
  try {
    const p1 = spoolNotice("r1/u1/park/2026-10-23T11:00:00Z", "parked");
    const p2 = spoolNotice("plain-2", "second");
    expect(await drainSpool(api(), 42, now)).toEqual({ sent: 2, failed: 0 });
    expect(await drainSpool(api(), 42, now)).toEqual({ sent: 0, failed: 0 });
    const sends = fake.calls.filter((c) => c.method === "sendMessage").map((c) => c.body.text);
    expect(sends).toEqual(["🔴 ACTION — parked", "🔴 ACTION — second"]);
    expect(existsSync(p1) || existsSync(p2)).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("r1/u1/park/2026-10-23T11:00:00Z");
  } finally {
    spy.mockRestore();
  }
});
