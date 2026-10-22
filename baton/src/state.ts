// Run state: the on-disk layout, the run lock, atomic run.json writes, the event log.
// Layout under the state dir: runs/<id>/{recipe.json,run.json,events.jsonl}, claims/, lock.

import {
  appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync,
  readFileSync, renameSync, unlinkSync, writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Session = {
  nonce: string;
  claim_nonce: string;
  launch_dir: string;
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

export function openStore(dir: string = stateDir()): Store {
  const lockPath = join(dir, "lock");
  const runDir = (id: string) => join(dir, "runs", id);

  function tryCreateLock(): boolean {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw e;
    }
  }

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
      if (!tryCreateLock()) {
        let text = "";
        let taken = false;
        try {
          text = readFileSync(lockPath, "utf8").trim();
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          // The holder released between our open and our read: take it once, else busy.
          if (!tryCreateLock()) return "busy";
          taken = true;
        }
        if (!taken) {
          // An empty or unparseable pid is a holder mid-write, not a dead one: busy.
          if (!/^[0-9]+$/.test(text) || pidAlive(Number.parseInt(text, 10))) return "busy";
          // Stale: the holder is dead. Remove and retry once; losing the race means busy.
          try { unlinkSync(lockPath); } catch { /* another taker removed it */ }
          if (!tryCreateLock()) return "busy";
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
      const fd = openSync(tmp, "w", 0o600);
      try {
        writeSync(fd, JSON.stringify(run, null, 2) + "\n");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, join(d, "run.json"));
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
