import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBotConfig, readToken } from "../src/config.ts";

const TOKEN = "123:SECRET_FIXTURE_TOKEN_abcdefghijklmnopqrstuv";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bot-cfg-"));
  process.env.BOT_ON_TELEGRAM_CONFIG_DIR = dir;
});
afterEach(() => {
  delete process.env.BOT_ON_TELEGRAM_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

test("readBotConfig returns the chat id", () => {
  writeFileSync(join(dir, "config.json"), '{"chat_id":646298185}');
  expect(readBotConfig()).toEqual({ chat_id: 646298185 });
});

test("readBotConfig rejects a non-integer chat_id, a non-object and a missing file", () => {
  writeFileSync(join(dir, "config.json"), '{"chat_id":"x"}');
  expect(() => readBotConfig()).toThrow();
  writeFileSync(join(dir, "config.json"), '{"chat_id":1.5}');
  expect(() => readBotConfig()).toThrow();
  writeFileSync(join(dir, "config.json"), "[1]");
  expect(() => readBotConfig()).toThrow();
  rmSync(join(dir, "config.json"));
  expect(() => readBotConfig()).toThrow();
});

test("readToken returns the token from a mode 600 file", () => {
  const f = join(dir, "token");
  writeFileSync(f, TOKEN + "\n");
  chmodSync(f, 0o600);
  expect(readToken()).toBe(TOKEN);
});

test("readToken refuses mode 644 without echoing the token", () => {
  const f = join(dir, "token");
  writeFileSync(f, TOKEN);
  chmodSync(f, 0o644);
  let msg = "";
  try { readToken(); } catch (e) { msg = (e as Error).message; }
  expect(msg).toContain("token file must be mode 600");
  expect(msg).not.toContain(TOKEN);
});

test("readToken reports missing and empty files", () => {
  expect(() => readToken()).toThrow("token file missing");
  const f = join(dir, "token");
  writeFileSync(f, "\n");
  chmodSync(f, 0o600);
  expect(() => readToken()).toThrow("token file is empty");
});
