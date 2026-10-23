import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  expect(fake.calls.map((c) => c.body.text)).toEqual(["first", "second"]);
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
  expect(fake.calls.map((c) => c.body.text)).toEqual(["first", "second"]);
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
  expect(fake.calls.map((c) => c.body.text)).toEqual(["orphan", "second"]);
});
