// The systemd user timer that runs `baton tick`. `batonPath` is the installed symlink
// (`~/.local/bin/baton`), never a versioned cache path, so a plugin update needs no reinstall.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Runner = (argv: string[]) => { status: number; stderr?: string };

export type TimerOptions = {
  /** Where the unit files go; default `$BATON_SYSTEMD_DIR` or `~/.config/systemd/user`. */
  dir?: string;
  batonPath?: string;
  /** Runs `systemctl`; default spawns `$BATON_SYSTEMCTL` or `systemctl`. */
  run?: Runner;
};

export function unitText(batonPath: string): { service: string; timer: string } {
  const service = [
    "[Unit]",
    "Description=baton tick",
    "",
    "[Service]",
    "Type=oneshot",
    `ExecStart=${batonPath} tick`,
    "Nice=10",
    "IOSchedulingClass=idle",
    "Environment=PATH=%h/.local/bin:%h/.bun/bin:/usr/local/bin:/usr/bin:/bin",
    "",
  ].join("\n");
  const timer = [
    "[Unit]",
    "Description=baton tick timer",
    "",
    "[Timer]",
    "OnBootSec=2min",
    "OnUnitActiveSec=90s",
    "AccuracySec=10s",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
  return { service, timer };
}

const defaultDir = () => process.env.BATON_SYSTEMD_DIR || join(homedir(), ".config", "systemd", "user");

const defaultRun: Runner = (argv) => {
  const bin = process.env.BATON_SYSTEMCTL || "systemctl";
  const p = Bun.spawnSync([bin, ...argv], { stdout: "ignore", stderr: "pipe" });
  return { status: p.exitCode ?? 1, stderr: p.stderr.toString() };
};

function systemctl(run: Runner, ...args: string[]): void {
  const r = run(["--user", ...args]);
  if (r.status !== 0) throw new Error(`systemctl --user ${args.join(" ")} failed (${r.status})${r.stderr ? `: ${r.stderr.trim()}` : ""}`);
}

export async function installTimer(_runId: string, opts: TimerOptions = {}): Promise<void> {
  const dir = opts.dir ?? defaultDir();
  const run = opts.run ?? defaultRun;
  const { service, timer } = unitText(opts.batonPath ?? join(homedir(), ".local", "bin", "baton"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "baton.service"), service);
  writeFileSync(join(dir, "baton.timer"), timer);
  systemctl(run, "daemon-reload");
  systemctl(run, "enable", "--now", "baton.timer");
}

export async function removeTimer(opts: TimerOptions = {}): Promise<void> {
  const dir = opts.dir ?? defaultDir();
  const run = opts.run ?? defaultRun;
  systemctl(run, "disable", "--now", "baton.timer");
  rmSync(join(dir, "baton.timer"), { force: true });
  rmSync(join(dir, "baton.service"), { force: true });
  systemctl(run, "daemon-reload");
}
