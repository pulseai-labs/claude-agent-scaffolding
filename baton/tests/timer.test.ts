import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installTimer, removeTimer, unitText } from "../src/timer.ts";

const BIN = join(import.meta.dir, "..", "bin", "baton");
const tmp = () => mkdtempSync(join(tmpdir(), "baton-timer-"));
const lines = (s: string) => s.split("\n");

test("unit text pins the tick cadence and idle IO", () => {
  const { service, timer } = unitText("/h/.local/bin/baton");
  const sv = lines(service);
  for (const l of [
    "Type=oneshot",
    "ExecStart=/h/.local/bin/baton tick",
    "Nice=10",
    "IOSchedulingClass=idle",
    "Environment=PATH=%h/.local/bin:%h/.bun/bin:/usr/local/bin:/usr/bin:/bin",
  ]) expect(sv).toContain(l);
  const tm = lines(timer);
  for (const l of ["OnBootSec=2min", "OnUnitActiveSec=90s", "AccuracySec=10s", "WantedBy=timers.target"]) expect(tm).toContain(l);
  // control: a changed cadence is not the pinned text
  expect(lines(unitText("/x").timer)).not.toContain("OnUnitActiveSec=60s");
});

test("install writes both units to the given dir and enables the timer", async () => {
  const dir = tmp();
  const calls: string[][] = [];
  await installTimer("r1", { dir, batonPath: "/h/baton", run: (a) => (calls.push(a), { status: 0 }) });
  expect(readFileSync(join(dir, "baton.service"), "utf8")).toBe(unitText("/h/baton").service);
  expect(readFileSync(join(dir, "baton.timer"), "utf8")).toBe(unitText("/h/baton").timer);
  expect(calls).toEqual([["--user", "daemon-reload"], ["--user", "enable", "--now", "baton.timer"]]);
});

test("install surfaces a failing systemctl", async () => {
  await expect(installTimer("r1", { dir: tmp(), run: () => ({ status: 1, stderr: "boom" }) })).rejects.toThrow(/boom/);
});

test("remove disables the timer and deletes both units", async () => {
  const dir = tmp();
  const calls: string[][] = [];
  const run = (a: string[]) => (calls.push(a), { status: 0 });
  await installTimer("r1", { dir, run });
  calls.length = 0;
  await removeTimer({ dir, run });
  expect(existsSync(join(dir, "baton.timer"))).toBe(false);
  expect(existsSync(join(dir, "baton.service"))).toBe(false);
  expect(calls[0]).toEqual(["--user", "disable", "--now", "baton.timer"]);
});

function fakeSystemctl(): { path: string; log: string } {
  const d = tmp();
  const log = join(d, "calls.log");
  const path = join(d, "systemctl");
  writeFileSync(path, `#!/bin/sh\necho "$@" >> '${log}'\n`);
  chmodSync(path, 0o755);
  return { path, log };
}

async function baton(env: Record<string, string>, ...args: string[]) {
  const p = Bun.spawn([BIN, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const [out, err, rc] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, rc };
}

test("baton timer install and remove go through the overrides, never the real systemd", async () => {
  const dir = tmp();
  const fake = fakeSystemctl();
  const env = { BATON_SYSTEMD_DIR: dir, BATON_SYSTEMCTL: fake.path };
  expect((await baton(env, "timer", "install")).rc).toBe(0);
  expect(existsSync(join(dir, "baton.timer"))).toBe(true);
  expect(readFileSync(fake.log, "utf8").trim().split("\n")).toEqual(["--user daemon-reload", "--user enable --now baton.timer"]);
  expect((await baton(env, "timer", "remove")).rc).toBe(0);
  expect(existsSync(join(dir, "baton.timer"))).toBe(false);
  expect((await baton(env, "timer", "bogus")).rc).toBe(64);
});

test("baton arm installs the timer unless --no-timer", async () => {
  const fix = join(import.meta.dir, "fixtures", "recipes", "relay.json");
  const mk = async (extra: string[]) => {
    const dir = tmp();
    const fake = fakeSystemctl();
    const r = await baton(
      { BATON_SYSTEMD_DIR: dir, BATON_SYSTEMCTL: fake.path, BATON_STATE_DIR: tmp() },
      "arm", fix, "--run", "r1", "--param", "project=/p", "--param", "repo=o/r", ...extra,
    );
    return { r, installed: existsSync(join(dir, "baton.timer")) };
  };
  const on = await mk([]);
  expect(on.r.rc).toBe(0);
  expect(on.installed).toBe(true);
  expect((await mk(["--no-timer"])).installed).toBe(false);
});
