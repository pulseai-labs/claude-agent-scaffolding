import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spoolNotice } from "../src/spool.ts";

const BIN = join(import.meta.dir, "..", "bin", "bot-on-telegram");
const TOKEN = "123456:FIXTURE-TOKEN-do-not-leak";
let dir: string;
let cfg: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bot-status-"));
  cfg = join(dir, "cfg");
  mkdirSync(cfg);
  writeFileSync(join(cfg, "token"), TOKEN, { mode: 0o600 });
  writeFileSync(join(cfg, "config.json"), JSON.stringify({ chat_id: 42 }));
  const ctl = join(dir, "ctl");
  writeFileSync(ctl, "#!/bin/sh\necho active\n");
  chmodSync(ctl, 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const status = (batonConfig?: unknown) => {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    BOT_ON_TELEGRAM_CONFIG_DIR: cfg,
    BOT_ON_TELEGRAM_STATE_DIR: join(dir, "state"),
    BOT_ON_TELEGRAM_SYSTEMCTL: join(dir, "ctl"),
    BATON_CONFIG: join(dir, "baton.json"),
  };
  if (batonConfig !== undefined) writeFileSync(join(dir, "baton.json"), JSON.stringify(batonConfig));
  const p = Bun.spawnSync([BIN, "status"], { env });
  return { rc: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

test("status reports token mode (never the token), chat, service, spool", () => {
  process.env.BOT_ON_TELEGRAM_STATE_DIR = join(dir, "state");
  spoolNotice("k", "m");
  spoolNotice("k2", "m2");
  delete process.env.BOT_ON_TELEGRAM_STATE_DIR;
  const r = status();
  expect(r.rc).toBe(0);
  expect(r.out).toContain("token: present, mode 600");
  expect(r.out).not.toContain(TOKEN);
  expect(r.err).not.toContain(TOKEN);
  expect(r.out).toContain("chat_id: 42");
  expect(r.out).toContain("service: active");
  expect(r.out).toContain("spool: 2");
});

test("a token that is not mode 600, or missing, is reported, not hidden", () => {
  chmodSync(join(cfg, "token"), 0o644);
  expect(status().out).toContain("token: present, mode 644 (must be 600)");
  rmSync(join(cfg, "token"));
  expect(status().out).toContain("token: MISSING");
});

test("baton notify: MISSING when argv[0] does not exist, resolves when it does, unset otherwise", () => {
  expect(status({ notify: [join(dir, "nope"), "notify", "{key}", "{message}"] }).out).toContain(`baton notify: ${join(dir, "nope")} MISSING`);
  expect(status({ notify: [join(dir, "ctl"), "x"] }).out).toContain(`baton notify: ${join(dir, "ctl")} resolves`);
  expect(status({ notify: ["sh", "-c", "x"] }).out).toContain("baton notify: sh resolves");
  expect(status({ slots: {} }).out).toContain("baton notify: unset");
  rmSync(join(dir, "baton.json"));
  expect(status().out).toContain("baton notify: unset");
});
