import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CLI, readBotConfig } from "../src/config.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bot-cfg-"));
  process.env.BOT_ON_OPENBOT_CONFIG_DIR = dir;
});
afterEach(() => {
  delete process.env.BOT_ON_OPENBOT_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});
const write = (v: unknown) => writeFileSync(join(dir, "config.json"), typeof v === "string" ? v : JSON.stringify(v));

test("cli default is the bun path", () => {
  write({ agent: "Autopilot" });
  expect(DEFAULT_CLI).toEqual(["bun", "/opt/OpenBot/app/resources/cli/openbot-cli.mjs"]);
  expect(readBotConfig()).toEqual({
    agent: "Autopilot",
    cli: ["bun", "/opt/OpenBot/app/resources/cli/openbot-cli.mjs"],
    db: join(homedir(), ".config", "OpenBot", "openbot.db"),
    automationDir: join(homedir(), ".config", "OpenBot", "automation"),
  });
});

test("cli, db and automationDir can be set", () => {
  write({ agent: "A", cli: ["node", "/x/cli.mjs"], db: "/d/openbot.db", automationDir: "/d/automation" });
  expect(readBotConfig()).toEqual({ agent: "A", cli: ["node", "/x/cli.mjs"], db: "/d/openbot.db", automationDir: "/d/automation" });
});

test("config needs an agent", () => {
  write({});
  expect(() => readBotConfig()).toThrow("config agent must be a non-empty string");
  write({ agent: "" });
  expect(() => readBotConfig()).toThrow("config agent must be a non-empty string");
  write({ agent: "   " });
  expect(() => readBotConfig()).toThrow("config agent must be a non-empty string");
  write({ agent: 7 });
  expect(() => readBotConfig()).toThrow("config agent must be a non-empty string");
  // control beside the refusals: a real name passes
  write({ agent: "Autopilot" });
  expect(readBotConfig().agent).toBe("Autopilot");
});

test("a cli that is not a non-empty list of non-empty strings is refused", () => {
  for (const cli of [[], "bun x", [""], ["bun", 3]]) {
    write({ agent: "A", cli });
    expect(() => readBotConfig()).toThrow("config cli must be a non-empty list of strings");
  }
});

test("a relative db or automationDir is refused", () => {
  write({ agent: "A", db: "openbot.db" });
  expect(() => readBotConfig()).toThrow("config db must be an absolute path");
  write({ agent: "A", automationDir: "" });
  expect(() => readBotConfig()).toThrow("config automationDir must be an absolute path");
});

test("readBotConfig rejects a non-object and a missing file", () => {
  write("[1]");
  expect(() => readBotConfig()).toThrow("config must be a JSON object");
  write("{nope");
  expect(() => readBotConfig()).toThrow("config missing or not JSON");
  rmSync(join(dir, "config.json"));
  expect(() => readBotConfig()).toThrow("config missing or not JSON");
});
