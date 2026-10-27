import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseScreen, screen, type Runner } from "./actions.ts";
import { readUnit } from "./baton-state.ts";
import { close, find, followUp, open, record, type DeliveryRec } from "./deliveries.ts";
import { parseKey } from "./notice.ts";
import { log } from "./log.ts";
import { blockedOffer, offerFor } from "./offer.ts";
import { OpenBotDown, OpenBotRefused, type Delivery, type OpenBot } from "./openbot.ts";
import { stateDir } from "./paths.ts";
import { listSpool, removeSpool } from "./spool.ts";
import { handleTap } from "./tap.ts";
import { askTask, draftTask, messageTask, parseDraft } from "./task.ts";

export class LockHeldError extends Error {
  constructor() {
    super("another serve holds the lock");
    this.name = "LockHeldError";
  }
}

export type ServeOptions = {
  bot: OpenBot;
  runner: Runner;
  now: () => Date;
  /** Bounds the number of loops; unset means run until killed. */
  stopAfter?: number;
  /** Wait between loops; default 5000. */
  pollMs?: number;
};

const lockPath = (): string => join(stateDir(), "serve.lock");

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

const logError = (what: string, e: unknown): void => log(`${what}: ${e instanceof Error ? e.message : "unknown error"}`);

const stopsDrain = (e: unknown): boolean => e instanceof OpenBotRefused || e instanceof OpenBotDown;

export async function serve(opts: ServeOptions): Promise<void> {
  const release = takeLock();
  process.on("exit", release);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    for (let loop = 0; opts.stopAfter === undefined || loop < opts.stopAfter; loop++) {
      if (loop > 0) await sleep(opts.pollMs ?? 5000);
      // Each step is caught alone, so a failing poll never stops the drain or the settle.
      try {
        await drain(opts);
      } catch (e) {
        logError("drain", e);
      }
      try {
        await poll(opts);
      } catch (e) {
        logError("poll", e);
      }
    }
  } finally {
    process.off("exit", release);
    release();
  }
}

// ---- drain -----------------------------------------------------------------------------------
// The spool in order, but only while no delivery is open: an unanswered OpenBot question blocks the
// agent's queue (spike ruling), so the bridge keeps one in flight. A refused or failed run stops the
// drain and keeps the file, so the notice goes later, in order.

async function drain(opts: ServeOptions): Promise<void> {
  for (const { path, item } of listSpool()) {
    if (open().length > 0) return;
    if (find(item.key)) {
      removeSpool(path); // asked once already: --id would return the same delivery anyway
      continue;
    }
    try {
      await deliver(item.key, item.message, opts);
    } catch (e) {
      if (!stopsDrain(e)) throw e;
      log(`drain stopped: ${(e as Error).message}`);
      return;
    }
    removeSpool(path);
  }
}

async function deliver(key: string, message: string, opts: ServeOptions): Promise<void> {
  const { bot } = opts;
  const n = parseKey(key);
  if (n.kind === "unit-park" && readUnit(n.run, n.unit)?.parked?.blocked) {
    return deliverBlocked(key, message, n.run, n.unit, n.at, opts);
  }
  const run = n.kind === "plain" ? "" : n.run;
  const offer = offerFor(n, message, run);
  if (!offer) {
    const { deliveryId } = await bot.run(messageTask(message), key);
    record({ key, phase: "asked", run, title: message.split("\n")[0]!.slice(0, 200), say: message, ask_id: deliveryId });
    return;
  }
  const { deliveryId } = await bot.run(askTask(offer), key);
  record({
    key, phase: "asked", run, title: offer.title, offer, ask_id: deliveryId,
    ...(n.kind === "unit-park" || n.kind === "unit-move" ? { unit: n.unit } : {}),
    ...(n.kind === "unit-park" ? { park_at: n.at } : {}),
  });
}

