// Close the questions whose park cleared by any route (answered in the Orca terminal, a later tick
// moved the unit, the run ended), and answer their OpenBot prompt with the reserved label `settled`,
// so the agent's queue moves on. A tap on a settled question finds it closed and runs nothing.

import { readUnit, runReadable, runStatus } from "./baton-state.ts";
import { all, record, type DeliveryRec } from "./deliveries.ts";
import { log } from "./log.ts";
import { shownLabels } from "./offer.ts";
import { OpenBotDown, OpenBotRefused, type OpenBot, type Prompt } from "./openbot.ts";

/** Spike: OpenBot accepts an answer with a label the prompt never offered (answer-unoffered-label.txt). */
export const SETTLE_MODE = "answer";
export const SETTLED_LABEL = "settled";

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The prompt is the record's: its header, or the first line of its question, is the record's title. */
export function ours(r: DeliveryRec, p: Prompt): boolean {
  const title = norm(r.title);
  return norm(p.header) === title || norm(p.question.split("\n")[0]!) === title;
}

/** The prompt offers exactly the record's shown labels, in order (an accepted label not shown is no button). */
export function wellFormed(r: DeliveryRec, p: Prompt): boolean {
  const labels = r.offer ? shownLabels(r.offer) : [];
  return p.options.length === labels.length && p.options.every((l, i) => l === labels[i]);
}

// The record's prompt on /pending. /pending carries no turnId to match by. First the prompt as asked:
// its question "<title>\n<text>" (pending-prompt.json) and exactly the offered labels, in order. Else a
// prompt of its title asked some other way (issue #939: options null, pending-prompt-no-options.json),
// so a malformed prompt is dismissed too. One delivery is open at a time, so the agent shows at most
// one of the bridge's prompts; a prompt whose title is not the record's is never matched.
function promptOf(r: DeliveryRec, prompts: Prompt[]): Prompt | undefined {
  if (!r.offer) return undefined;
  const question = norm(`${r.title}\n${r.offer.text}`);
  return prompts.find((p) => norm(p.question) === question && wellFormed(r, p)) ?? prompts.find((p) => ours(r, p));
}

// Left its park: the run ended, or (for a park question) the unit is no longer in that park.
// A run whose run.json cannot be read settles nothing: unknown is not "left the park".
function settled(r: DeliveryRec): boolean {
  if (!runReadable(r.run)) return false;
  if (["disarmed", "done"].includes(runStatus(r.run) ?? "")) return true;
  if (r.unit === undefined || r.park_at === undefined) return false;
  return readUnit(r.run, r.unit)?.parked?.at !== r.park_at;
}

/** Still in its park, known: the run reads as armed or parked, and a park question's unit is at its park. */
export function stillOpen(r: DeliveryRec): boolean {
  return runReadable(r.run) && ["armed", "parked"].includes(runStatus(r.run) ?? "") && !settled(r);
}

// Answer the record's prompt with `settled` when it is on /pending. True when there is nothing left to
// answer: answered, already closed (409), or the delivery ended without one. False: try next loop.
// The delivery is read first: the agent runs one turn at a time, so a prompt is the record's only
// while its own delivery still runs. Once it has ended, a prompt of the same title belongs to a later
// question (a new park of the same unit) and is never answered.
async function answerSettled(bot: OpenBot, r: DeliveryRec): Promise<boolean> {
  if (!r.ask_id) return true; // never sent
  try {
    const d = await bot.status(r.ask_id);
    if (d.state === "completed" || d.state === "failed") return true;
  } catch (e) {
    if (e instanceof OpenBotRefused) return true; // OpenBot does not know the delivery
    throw e;
  }
  const p = promptOf(r, await bot.pending());
  if (!p) return false;
  await bot.answer(p, SETTLED_LABEL); // "closed" is fine: someone answered first
  return true;
}

// Returns the number of records settled this sweep. A question whose prompt is not on /pending yet (it
// shows about 6 s after the run) is closed now, so a tap runs nothing, and kept `unanswered` until its
// prompt shows or its delivery ends.
export async function sweepSettled(bot: OpenBot, now: Date): Promise<number> {
  let n = 0;
  for (const r of all()) {
    try {
      if (r.phase === "closed") {
        if (r.unanswered && (await answerSettled(bot, r))) {
          const done = { ...r };
          delete done.unanswered;
          record(done);
        }
        continue;
      }
      if (r.say !== undefined || !settled(r)) continue; // a message has nothing to settle
      const closed: DeliveryRec = { ...r, phase: "closed", closed_at: now.toISOString(), closed_by: "settled" };
      if (r.phase === "asked" && r.ask_id && !(await answerSettled(bot, r))) closed.unanswered = true;
      record(closed);
      n++;
    } catch (e) {
      if (!(e instanceof OpenBotDown)) throw e;
      log(`settle ${r.key}: ${e.message}`);
    }
  }
  return n;
}
