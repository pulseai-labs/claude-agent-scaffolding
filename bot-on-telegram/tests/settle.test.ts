import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { idsOnMessage, lookup, mint, setMessageId, spend } from "../src/buttons.ts";
import { recordOpen, sweepSettled } from "../src/settle.ts";
import { makeApi } from "../src/telegram.ts";
import { FakeTelegram } from "./fake-telegram.ts";

let dir: string;
let fake: FakeTelegram;
let base: string;
const now = new Date("2026-10-25T12:00:00Z");
const api = () => makeApi("1:T", { base, backoffMs: 1 });
const TEXT = "🔴 ACTION — baton r1/u2 parked";
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "bot-settle-"));
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

// r1/u1 is parked at 2026-10-23T10:00:00Z; r1/u2 is not parked (fixtures).
function open(unit: string, park_at: string, mid = 100): string[] {
  recordOpen({ message_id: mid, run: "r1", unit, park_at, text: TEXT });
  const ids = ["unpark", "show"].map((action) => mint({ action: action as "unpark", run: "r1", unit }, now).id);
  setMessageId(ids, mid);
  return ids;
}
const closed = () =>
  readFileSync(join(dir, "open-actions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.closed_at);

test("unparked unit settles: one edit, buttons spent, record closed", async () => {
  const ids = open("u2", "2026-10-23T10:00:00Z");
  expect(await sweepSettled(api(), 42, now)).toBe(1);
  expect(fake.calls).toHaveLength(1);
  expect(fake.calls[0]!.method).toBe("editMessageText");
  expect(fake.calls[0]!.body).toEqual({ chat_id: 42, message_id: 100, text: "✅ settled — " + TEXT });
  for (const id of ids) expect(lookup(id, now)).toBe("used");
  expect(closed()).toHaveLength(1);
  expect(await sweepSettled(api(), 42, now)).toBe(0);
  expect(fake.calls).toHaveLength(1);
});

test("still parked stays open: no API call", async () => {
  open("u1", "2026-10-23T10:00:00Z");
  expect(await sweepSettled(api(), 42, now)).toBe(0);
  expect(fake.calls).toHaveLength(0);
  expect(closed()).toHaveLength(0);
});

test("re-parked later settles the old one", async () => {
  open("u1", "2026-10-22T09:00:00Z");
  expect(await sweepSettled(api(), 42, now)).toBe(1);
  expect(fake.calls).toHaveLength(1);
});

test("a missing unit settles", async () => {
  open("nope", "2026-10-22T09:00:00Z");
  expect(await sweepSettled(api(), 42, now)).toBe(1);
});

test("pressed already: all buttons spent, no edit, record closed", async () => {
  const ids = open("u2", "2026-10-23T10:00:00Z");
  for (const id of ids) spend(id, now);
  expect(await sweepSettled(api(), 42, now)).toBe(0);
  expect(fake.calls).toHaveLength(0);
  expect(closed()).toHaveLength(1);
});

test("not modified closes", async () => {
  open("u2", "2026-10-23T10:00:00Z");
  fake.failOn.editMessageText = [{ error_code: 400, description: "Bad Request: message is not modified" }];
  expect(await sweepSettled(api(), 42, now)).toBe(0);
  expect(closed()).toHaveLength(1);
});

test("another error leaves it open for the next loop", async () => {
  const ids = open("u2", "2026-10-23T10:00:00Z");
  fake.failOn.editMessageText = [{ error_code: 400, description: "Bad Request: message to edit not found" }];
  expect(await sweepSettled(api(), 42, now)).toBe(0);
  expect(closed()).toHaveLength(0);
  expect(idsOnMessage(100).sort()).toEqual([...ids].sort());
  for (const id of ids) expect(lookup(id, now)).not.toBe("used");
  expect(await sweepSettled(api(), 42, now)).toBe(1);
});
