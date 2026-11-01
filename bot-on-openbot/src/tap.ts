// An answered OpenBot question → at most one fixed command. The label is matched exactly against the
// offer recorded for that question (never against model text); the command and its arguments come
// from that offer and the record's own run, unit and park. Follow-up questions and result messages
// are opened as follow-up records, which the next serve loop sends on the record's own agent: `bot`
// is the client of the agent the question went to, and a follow-up keeps that agent.

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  answerScreen, answerText, disarm, merge, parseScreen, prView, screen, unpark, unparkTo, type Runner,
} from "./actions.ts";
import { newestPark, readUnit } from "./baton-state.ts";
import { close, find, followUp, type DeliveryRec } from "./deliveries.ts";
import { confirmOffer, moreOffer, refusedOffer, stageOffer, type Act, type Offer } from "./offer.ts";
import type { OpenBot } from "./openbot.ts";
import { stillOpen } from "./settle.ts";
import { stateDir } from "./paths.ts";
import { whyLines } from "./why.ts";
import { log } from "./log.ts";

export type TapCtx = { bot: OpenBot; runner: Runner; now: () => Date };

type TapLine = { at: string; key: string; label?: string; other: boolean; act: string; rc?: number };

function logTap(line: TapLine): void {
  mkdirSync(stateDir(), { recursive: true });
  appendFileSync(join(stateDir(), "taps.jsonl"), JSON.stringify(line) + "\n");
}

const firstLine = (s: string): string => s.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
const failure = (rc: number, stderr: string): string => firstLine(stderr) || `exit ${rc}`;

const SHOW_MAX = 3500;
const SCREEN_TAIL = 1500;
const cut = (s: string): string => (s.length > SHOW_MAX ? `${s.slice(0, SHOW_MAX)}…` : s);

// The shape baton's forge accepts; anything else never reaches gh.
const PR_URL_RE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/[0-9]+$/;

// baton records a park's questions as JSON.stringify(PendingQuestion[]) (baton/src/host.ts).
// An array renders one "\n- " line per question; a string that does not decode to one is shown raw,
// after a space. Either way the result follows "questions:" directly. (bot-on-telegram press.ts.)
export function renderQuestions(raw: string): string {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return ` ${raw}`;
  }
  if (!Array.isArray(v) || v.length === 0) return ` ${raw}`;
  const text = (q: unknown): string => {
    if (typeof q === "string") return q;
    if (typeof q === "object" && q !== null) {
      for (const k of ["question", "text", "header"]) {
        const f = (q as Record<string, unknown>)[k];
        if (typeof f === "string" && f !== "") return f;
      }
    }
    return JSON.stringify(q);
  };
  return v.map((q) => `\n- ${text(q).replace(/\s*\n\s*/g, " ")}`).join("");
}

export async function handleTap(rec: DeliveryRec, answer: string, ctx: TapCtx): Promise<void> {
  const now = ctx.now();
  const say = (parent: DeliveryRec, text: string) => followUp(parent, { say: text });
  const offer = rec.offer;
  const matched = offer?.options.find((o) => o.label === answer);
  const other = !matched;
  const line: TapLine = { at: now.toISOString(), key: rec.key, ...(matched ? { label: answer } : {}), other, act: "none" };

  // Closed already (settled, or tapped): nothing runs. The latest record decides, not the caller's copy.
  const latest = find(rec.key);
  if (!latest || latest.phase === "closed" || !offer) {
    line.act = "closed";
    logTap(line);
    say(latest ?? rec, `${rec.title}: this question is no longer open; nothing ran.`);
    return;
  }
  // Closed before any command runs: a crash after this point never runs it twice.
  const closed = close(latest, "tap", now);

  try {
    if (!matched) {
      if (answer !== "" && offer.allowOther && closed.picker && closed.unit && closed.park_at) {
        line.act = "text";
        const res = await answerText(closed.run, closed.unit, closed.park_at, answer, closed.picker.question, ctx.runner);
        line.rc = res.rc;
        if (res.rc === 0) say(closed, `${closed.title}: sent your text to the worker`);
        else notSent(closed, res);
        return;
      }
      if (answer === "") {
        line.act = "unmatched";
        log(`${rec.key}: unmatched label; nothing ran`);
        say(closed, "That option is not one I offered; nothing ran.");
        return;
      }
      line.act = "typed";
      say(closed, "Typed answers only go to a blocked worker; nothing ran.");
      return;
    }
    line.act = matched.act.do;
    line.rc = await act(closed, matched.act, ctx);
  } finally {
    logTap(line);
  }
}

