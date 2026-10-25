import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  idsOnMessage, keyboardFor, lookup, mint, setMessageId, spend, type Keyboard,
} from "../src/buttons.ts";

let dir: string;
const now = new Date("2026-10-23T12:00:00Z");
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bot-buttons-"));
  process.env.BOT_ON_TELEGRAM_STATE_DIR = dir;
  process.env.BATON_STATE_DIR = join(import.meta.dir, "fixtures", "baton");
});
afterEach(() => {
  delete process.env.BOT_ON_TELEGRAM_STATE_DIR;
  delete process.env.BATON_STATE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const texts = (k: Keyboard | undefined): string[] =>
  (k?.inline_keyboard ?? []).flat().map((b) => b.text);
const cb = (k: Keyboard | undefined) =>
  (k?.inline_keyboard ?? []).flat().filter((b): b is { text: string; callback_data: string } => "callback_data" in b);

test("mint ids are 10 base32 chars and callback_data fits 64 bytes", () => {
  const r = mint({ action: "unpark", run: "r1", unit: "u1" }, now);
  expect(r.id).toMatch(/^[a-z2-7]{10}$/);
  expect(r.minted_at).toBe(now.toISOString());
  const k = keyboardFor({ kind: "unit-park", run: "r1", unit: "u1", at: "" }, now);
  for (const b of cb(k)) expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
});

test("lookup finds, expires after 7 days + 1 s, and 7 days exactly is still live", () => {
  const r = mint({ action: "unpark", run: "r1", unit: "u1" }, now);
  expect(lookup(r.id, now)).toMatchObject({ id: r.id, action: "unpark", run: "r1", unit: "u1" });
  expect(lookup(r.id, new Date(now.getTime() + 7 * 86400_000))).toMatchObject({ id: r.id });
  expect(lookup(r.id, new Date(now.getTime() + 7 * 86400_000 + 1000))).toBe("expired");
  expect(lookup("zzzzzzzzzz", now)).toBe("unknown");
});

test("spend then lookup is used; spending one id leaves another live", () => {
  const a = mint({ action: "disarm", run: "r1" }, now);
  const b = mint({ action: "disarm", run: "r1" }, now);
  spend(a.id, now);
  expect(lookup(a.id, now)).toBe("used");
  expect(lookup(b.id, now)).toMatchObject({ id: b.id });
});

test("setMessageId binds ids; idsOnMessage lists them; record survives", () => {
  const a = mint({ action: "disarm", run: "r1" }, now);
  const b = mint({ action: "disarm", run: "r1" }, now);
  const c = mint({ action: "disarm", run: "r1" }, now);
  setMessageId([a.id, b.id], 42);
  expect(idsOnMessage(42).sort()).toEqual([a.id, b.id].sort());
  expect(idsOnMessage(43)).toEqual([]);
  expect(lookup(a.id, now)).toMatchObject({ message_id: 42, action: "disarm" });
  spend(a.id, now);
  expect(idsOnMessage(42)).toContain(a.id);
  expect(lookup(c.id, now)).toMatchObject({ id: c.id });
});

test("unit-park keyboard", () => {
  const k = keyboardFor({ kind: "unit-park", run: "r1", unit: "u1", at: "" }, now);
  expect(texts(k)).toEqual(["Unpark", "Unpark to stage…", "Show question", "Disarm"]);
  expect(lookup(cb(k)[0]!.callback_data, now)).toMatchObject({ action: "unpark", run: "r1", unit: "u1" });
});

test("unit-move with pr_url and a reviewed head: Merge, Open PR, Disarm", () => {
  const k = keyboardFor({ kind: "unit-move", run: "r1", unit: "u2", stage: "spine_ack" }, now);
  expect(texts(k)).toEqual(["Merge", "Open PR", "Disarm"]);
  const url = k!.inline_keyboard.flat().find((b) => b.text === "Open PR");
  expect(url).toEqual({ text: "Open PR", url: "https://github.com/o/r/pull/7" });
  expect(lookup(cb(k)[0]!.callback_data, now)).toMatchObject({
    action: "merge", pr_url: "https://github.com/o/r/pull/7", head_sha: "a".repeat(40),
  });
});

test("unit-move with pr_url and no reviewed head: Open PR, Disarm only", () => {
  expect(texts(keyboardFor({ kind: "unit-move", run: "r1", unit: "u3", stage: "spine_ack" }, now))).toEqual(["Open PR", "Disarm"]);
  expect(keyboardFor({ kind: "unit-move", run: "r1", unit: "no-such-unit", stage: "s" }, now)).toBeUndefined();
});

test("unit-move with no pr_url, and run-park: Disarm only", () => {
  expect(texts(keyboardFor({ kind: "unit-move", run: "r1", unit: "u4", stage: "build" }, now))).toEqual(["Disarm"]);
  const k = keyboardFor({ kind: "run-park", run: "r1" }, now);
  expect(texts(k)).toEqual(["Disarm"]);
  expect(lookup(cb(k)[0]!.callback_data, now)).toMatchObject({ action: "disarm", run: "r1" });
});

test("undefined when the run state cannot be read, and for run-done / plain", () => {
  expect(keyboardFor({ kind: "unit-park", run: "nope", unit: "u1", at: "" }, now)).toBeUndefined();
  expect(keyboardFor({ kind: "run-park", run: "nope" }, now)).toBeUndefined();
  expect(keyboardFor({ kind: "run-done", run: "r1" }, now)).toBeUndefined();
  expect(keyboardFor({ kind: "plain" }, now)).toBeUndefined();
});

test("lookup of an id never minted is unknown, with and without a log file", () => {
  expect(lookup("neverminted", now)).toBe("unknown");
  mint({ action: "disarm", run: "r1" }, now);
  expect(lookup("neverminted", now)).toBe("unknown");
});

test("undefined for a missing unit in an existing run, and for a garbage run.json", () => {
  expect(keyboardFor({ kind: "unit-park", run: "r1", unit: "no-such-unit", at: "" }, now)).toBeUndefined();
  expect(keyboardFor({ kind: "unit-park", run: "r3", unit: "u1", at: "" }, now)).toBeUndefined();
  expect(keyboardFor({ kind: "run-park", run: "r3" }, now)).toBeUndefined();
});

test("a NaN minted_at is expired", () => {
  const r = mint({ action: "disarm", run: "r1" }, now);
  const log = join(dir, "buttons.jsonl");
  writeFileSync(log, JSON.stringify({ ...r, minted_at: "garbage" }) + "\n");
  expect(lookup(r.id, now)).toBe("expired");
});
