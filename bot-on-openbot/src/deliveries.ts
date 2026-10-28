// deliveries.jsonl: one record per OpenBot delivery the bridge opened (a draft, a question or a
// message). Every appended line is the full record; the last line per key wins. The offer recorded
// with a question is the only source of the command a tap runs.

import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Offer, Picker } from "./offer.ts";
import { stateDir } from "./paths.ts";

export type DeliveryRec = {
  key: string;                 // notice key, or "<notice key>#<n>" for a follow-up question or message
  phase: "drafting" | "asked" | "closed";
  agent?: string;              // the OpenBot agent it went to; a 0.1.x record has none: the default agent
  run: string; unit?: string; park_at?: string;
  title: string;
  message?: string;            // the notice's text, kept while a blocked park's draft runs
  note?: string;               // a blocked park's fallback note: heads its offer's text, not its follow-ups
  draft_id?: string; ask_id?: string;   // an "asked" record with no ask_id is sent on the next loop
  picker?: Picker;             // blocked park only, from `baton screen`
  offer?: Offer;               // what was asked; the only source of a tap's command
  say?: string;                // a plain message (no offer): the text sent verbatim
  closed_at?: string; closed_by?: "tap" | "settled" | "gone" | "sent";
  unanswered?: true;           // settled, but its OpenBot prompt is still to be answered "settled"
  reasks?: 1;                  // asked again once, firmer, after the agent asked it without its options (#939)
  expired?: true;              // that re-ask follows an OpenBot restart that expired the question (#943): not firmer
};

const logPath = (): string => join(stateDir(), "deliveries.jsonl");

// True when the file ends mid-line: a write torn by a crash. The next record then starts on a new line,
// or it would join the torn fragment and be skipped with it (review #938 finding 1).
function tornTail(path: string): boolean {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return false;
  }
  if (size === 0) return false;
  const fd = openSync(path, "r");
  try {
    const b = Buffer.alloc(1);
    readSync(fd, b, 0, 1, size - 1);
    return b[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

export function record(r: DeliveryRec): void {
  mkdirSync(stateDir(), { recursive: true });
  appendFileSync(logPath(), (tornTail(logPath()) ? "\n" : "") + JSON.stringify(r) + "\n");
}

// Last record per key, in the order each key first appeared.
export function all(): DeliveryRec[] {
  const out = new Map<string, DeliveryRec>();
  let text: string;
  try {
    text = readFileSync(logPath(), "utf8");
  } catch {
    return [];
  }
  for (const line of text.split("\n")) {
    try {
      const r = JSON.parse(line) as DeliveryRec;
      if (r && typeof r.key === "string" && typeof r.phase === "string") out.set(r.key, r);
    } catch {
      // a torn or garbage line is skipped
    }
  }
  return [...out.values()];
}

/** The OpenBot agent a record is read from and answered on: its own, else (0.1.x) the default agent. */
export function agentOf(r: DeliveryRec, dflt: string): string {
  return r.agent ?? dflt;
}

/** One agent's identity: OpenBot resolves a name with case and outer spaces ignored. The stored name
 * stays as given; only comparisons use this. */
export const agentKey = (name: string): string => name.trim().toLocaleLowerCase();

export function open(): DeliveryRec[] {
  return all().filter((r) => r.phase !== "closed");
}

export function find(key: string): DeliveryRec | undefined {
  return all().find((r) => r.key === key);
}

export function close(r: DeliveryRec, by: NonNullable<DeliveryRec["closed_by"]>, now: Date): DeliveryRec {
  const closed: DeliveryRec = { ...r, phase: "closed", closed_at: now.toISOString(), closed_by: by };
  record(closed);
  return closed;
}

// The next follow-up key of a notice: "<notice key>#<n>", n one past the highest in use.
export function followUpKey(key: string): string {
  const root = key.split("#")[0]!;
  let n = 0;
  for (const r of all()) {
    if (!r.key.startsWith(`${root}#`)) continue;
    const k = Number.parseInt(r.key.slice(root.length + 1), 10);
    if (Number.isInteger(k) && k > n) n = k;
  }
  return `${root}#${n + 1}`;
}

// A follow-up question or message of `parent`, opened unsent: the next loop sends it. It carries the
// parent's run, unit and park so that settling closes it with its notice, and the parent's agent:
// a follow-up is never routed again.
export function followUp(parent: DeliveryRec, what: { offer: Offer; picker?: Picker } | { say: string }): DeliveryRec {
  const rec: DeliveryRec = {
    key: followUpKey(parent.key),
    phase: "asked",
    ...(parent.agent !== undefined ? { agent: parent.agent } : {}),
    run: parent.run,
    ...(parent.unit !== undefined ? { unit: parent.unit } : {}),
    ...(parent.park_at !== undefined ? { park_at: parent.park_at } : {}),
    title: "offer" in what ? what.offer.title : parent.title,
    ...("offer" in what ? { offer: what.offer, ...(what.picker ? { picker: what.picker } : {}) } : { say: what.say }),
  };
  record(rec);
  return rec;
}