// The one command an act stands for; returns its rc when one ran.
async function act(rec: DeliveryRec, a: Act, ctx: TapCtx): Promise<number | undefined> {
  const { runner } = ctx;
  const say = (text: string) => followUp(rec, { say: text });
  const ask = (offer: Offer) => followUp(rec, { offer, ...(rec.picker ? { picker: rec.picker } : {}) });
  const result = (what: string, res: { rc: number; stderr: string }): number => {
    say(`${rec.title}: ${what} — ${res.rc === 0 ? "done" : `failed: ${failure(res.rc, res.stderr)}`}`);
    return res.rc;
  };
  const noUnit = (what: string): number => result(what, { rc: 1, stderr: "the question carries no unit" });
  // An unpark acts on whatever park the unit is in now; a question asked for an older park runs
  // nothing. (A screen answer has the same check inside baton, through --park.)
  if ((a.do === "unpark" || a.do === "unpark-to" || a.do === "unpark-stage" || a.do === "stages") && rec.unit && rec.park_at
    && readUnit(rec.run, rec.unit)?.parked?.at !== rec.park_at) {
    say(`${rec.title}: the park this question was for is gone; nothing ran.`);
    return undefined;
  }

  switch (a.do) {
    case "unpark":
      if (!rec.unit) return noUnit("Unpark");
      return result("Unpark", await unpark(rec.run, rec.unit, runner));
    case "unpark-to":
      if (!rec.unit) return noUnit("Unpark to stage");
      ask(stageOffer(rec.run, rec.title));
      return undefined;
    case "stages":
      ask(stageOffer(rec.run, rec.title, a.from));
      return undefined;
    case "more":
      ask(moreOffer(rec.offer!));
      return undefined;
    case "unpark-stage":
      if (!rec.unit) return noUnit(`Unpark to ${a.stage}`);
      return result(`Unpark to ${a.stage}`, await unparkTo(rec.run, rec.unit, a.stage, runner));
    case "show":
      if (!rec.unit) return noUnit("Show question");
      ask({ ...(rec.offer!.back ?? rec.offer!), text: await showText(rec, runner) });
      return undefined;
    case "disarm":
      ask(confirmOffer("disarm", { do: "disarm-yes" }, rec.title, `Disarm run ${rec.run}?`));
      return undefined;
    case "disarm-yes":
      return result("Disarm", await disarm(rec.run, runner));
    case "merge": {
      if (!PR_URL_RE.test(a.pr_url)) return result("Merge", { rc: 1, stderr: "not a PR URL" });
      const view = await prView(a.pr_url, runner);
      if (view.rc !== 0) return result("Merge", view);
      const pr = parsePrView(view.stdout);
      if (!pr) return result("Merge", { rc: 1, stderr: "gh pr view gave no PR number and base" });
      ask(confirmOffer("merge", { do: "merge-yes", pr_url: a.pr_url, head_sha: a.head_sha }, rec.title,
        `Merge PR #${pr.number} (head ${a.head_sha.slice(0, 7)}) into ${pr.base}?`));
      return undefined;
    }
    case "merge-yes":
      if (!PR_URL_RE.test(a.pr_url)) return result("Merge", { rc: 1, stderr: "not a PR URL" });
      return result("Merge", await merge(a.pr_url, a.head_sha, runner));
    case "no": {
      // A unit park's No or Cancel, while the park is still open, asks the park's own question again
      // (#959): a mistaken No must not leave the park with nothing on the phone that can act on it.
      const root = find(rec.key.split("#")[0]!);
      if (rec.unit && rec.park_at && root?.offer && stillOpen(rec)) {
        followUp(rec, {
          offer: { ...root.offer, text: `Cancelled; nothing ran.\n${root.offer.text}` },
          ...(root.picker ? { picker: root.picker } : {}),
        });
        return undefined;
      }
      say("Cancelled.");
      return undefined;
    }
    case "open-pr":
      say(`${rec.title}: ${a.pr_url}`);
      return undefined;
    case "pick": {
      if (!rec.unit || !rec.park_at) return noUnit(`"${a.label}"`);
      const res = await answerScreen(rec.run, rec.unit, rec.park_at, a.n, a.label, runner);
      if (res.rc === 0) say(`${rec.title}: sent "${a.label}" to the worker`);
      else notSent(rec, res);
      return res.rc;
    }
    case "other":
      log(`${rec.key}: unmatched label; nothing ran`);
      say("That option is not one I offered; nothing ran.");
      return undefined;
  }
}

// A refused screen answer: ask again with baton's reason, offering only Show question and Disarm.
function notSent(rec: DeliveryRec, res: { rc: number; stderr: string }): void {
  followUp(rec, { offer: refusedOffer(rec.title, `Not sent: ${failure(res.rc, res.stderr)}`), ...(rec.picker ? { picker: rec.picker } : {}) });
}

// What Show question shows: the unit's stage, the park reason, why it parked (a stop file's text, a
// driver's escalate action), the park's questions when it recorded any, its thread, and for a blocked
// park the tail of a fresh `baton screen`.
async function showText(rec: DeliveryRec, runner: Runner): Promise<string> {
  const unit = readUnit(rec.run, rec.unit!);
  const park = newestPark(rec.run, rec.unit!, unit?.parked?.at);
  const nr = "not recorded";
  const lines = [
    `${rec.run}/${rec.unit}`,
    `stage: ${unit?.stage ?? nr}`,
    `reason: ${unit?.parked?.reason ?? nr}`,
    ...whyLines(park),
    ...(park?.questions !== undefined ? [`questions:${renderQuestions(park.questions)}`] : []),
    `thread: ${park?.thread ?? nr}`,
  ];
  if (rec.picker) {
    const res = await screen(rec.run, rec.unit!, runner);
    const shown = res.rc === 0 ? parseScreen(res.stdout) : null;
    lines.push(shown ? `screen:\n${shown.screen.slice(-SCREEN_TAIL)}` : `screen: not read (${failure(res.rc, res.stderr)})`);
  }
  return cut(lines.join("\n"));
}

function parsePrView(stdout: string): { number: number; base: string } | null {
  try {
    const v = JSON.parse(stdout) as { number?: unknown; baseRefName?: unknown };
    if (typeof v.number === "number" && Number.isInteger(v.number) && typeof v.baseRefName === "string" && v.baseRefName !== "") {
      return { number: v.number, base: v.baseRefName };
    }
  } catch {
    // fall through
  }
  return null;
}
