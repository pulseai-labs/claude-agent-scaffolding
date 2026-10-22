// Claim files: a per-directory environment overlay a launcher reads at start-up. The
// claim is keyed by the sha256 of the directory's real path; its first line is a header
// `# baton <nonce>` that names the launch that owns it. The header nonce is written once
// per stage visit and never changes: a successor launch reuses the claim untouched and
// every removal passes the session's recorded claim nonce.

import { createHash } from "node:crypto";
import {
  chmodSync, mkdirSync, readFileSync, realpathSync, unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENV_DENYLIST, ENV_KEY_RE } from "./recipe.ts";
import { replaceFileSync, stateDir } from "./state.ts";

export class ClaimBusy extends Error {
  constructor(key: string, held: string) {
    super(`claim ${key} is held by ${held}`);
    this.name = "ClaimBusy";
  }
}

const HEADER = "# baton ";

export function claimKey(cwd: string): string {
  return createHash("sha256").update(realpathSync(cwd)).digest("hex");
}

export function claimPath(key: string): string {
  return join(stateDir(), "claims", `${key}.env`);
}

function headerNonce(path: string): string | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const first = text.split("\n", 1)[0];
  return first.startsWith(HEADER) ? first.slice(HEADER.length) : null;
}

/** The nonce of the live claim for `key`, or null when there is none. */
export function liveClaim(key: string): string | null {
  return headerNonce(claimPath(key));
}

export function writeClaim(cwd: string, env: Record<string, string>, nonce: string): string {
  const real = realpathSync(cwd);
  if (real === realpathSync(process.env.HOME || homedir())) throw new Error("refusing a claim on the home directory");
  if (nonce === "" || /[\n\0]/.test(nonce)) throw new Error("bad claim nonce");
  for (const [k, v] of Object.entries(env)) {
    if (!ENV_KEY_RE.test(k) || ENV_DENYLIST.includes(k)) throw new Error(`denied claim key: ${k}`);
    if (/[\n\0]/.test(v)) throw new Error(`claim value for ${k} contains a newline or NUL`);
  }
  const key = claimKey(real);
  const held = liveClaim(key);
  if (held !== null && held !== nonce) throw new ClaimBusy(key, held);

  const dir = join(stateDir(), "claims");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const path = claimPath(key);
  const tmp = `${path}.${process.pid}.tmp`;
  const body = [`${HEADER}${nonce}`, ...Object.entries(env).map(([k, v]) => `${k}=${v}`)].join("\n") + "\n";
  replaceFileSync(tmp, path, body);
  return key;
}

/** Remove the claim for `key` only when its header nonce is `claimNonce`. */
export function removeClaim(key: string, claimNonce: string): boolean {
  if (headerNonce(claimPath(key)) !== claimNonce) return false;
  try {
    unlinkSync(claimPath(key));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return true;
}
