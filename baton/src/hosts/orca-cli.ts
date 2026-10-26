// The one place baton runs the `orca` CLI: argv in, one parsed `--json` envelope out.

import { HostDownError } from "../host.ts";

export type OrcaReply = { ok: true; result: any } | { ok: false; code: string; message: string };

const TIMEOUT_MS = 30_000;

/**
 * Run `<cli> <args> --json` with no shell. The envelope decides, never the exit code: Orca exits 1
 * on an error reply, which is still a reply. A spawn failure, a timeout, or stdout that is not one
 * envelope throws HostDownError.
 */
export function runOrca(cli: string, args: string[], timeoutMs: number = TIMEOUT_MS): OrcaReply {
  let out: string;
  try {
    const p = Bun.spawnSync([cli, ...args, "--json"], { stdout: "pipe", stderr: "pipe", stdin: "ignore", env: process.env, timeout: timeoutMs, killSignal: "SIGKILL" });
    out = p.stdout.toString();
  } catch (e) {
    throw new HostDownError(`orca ${args.slice(0, 2).join(" ")}: ${(e as Error).message}`);
  }
  let env: any;
  try {
    env = JSON.parse(out);
  } catch {
    throw new HostDownError(`orca ${args.slice(0, 2).join(" ")}: no JSON reply (failed, timed out, or not an Orca CLI)`);
  }
  if (env !== null && typeof env === "object" && env.ok === true) return { ok: true, result: env.result };
  if (env !== null && typeof env === "object" && env.ok === false && typeof env.error?.code === "string") {
    return { ok: false, code: env.error.code, message: String(env.error.message ?? env.error.code) };
  }
  throw new HostDownError(`orca ${args.slice(0, 2).join(" ")}: reply is not an Orca envelope`);
}
