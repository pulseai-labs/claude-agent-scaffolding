import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installService, removeService, unitText } from "../src/service.ts";

const BIN = join(import.meta.dir, "..", "bin", "bot-on-telegram");
let dir: string;
const KEYS = ["BATON_STATE_DIR", "BATON_CONFIG", "BOT_ON_TELEGRAM_CONFIG_DIR", "BOT_ON_TELEGRAM_STATE_DIR"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bot-svc-"));
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(dir, { recursive: true, force: true });
});
const lines = (s: string) => s.split("\n");

test("unit text: serve, always restarted, wanted by default.target", () => {
  const t = lines(unitText("/x/bot-on-telegram", {}));
  expect(t).toContain("Type=simple");
  expect(t).toContain("ExecStart=/x/bot-on-telegram serve");
  expect(t).toContain("Restart=always");
  expect(t).toContain("RestartSec=10");
  expect(t).toContain("Environment=PATH=%h/.local/bin:%h/.bun/bin:/usr/local/bin:/usr/bin:/bin");
  expect(t).toContain("[Install]");
  expect(t).toContain("WantedBy=default.target");
  expect(t.filter((l) => l.startsWith('Environment="'))).toEqual([]);
});

test("a set location is carried, quoted; % doubled, \" and \\ escaped; a line break refused", () => {
  const t = lines(unitText("/x/b", { BATON_STATE_DIR: '/s p/a"b\\c%d', BOT_ON_TELEGRAM_CONFIG_DIR: "/c" }));
  expect(t.filter((l) => l.startsWith('Environment="'))).toEqual([
    'Environment="BATON_STATE_DIR=/s p/a\\"b\\\\c%%d"',
    'Environment="BOT_ON_TELEGRAM_CONFIG_DIR=/c"',
  ]);
  expect(() => unitText("/x/b", { BATON_CONFIG: "/a\nExecStartPost=/bin/x" })).toThrow(/line break/);
});

test("install writes the unit with the set locations (made absolute) and enables it", async () => {
  process.env.BATON_STATE_DIR = "/st ate";
  process.env.BATON_CONFIG = ""; // empty reads as unset
  const calls: string[][] = [];
  await installService({ dir, binPath: "/x/bot-on-telegram", run: (a) => (calls.push(a), { status: 0 }) });
  const text = readFileSync(join(dir, "bot-on-telegram.service"), "utf8");
  expect(text).toContain("ExecStart=/x/bot-on-telegram serve");
  expect(text).toContain('Environment="BATON_STATE_DIR=/st ate"');
  expect(text).not.toContain("BATON_CONFIG");
  expect(calls).toEqual([["--user", "daemon-reload"], ["--user", "enable", "--now", "bot-on-telegram.service"]]);
});

test("remove disables, deletes the unit and reloads", async () => {
  writeFileSync(join(dir, "bot-on-telegram.service"), "x");
  const calls: string[][] = [];
  await removeService({ dir, run: (a) => (calls.push(a), { status: 0 }) });
  expect(existsSync(join(dir, "bot-on-telegram.service"))).toBe(false);
  expect(calls).toEqual([["--user", "disable", "--now", "bot-on-telegram.service"], ["--user", "daemon-reload"]]);
});

test("remove before install (no unit file) skips disable and succeeds; a second remove does too", async () => {
  const calls: string[][] = [];
  // A real systemctl refuses to disable a unit that has no file; this fake does the same.
  const run = (a: string[]) => (calls.push(a), { status: a[1] === "disable" ? 1 : 0, stderr: "Unit file does not exist" });
  await removeService({ dir, run });
  await removeService({ dir, run });
  expect(calls).toEqual([["--user", "daemon-reload"], ["--user", "daemon-reload"]]);
});

test("the CLI's service remove before any install exits 0", () => {
  const log = join(dir, "log");
  const fakeCtl = join(dir, "ctl");
  writeFileSync(fakeCtl, `#!/bin/sh
echo "$@" >> ${log}
case "$2" in disable) exit 1;; esac
`);
  chmodSync(fakeCtl, 0o755);
  const env = { ...process.env, BOT_ON_TELEGRAM_SYSTEMCTL: fakeCtl, BOT_ON_TELEGRAM_SYSTEMD_DIR: join(dir, "units") };
  const p = Bun.spawnSync([BIN, "service", "remove"], { env });
  expect(p.exitCode).toBe(0);
  expect(readFileSync(log, "utf8")).toBe("--user daemon-reload\n");
});

test("a failing systemctl is an error naming the command", async () => {
  await expect(installService({ dir, binPath: "/x/b", run: () => ({ status: 1, stderr: "boom" }) })).rejects.toThrow(/systemctl --user daemon-reload failed \(1\): boom/);
});

test("the CLI installs through the $BOT_ON_TELEGRAM_SYSTEMCTL and _SYSTEMD_DIR overrides, never the real systemctl", () => {
  const log = join(dir, "log");
  const fakeCtl = join(dir, "ctl");
  writeFileSync(fakeCtl, `#!/bin/sh\necho "$@" >> ${log}\n`);
  chmodSync(fakeCtl, 0o755);
  const env = { ...process.env, BOT_ON_TELEGRAM_SYSTEMCTL: fakeCtl, BOT_ON_TELEGRAM_SYSTEMD_DIR: join(dir, "units") };
  let p = Bun.spawnSync([BIN, "service", "install"], { env });
  expect(p.exitCode).toBe(0);
  expect(readFileSync(join(dir, "units", "bot-on-telegram.service"), "utf8")).toContain("ExecStart=");
  expect(readFileSync(log, "utf8")).toContain("--user enable --now bot-on-telegram.service");
  p = Bun.spawnSync([BIN, "service", "remove"], { env });
  expect(p.exitCode).toBe(0);
  expect(existsSync(join(dir, "units", "bot-on-telegram.service"))).toBe(false);
  expect(Bun.spawnSync([BIN, "service", "bogus"], { env }).exitCode).toBe(64);
});