// A blocked park: `baton screen` gives the fresh screen and its picker (baton's parser, the same one
// its answer check uses). Park gone, or a newer park on screen: closed, nothing sent. A picker: the
// agent drafts first. No picker, or the screen cannot be read: asked at once with the escapes only.
async function deliverBlocked(key: string, message: string, run: string, unit: string, at: string, opts: ServeOptions): Promise<void> {
  const base = { key, run, unit, park_at: at, title: blockedOffer(message, run, unit, null, null).title };
  const res = await screen(run, unit, opts.runner);
  const shown = res.rc === 0 ? parseScreen(res.stdout) : null;
  if (res.rc === 2 || (shown && shown.park_at !== at)) {
    record({ ...base, phase: "closed", closed_at: opts.now().toISOString(), closed_by: "gone" });
    return;
  }
  if (shown?.picker) {
    const { deliveryId } = await opts.bot.run(draftTask(shown.screen, shown.picker), `${key}#draft`);
    record({ ...base, phase: "drafting", message, picker: shown.picker, draft_id: deliveryId });
    return;
  }
  const offer = blockedOffer(message, run, unit, null, null);
  const { deliveryId } = await opts.bot.run(askTask(offer), key);
  record({ ...base, phase: "asked", offer, ask_id: deliveryId });
}

// ---- poll ------------------------------------------------------------------------------------

async function statusOf(bot: OpenBot, id: string): Promise<Delivery> {
  try {
    return await bot.status(id);
  } catch (e) {
    if (e instanceof OpenBotRefused) return { state: "failed", turnId: null, text: null }; // OpenBot does not know it
    throw e;
  }
}

async function poll(opts: ServeOptions): Promise<void> {
  for (let rec of open()) {
    if (rec.phase === "drafting") {
      rec = await afterDraft(rec, opts);
      if (rec.phase === "drafting") continue;
    }
    if (!rec.ask_id) rec = await send(rec, opts);
    await afterAsk(rec, opts);
  }
}

// A follow-up opened unsent: its question or message goes now. OpenBot refusing leaves it for later.
async function send(rec: DeliveryRec, opts: ServeOptions): Promise<DeliveryRec> {
  const task = rec.offer ? askTask(rec.offer) : messageTask(rec.say ?? rec.title);
  const { deliveryId } = await opts.bot.run(task, rec.key);
  const sent: DeliveryRec = { ...rec, ask_id: deliveryId };
  record(sent);
  return sent;
}

async function afterDraft(rec: DeliveryRec, opts: ServeOptions): Promise<DeliveryRec> {
  const d = await statusOf(opts.bot, rec.draft_id ?? "");
  if (d.state === "queued" || d.state === "running") return rec;
  const picker = rec.picker ?? null;
  const draft = d.state === "completed" && d.text !== null && picker ? parseDraft(d.text, picker) : null;
  const offer = blockedOffer(rec.message ?? rec.title, rec.run, rec.unit ?? "", picker, draft);
  const asked: DeliveryRec = { ...rec, phase: "asked", offer };
  delete asked.ask_id;
  record(asked);
  return send(asked, opts);
}

async function afterAsk(rec: DeliveryRec, opts: ServeOptions): Promise<void> {
  const d = await statusOf(opts.bot, rec.ask_id ?? "");
  const ended = d.state === "completed" || d.state === "failed";
  if (!rec.offer) {
    if (ended) close(rec, "sent", opts.now());
    return;
  }
  if (d.turnId) {
    const r = await opts.bot.resolved(d.turnId);
    if (r === "unreadable") {
      log(`${rec.key}: the answer in openbot.db is unreadable; nothing ran`);
      const closed = close(rec, "gone", opts.now());
      followUp(closed, { say: `${rec.title}: your answer could not be read, so nothing ran. Act in the Orca terminal or with baton.` });
      return;
    }
    if (r !== "none") {
      await handleTap(rec, r.answer, { bot: opts.bot, runner: opts.runner, now: opts.now });
      return;
    }
  }
  if (ended) {
    log(`${rec.key}: the question ended with no answer; nothing ran`);
    close(rec, "gone", opts.now());
  }
}
