import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Runner } from "./actions.ts";
import { stateDir } from "./paths.ts";
import { handleUpdate, type Update } from "./press.ts";
import { drainSpool } from "./send.ts";
import type { Api } from "./telegram.ts";

export class LockHeldError extends Error {
  constructor() {
    super("another serve holds the lock");
    this.name = "LockHeldError";
  }
}

export type ServeOptions = {
  api: Api;
  chatId: number;
  runner: Runner;
  now: () => Date;
  /** Bounds the number of loops; unset means run until killed. */
  stopAfter?: number;
  /** Wait after an error; default 5000. */
  backoffMs?: number;
};

const lockPath = (): string => join(stateDir(), "serve.lock");
const offsetPath = (): string => join(stateDir(), "offset");

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

// O_EXCL with our pid. A lock whose pid is gone (or unreadable) is replaced.
function takeLock(): () => void {
  mkdirSync(stateDir(), { recursive: true });
  const path = lockPath();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try {
          if (readFileSync(path, "utf8").trim() === String(process.pid)) rmSync(path, { force: true });
        } catch {
          // already gone
        }
      };
      return release;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) throw new LockHeldError();
      rmSync(path, { force: true }); // stale
    }
  }
  throw new LockHeldError();
}

function readOffset(): number {
  try {
    const n = Number.parseInt(readFileSync(offsetPath(), "utf8").trim(), 10);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeOffset(n: number): void {
  const tmp = `${offsetPath()}.tmp`;
  writeFileSync(tmp, String(n));
  renameSync(tmp, offsetPath());
}

const logError = (what: string, e: unknown): void => {
  const msg = e instanceof Error ? e.message : "unknown error";
  process.stderr.write(`bot-on-telegram: ${what}: ${msg.split("\n")[0]}\n`);
};

export async function serve(opts: ServeOptions): Promise<void> {
  const release = takeLock();
  process.on("exit", release);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    let offset = readOffset();
    for (let loop = 0; opts.stopAfter === undefined || loop < opts.stopAfter; loop++) {
      try {
        await drainSpool(opts.api, opts.chatId, opts.now);
        const updates = await opts.api.call<Update[]>("getUpdates", {
          offset,
          timeout: 25,
          allowed_updates: ["callback_query", "message"],
        });
        // One at a time; the offset moves past each update whether or not its handling threw,
        // so a failing update is never run twice (handleUpdate spends a button before it acts).
        for (const u of updates) {
          try {
            await handleUpdate(u, { api: opts.api, chatId: opts.chatId, runner: opts.runner, now: opts.now });
          } catch (e) {
            logError(`update ${u.update_id}`, e);
          }
          offset = u.update_id + 1;
          writeOffset(offset);
        }
      } catch (e) {
        logError("serve", e);
        await sleep(opts.backoffMs ?? 5000);
      }
    }
  } finally {
    process.off("exit", release);
    release();
  }
}
