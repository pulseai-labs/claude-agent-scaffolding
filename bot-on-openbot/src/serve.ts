import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseScreen, screen, type Runner } from "./actions.ts";
import { readUnit } from "./baton-state.ts";
import { agentOf, close, find, followUp, open, record, type DeliveryRec } from "./deliveries.ts";
import { parseKey, type Notice } from "./notice.ts";
import { log } from "./log.ts";
import { blockedOffer, offerFor } from "./offer.ts";
import { OpenBotDown, OpenBotRefused, type Delivery, type OpenBot, type Prompt } from "./openbot.ts";
import { stateDir } from "./paths.ts";
import type { Route } from "./route.ts";
import { ours, SETTLED_LABEL, stillOpen, sweepSettled, wellFormed } from "./settle.ts";
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
  /** The client of one OpenBot agent. */
  botFor: (agent: string) => OpenBot;
  /** The agent a notice goes to; rejects with OpenBotDown when that cannot be told yet. */
  route: (n: Notice) => Promise<Route>;
  /** The agent of a record that names none (written by 0.1.x). */
  defaultAgent: string;
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
      try {
        await sweepSettled(opts.botFor, opts.defaultAgent, opts.now());
      } catch (e) {
        logError("settle", e);
      }
    }
  } finally {
    process.off("exit", release);
    release();
  }
}

// ---- drain -----------------------------------------------------------------------------------
// The spool in order, each notice to its agent, but only while that agent has no delivery open: an
// unanswered OpenBot question blocks the agent's queue (spike ruling), so the bridge keeps one in
// flight per agent. A notice whose agent is busy stays spooled and the drain goes on to later ones,
// so the order holds within each agent. A refused or failed run holds its agent for this loop and
// keeps the file, so the notice goes later, in order. A notice whose agent cannot be told (route:
// OpenBot down) stops the drain and keeps the file: no later notice may overtake it.

async function drain(opts: ServeOptions): Promise<void> {
  const held = new Set<string>(); // agents whose run was refused or failed this loop
  for (const { path, item } of listSpool()) {
    if (find(item.key)) {
      removeSpool(path); // asked once already: --id would return the same delivery anyway
      continue;
    }
    let route: Route;
    try {
      route = await opts.route(parseKey(item.key));
    } catch (e) {
      if (!stopsDrain(e)) throw e;
      log(`drain stopped: ${(e as Error).message}`);
      return;
    }
    const { agent } = route;
    if (held.has(agent) || open().some((r) => agentOf(r, opts.defaultAgent) === agent)) continue;
    // A fallback's note is the first line of the text, so the operator sees why it came here.
    const message = route.note === undefined ? item.message : `${route.note}\n${item.message}`;
    try {
      await deliver(item.key, message, agent, opts);
    } catch (e) {
      if (!stopsDrain(e)) throw e;
      log(`drain stopped: ${agent}: ${(e as Error).message}`);
      held.add(agent);
      continue;
    }
    if (route.note !== undefined) log(`${item.key}: ${route.note}`); // once, when it goes
    removeSpool(path);
  }
}

async function deliver(key: string, message: string, agent: string, opts: ServeOptions): Promise<void> {
  const bot = opts.botFor(agent);
  const n = parseKey(key);
  if (n.kind === "unit-park" && readUnit(n.run, n.unit)?.parked?.blocked) {
    return deliverBlocked(key, message, agent, n.run, n.unit, n.at, opts);
  }
  const run = n.kind === "plain" ? "" : n.run;
  const offer = offerFor(n, message, run);
  if (!offer) {
    const { deliveryId } = await bot.run(messageTask(message), key);
    record({ key, phase: "asked", agent, run, title: message.split("\n")[0]!.slice(0, 200), say: message, ask_id: deliveryId });
    return;
  }
  const { deliveryId } = await bot.run(askTask(offer), key);
  record({
    key, phase: "asked", agent, run, title: offer.title, offer, ask_id: deliveryId,
    ...(n.kind === "unit-park" || n.kind === "unit-move" ? { unit: n.unit } : {}),
    ...(n.kind === "unit-park" ? { park_at: n.at } : {}),
  });
}

// A blocked park: `baton screen` gives the fresh screen and its picker (baton's parser, the same one
// its answer check uses). Park gone, or a newer park on screen: closed, nothing sent. A picker: the
// agent drafts first. No picker, or the screen cannot be read: asked at once with the escapes only.
async function deliverBlocked(key: string, message: string, agent: string, run: string, unit: string, at: string, opts: ServeOptions): Promise<void> {
  const bot = opts.botFor(agent);
  const base = { key, agent, run, unit, park_at: at, title: blockedOffer(message, run, unit, null, null).title };
  const res = await screen(run, unit, opts.runner);
  const shown = res.rc === 0 ? parseScreen(res.stdout) : null;
  if (res.rc === 2 || (shown && shown.park_at !== at)) {
    record({ ...base, phase: "closed", closed_at: opts.now().toISOString(), closed_by: "gone" });
    return;
  }
  if (shown?.picker) {
    const { deliveryId } = await bot.run(draftTask(shown.screen, shown.picker), `${key}#draft`);
    record({ ...base, phase: "drafting", message, picker: shown.picker, draft_id: deliveryId });
    return;
  }
  const offer = blockedOffer(message, run, unit, null, null);
  const { deliveryId } = await bot.run(askTask(offer), key);
  record({ ...base, phase: "asked", offer, ask_id: deliveryId });
}

