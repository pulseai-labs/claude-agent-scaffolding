import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSpool, removeSpool, spoolNotice } from "../src/spool.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bot-spool-"));
  process.env.BOT_ON_TELEGRAM_STATE_DIR = dir;
});
afterEach(() => {
  delete process.env.BOT_ON_TELEGRAM_STATE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

test("notices list in call order, even within one millisecond", () => {
  const keys = Array.from({ length: 30 }, (_, i) => `k${i}`);
  for (const k of keys) spoolNotice(k, "m");
  expect(listSpool().map((s) => s.item.key)).toEqual(keys);
});

test("spoolNotice leaves no temp file behind", () => {
  spoolNotice("a", "b");
  expect(readdirSync(join(dir, "spool")).every((n) => n.endsWith(".json"))).toBe(true);
});

test("removeSpool removes exactly one item", () => {
  const p1 = spoolNotice("a", "1");
  spoolNotice("b", "2");
  removeSpool(p1);
  expect(existsSync(p1)).toBe(false);
  expect(listSpool().map((s) => s.item.key)).toEqual(["b"]);
});

test("a malformed file moves to spool-bad and is not returned", () => {
  spoolNotice("a", "1");
  writeFileSync(join(dir, "spool", "0000000000000-000000-bad.json"), "{nope");
  mkdirSync(join(dir, "spool"), { recursive: true });
  writeFileSync(join(dir, "spool", "0000000000001-000000-shape.json"), '{"key":1}');
  expect(listSpool().map((s) => s.item.key)).toEqual(["a"]);
  expect(readdirSync(join(dir, "spool-bad")).sort()).toEqual([
    "0000000000000-000000-bad.json",
    "0000000000001-000000-shape.json",
  ]);
});
