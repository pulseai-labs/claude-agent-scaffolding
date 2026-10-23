// The systemd user service that runs `bot-on-telegram serve`. `binPath` is the installed symlink
// (`~/.local/bin/bot-on-telegram`), never a versioned cache path, so a plugin update needs no reinstall.
// The idea is baton's timer.ts; it is copied, not imported, across plugins.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type Runner = (argv: string[]) => { status: number; stdout?: string; stderr?: string };

export type ServiceOptions = {
  /** Where the unit goes; default `$BOT_ON_TELEGRAM_SYSTEMD_DIR` or `~/.config/systemd/user`. */
  dir?: string;
  binPath?: string;
  /** Runs `systemctl`; default spawns `$BOT_ON_TELEGRAM_SYSTEMCTL` or `systemctl`. */
  run?: Runner;
};

export const UNIT_NAME = "bot-on-telegram.service";

/** The locations the service reads; each one set at install time is carried into the unit. */
export const UNIT_ENV = ["BATON_STATE_DIR", "BATON_CONFIG", "BOT_ON_TELEGRAM_CONFIG_DIR", "BOT_ON_TELEGRAM_STATE_DIR"] as const;
export type UnitEnv = Partial<Record<(typeof UNIT_ENV)[number], string>>;

/** A systemd `Environment=` line, quoted: `\` and `"` escaped, `%` doubled (else a specifier). */
export function envLine(name: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`${name} holds a line break, which a systemd unit cannot carry`);
  return `Environment="${`${name}=${value}`.replace(/[\\"]/g, (c) => `\\${c}`).replace(/%/g, "%%")}"`;
}

export function unitText(binPath: string, env: UnitEnv = {}): string {
  return [
    "[Unit]",
    "Description=bot-on-telegram: baton notices and buttons over Telegram",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${binPath} serve`,
    "Restart=always",
    "RestartSec=10",
    "Environment=PATH=%h/.local/bin:%h/.bun/bin:/usr/local/bin:/usr/bin:/bin",
    ...UNIT_ENV.flatMap((k) => (env[k] ? [envLine(k, env[k]!)] : [])),
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

const defaultDir = (): string => process.env.BOT_ON_TELEGRAM_SYSTEMD_DIR || join(homedir(), ".config", "systemd", "user");

export const defaultRun: Runner = (argv) => {
  const bin = process.env.BOT_ON_TELEGRAM_SYSTEMCTL || "systemctl";
  const p = Bun.spawnSync([bin, ...argv], { stdout: "pipe", stderr: "pipe" });
  return { status: p.exitCode ?? 1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
};

function systemctl(run: Runner, ...args: string[]): void {
  const r = run(["--user", ...args]);
  if (r.status !== 0) throw new Error(`systemctl --user ${args.join(" ")} failed (${r.status})${r.stderr ? `: ${r.stderr.trim()}` : ""}`);
}

export async function installService(opts: ServiceOptions = {}): Promise<void> {
  const dir = opts.dir ?? defaultDir();
  const run = opts.run ?? defaultRun;
  // An empty value reads as unset; a relative one is made absolute here, where it means what the operator meant.
  const env: UnitEnv = {};
  for (const k of UNIT_ENV) if (process.env[k]) env[k] = resolve(process.env[k]!);
  const text = unitText(opts.binPath ?? join(homedir(), ".local", "bin", "bot-on-telegram"), env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, UNIT_NAME), text);
  systemctl(run, "daemon-reload");
  systemctl(run, "enable", "--now", UNIT_NAME);
}

export async function removeService(opts: ServiceOptions = {}): Promise<void> {
  const dir = opts.dir ?? defaultDir();
  const run = opts.run ?? defaultRun;
  systemctl(run, "disable", "--now", UNIT_NAME);
  rmSync(join(dir, UNIT_NAME), { force: true });
  systemctl(run, "daemon-reload");
}

/** `systemctl --user is-active`, as one word; a missing systemctl reads as `unknown`. */
export function serviceState(run: Runner = defaultRun): string {
  try {
    return run(["--user", "is-active", UNIT_NAME]).stdout?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}