// ---- poll ------------------------------------------------------------------------------------
// Every open record is read, sent and answered on its own agent; a tap is read from the agent the
// question went to, so it can only answer that question.

const botOf = (rec: DeliveryRec, opts: ServeOptions): OpenBot => opts.botFor(agentOf(rec, opts.defaultAgent));

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

// A follow-up opened unsent, or a question to ask again: it goes now. OpenBot refusing leaves it for
// later. A re-ask needs its own --id: the same id would return the first delivery. Only a re-ask of a
// malformed prompt is firmer; an expired question was asked well the first time.
async function send(rec: DeliveryRec, opts: ServeOptions): Promise<DeliveryRec> {
  const task = rec.offer ? askTask(rec.offer, rec.reasks === 1 && !rec.expired) : messageTask(rec.say ?? rec.title);
  const { deliveryId } = await botOf(rec, opts).run(task, rec.reasks === 1 ? `${rec.key}#reask` : rec.key);
  const sent: DeliveryRec = { ...rec, ask_id: deliveryId };
  record(sent);
  return sent;
}

async function afterDraft(rec: DeliveryRec, opts: ServeOptions): Promise<DeliveryRec> {
  const d = await statusOf(botOf(rec, opts), rec.draft_id ?? "");
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
  const bot = botOf(rec, opts);
  const d = await statusOf(bot, rec.ask_id ?? "");
  const ended = d.state === "completed" || d.state === "failed";
  if (!rec.offer) {
    if (ended) close(rec, "sent", opts.now());
    return;
  }
  if (d.turnId) {
    const r = await bot.resolved(d.turnId);
    if (r === "unreadable") {
      log(`${rec.key}: the answer in openbot.db is unreadable; nothing ran`);
      const closed = close(rec, "gone", opts.now());
      followUp(closed, { say: `${rec.title}: your answer could not be read, so nothing ran. Act in the Orca terminal or with baton.` });
      return;
    }
    if (r === "expired") {
      await expired(rec, opts);
      return;
    }
    if (r !== "none" && r.answer === SETTLED_LABEL && !rec.offer.options.some((o) => o.label === SETTLED_LABEL)) {
      // Our own dismissal of a malformed prompt, read back after a crash before the re-ask was
      // recorded (or the operator typed it): never a tap, never text for the worker.
      log(`${rec.key}: the prompt was answered settled; nothing ran`);
      await malformed(rec, opts);
      return;
    }
    if (r !== "none") {
      await handleTap(rec, r.answer, { bot, runner: opts.runner, now: opts.now });
      return;
    }
  }
  if (d.state === "running") {
    await checkShape(rec, opts);
    return;
  }
  if (ended) {
    log(`${rec.key}: the question ended with no answer; nothing ran`);
    close(rec, "gone", opts.now());
  }
}

// An OpenBot restart expired the question (issue #943); nothing runs. Asked again once while its park
// is open, on the same one re-ask a malformed prompt spends; else closed with a message. The re-ask is
// recorded unsent first, so a crash before it is sent sends it on the next loop with the same --id.
async function expired(rec: DeliveryRec, opts: ServeOptions): Promise<void> {
  if (rec.reasks === undefined && stillOpen(rec)) {
    log(`${rec.key}: the question expired in OpenBot; asked again`);
    const again: DeliveryRec = { ...rec, reasks: 1, expired: true };
    delete again.ask_id; // the expired turn is never read again
    record(again);
    await send(again, opts);
    return;
  }
  log(`${rec.key}: the question expired in OpenBot; closed, nothing ran`);
  const closed = close(rec, "gone", opts.now());
  followUp(closed, { say: `${rec.title}: the question expired in OpenBot (OpenBot restarted), so nothing ran. Act in the Orca terminal or with baton.` });
}

// ---- prompt shape (issue #939) -----------------------------------------------------------------
// The agent can ask a question without its options (pending-prompt-no-options.json). While the
// question waits, its prompt on /pending is found by title (settle.ts `ours`) and checked: exactly the
// offered labels, in order. No prompt yet: wait (a turn that ends with none closes as gone above).

async function checkShape(rec: DeliveryRec, opts: ServeOptions): Promise<void> {
  const bot = botOf(rec, opts);
  let prompts: Prompt[];
  try {
    prompts = await bot.pending();
  } catch (e) {
    if (!(e instanceof OpenBotDown)) throw e;
    log(`${rec.key}: prompt check: ${e.message}`); // checked again next loop
    return;
  }
  const mine = prompts.filter((p) => ours(rec, p));
  if (mine.length === 0 || mine.some((p) => wellFormed(rec, p))) return;
  // Dismissed with `settled`, which unblocks the agent. 409: someone answered first; the next poll
  // reads that answer as any other.
  if ((await bot.answer(mine[0]!, SETTLED_LABEL)) === "closed") return;
  log(`${rec.key}: the agent asked the question without its options; dismissed`);
  await malformed(rec, opts);
}

// A dismissed malformed prompt: asked again once, firmer; the second time, closed with a message.
async function malformed(rec: DeliveryRec, opts: ServeOptions): Promise<void> {
  if (rec.reasks === undefined) {
    const again: DeliveryRec = { ...rec, reasks: 1 };
    delete again.ask_id; // the old turn is never read again; unsent, the next loop sends it
    record(again);
    await send(again, opts);
    return;
  }
  const closed = close(rec, "gone", opts.now());
  followUp(closed, { say: `${rec.title}: the question could not be asked with options; act in the Orca terminal or with baton.` });
}
