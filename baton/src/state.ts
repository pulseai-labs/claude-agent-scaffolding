// Run state: the on-disk layout, the run lock, atomic run.json writes, the event log.
// Layout under the state dir: runs/<id>/{recipe.json,run.json,events.jsonl}, claims/, lock.

import {
  appendFileSync, closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readdirSync,
  readFileSync, renameSync, unlinkSync, writeFileSync, writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export type Session = {
  nonce: string;
  claim_nonce: string;
  launch_dir: string;
  /** The project and cwd the stage rendered at launch; absent in older state (re-rendered then). */
  project?: string;
  cwd?: string;
  /** The unit's vars at launch; a successor inherits them. Absent in older state (u.vars then). */
  vars?: Record<string, string>;
  thread_id?: string;
  claim_key: string;
  launched_at: string;
  last_progress_at: string;
  progress_mark: string;
  successor_of?: string;
};

export type UnitState = {
  id: string;
  group: number;
  order: number;
  vars: Record<string, string>;
  stage: string;
  record_seen?: string;
  record_at_entry?: string;
  launches: Record<string, number>;
  /** Nonces minted per stage: every launch, successor and dropped orphan; never reset. */
  seq?: Record<string, number>;
  stalls: number;
  session?: Session;
  parked?: { reason: string; at: string };
  quiet_since?: string;
  /** The claim nonce last reported holding this unit's cwd, so `cwd busy` is logged once. */
  cwd_busy?: string;
  /** Consecutive failed `merge` calls in the current merge stage; three park the unit. */
  merge_failures?: number;
  /** Consecutive failed forge reads (PR view, PR-URL argv, landed check); three park the unit. */
  forge_failures?: number;
};

export type RunState = {
  id: string;
  dir: string;
  recipe_sha256: string;
  params: Record<string, string>;
  armed_at: string;
  status: "armed" | "parked" | "disarmed" | "done";
  parked?: { reason: string; at: string };
  units: Record<string, UnitState>;
};

export type Store = {
  dir: string;
  runDir(id: string): string;
  withLock<T>(fn: () => Promise<T>): Promise<T | "busy">;
  readRun(id: string): RunState;
  writeRun(run: RunState): void;
  event(runId: string, obj: Record<string, unknown>): void;
  listRuns(): string[];
};

/**
 * Write all of `data` to `fd`. writeSync may write fewer bytes than asked without throwing (a
 * file-size limit, a full disk): loop until the whole buffer is out, and treat a zero-byte write
 * as an error rather than spin.
 */
export function writeAllSync(fd: number, data: string): void {
  const buf = Buffer.from(data, "utf8");
  let off = 0;
  while (off < buf.length) {
    const n = writeSync(fd, buf, off, buf.length - off);
    if (n <= 0) throw new Error(`short write: ${off} of ${buf.length} bytes`);
    off += n;
  }
}

/** Write `data` to `tmp`, fsync, rename over `path`; on any failure the temp file is removed. */
export function replaceFileSync(tmp: string, path: string, data: string): void {
  try {
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeAllSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* never created, or already gone */ }
    throw e;
  }
}

export function stateDir(): string {
  return process.env.BATON_STATE_DIR || join(homedir(), ".local", "state", "baton");
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Create the lock with our pid already in it: the pid goes into a unique temp file in the same
 * directory, which is then hard-linked to the lock path. link never replaces, so EEXIST means
 * held, and the lock can never exist empty or half-written.
 */
function tryCreateLock(lockPath: string): boolean {
  const temp = `${lockPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temp, String(process.pid), { mode: 0o600, flag: "wx" });
  try {
    linkSync(temp, lockPath);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  } finally {
    try { unlinkSync(temp); } catch { /* already gone */ }
  }
}

/**
 * Break a lock judged stale (its pid `judged` is dead) and take it, exclusively. The breaker of
 * pid P first hard-links the lock to `lock.stale.<P>`: link never replaces, so only one taker
 * breaks P at a time, and the rest read busy. Holding that marker, it re-reads the lock through
 * it and goes on only if the content is still P - a lock re-taken since the judgment belongs to
 * a live holder, and is left untouched. Exported for the two-taker race test.
 *
 * Known limit: a breaker killed while holding the marker leaves `lock.stale.<P>` behind, and a
 * lock still holding P then reads busy until the marker is removed by hand. That is the stop
 * direction - no second tick ever enters.
 */
export function breakStaleLock(lockPath: string, judged: string): boolean {
  const marker = `${lockPath}.stale.${judged}`;
  try {
    linkSync(lockPath, marker);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOENT") return false; // another breaker, or the lock is gone
    throw e;
  }
  try {
    let now = "";
    try { now = readFileSync(marker, "utf8").trim(); } catch { return false; }
    if (now !== judged) return false; // re-taken since we judged it: a live holder's lock
    try { unlinkSync(lockPath); } catch { /* nobody else breaks P while we hold the marker */ }
    return tryCreateLock(lockPath);
  } finally {
    try { unlinkSync(marker); } catch { /* already gone */ }
  }
}

export function openStore(dir: string = stateDir()): Store {
  const lockPath = join(dir, "lock");
  const runDir = (id: string) => join(dir, "runs", id);

  function ownsLock(): boolean {
    try {
      return readFileSync(lockPath, "utf8").trim() === String(process.pid);
    } catch {
      return false;
    }
  }

  return {
    dir,
    runDir,
    async withLock<T>(fn: () => Promise<T>): Promise<T | "busy"> {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (!tryCreateLock(lockPath)) {
        let text = "";
        let taken = false;
        try {
          text = readFileSync(lockPath, "utf8").trim();
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          // The holder released between our open and our read: take it once, else busy.
          if (!tryCreateLock(lockPath)) return "busy";
          taken = true;
        }
        if (!taken) {
          // This code never writes an empty or unparseable lock; one left by an older writer is
          // not proof of a dead holder: busy.
          if (!/^[0-9]+$/.test(text) || pidAlive(Number.parseInt(text, 10))) return "busy";
          // Stale: the holder is dead. Break it exclusively; losing to another taker means busy.
          if (!breakStaleLock(lockPath, text)) return "busy";
        }
      }
      try {
        return await fn();
      } finally {
        // Release only a lock that still holds our pid; another process may have taken it over.
        if (ownsLock()) {
          try { unlinkSync(lockPath); } catch { /* already gone */ }
        }
      }
    },
    readRun(id: string): RunState {
      return JSON.parse(readFileSync(join(runDir(id), "run.json"), "utf8")) as RunState;
    },
    writeRun(run: RunState): void {
      const d = runDir(run.id);
      mkdirSync(d, { recursive: true, mode: 0o700 });
      const tmp = join(d, `run.json.${process.pid}.tmp`);
      replaceFileSync(tmp, join(d, "run.json"), JSON.stringify(run, null, 2) + "\n");
    },
    event(runId: string, obj: Record<string, unknown>): void {
      const d = runDir(runId);
      mkdirSync(d, { recursive: true, mode: 0o700 });
      appendFileSync(join(d, "events.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...obj }) + "\n", { mode: 0o600 });
    },
    listRuns(): string[] {
      const d = join(dir, "runs");
      if (!existsSync(d)) return [];
      return readdirSync(d).filter((n) => existsSync(join(d, n, "run.json"))).sort();
    },
  };
}
