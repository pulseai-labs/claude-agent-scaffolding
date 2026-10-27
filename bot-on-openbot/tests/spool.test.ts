import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSpool, removeSpool, spoolNotice } from "../src/spool.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bot-spool-"));
  process.env.BOT_ON_OPENBOT_STATE_DIR = dir;
});
afterEach(() => {
  delete process.env.BOT_ON_OPENBOT_STATE_DIR;
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

test("a malformed file moves to spool-bad, is not returned, and is named once on stderr without its content", () => {
  spoolNotice("a", "1");
  writeFileSync(join(dir, "spool", "0000000000000-000000-bad.json"), "{nope SECRET-ISH");
  mkdirSync(join(dir, "spool"), { recursive: true });
  writeFileSync(join(dir, "spool", "0000000000001-000000-shape.json"), '{"key":1}');
  const err: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((c: string | Uint8Array) => (err.push(String(c)), true)) as typeof process.stderr.write;
  let listed: string[];
  try {
    listed = listSpool().map((s) => s.item.key);
  } finally {
    process.stderr.write = realWrite;
  }
  expect(listed).toEqual(["a"]);
  expect(err).toEqual([
    "bot-on-openbot: set aside malformed spool file 0000000000000-000000-bad.json\n",
    "bot-on-openbot: set aside malformed spool file 0000000000001-000000-shape.json\n",
  ]);
  expect(readdirSync(join(dir, "spool-bad")).sort()).toEqual([
    "0000000000000-000000-bad.json",
    "0000000000001-000000-shape.json",
  ]);
});
