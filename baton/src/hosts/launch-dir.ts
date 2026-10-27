// The launch directory a host binds before it launches a session: the project's root itself, or a
// per-launch git worktree under `<state>/launch`. Shared by every host so the refusals match.

import { existsSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { LaunchError } from "../host.ts";
import { stateDir } from "../state.ts";

/** realpath when the path exists, else the resolved path. */
export function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

export function git(cwd: string, ...args: string[]): { ok: boolean; out: string; err: string } {
  const p = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
}

/** The per-launch worktree parent: `<state>/launch`. */
function launchRoot(): string {
  return join(stateDir(), "launch");
}

/** True when `dir` is under the per-launch worktree parent, so bind made it. */
export function isLaunchDir(dir: string): boolean {
  const root = real(launchRoot());
  return real(dir).startsWith(root + sep);
}

/**
 * The directory a session launches in. `root` is the project's root path. A cwd other than the
 * root, or `root` mode, is returned as given; `worktree` mode makes (or reuses) a detached
 * worktree of `root` named for the nonce.
 */
export function bindLaunchDir(root: string, cwd: string, nonce: string, mode: "worktree" | "root"): string {
  if (real(cwd) !== real(root)) return cwd;
  if (mode === "root") return cwd;
  // encodeURIComponent is injective and keeps the name readable: "/" becomes "%2F", and "_",
  // which every nonce segment may contain, is left alone - flattening "/" to "_" was not.
  const dir = join(launchRoot(), encodeURIComponent(nonce));
  const listed = () => git(root, "worktree", "list", "--porcelain").out.split("\n").includes(`worktree ${real(dir)}`);
  if (existsSync(dir)) {
    if (listed()) return dir;
    throw new LaunchError(`launch directory exists but is not a worktree of ${root}: ${dir}`);
  }
  const r = git(root, "worktree", "add", "--detach", dir, "HEAD");
  if (!r.ok) throw new LaunchError(`git worktree add failed: ${r.err}`);
  return dir;
}

/** Remove a launch directory bind made. Refuses any other directory. */
export function releaseLaunchDir(cwd: string, dir: string): void {
  if (real(dir) === real(cwd)) return;
  // Only a directory bind made is ever force-removed.
  if (!isLaunchDir(dir)) throw new LaunchError(`refusing to remove a directory bind did not make: ${dir}`);
  // --force also drops the registration of a worktree whose directory is already gone.
  const r = git(cwd, "worktree", "remove", "--force", dir);
  if (!r.ok) throw new LaunchError(`git worktree remove failed: ${r.err}`);
}
