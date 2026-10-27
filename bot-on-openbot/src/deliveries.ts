// deliveries.jsonl: one record per OpenBot delivery the bridge opened (a draft, a question or a
// message). Every appended line is the full record; the last line per key wins. The offer recorded
// with a question is the only source of the command a tap runs.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Offer, Picker } from "./offer.ts";
import { stateDir } from "./paths.ts";

export type DeliveryRec = {
  key: string;                 // notice key, or "<notice key>#<n>" for a follow-up question or message
  phase: "drafting" | "asked" | "closed";
  run: string; unit?: string; park_at?: string;
  title: string;
  message?: string;            // the notice's text, kept while a blocked park's draft runs
  draft_id?: string; ask_id?: string;   // an "asked" record with no ask_id is sent on the next loop
  picker?: Picker;             // blocked park only, from `baton screen`
  offer?: Offer;               // what was asked; the only source of a tap's command
  say?: string;                // a plain message (no offer): the text sent verbatim
  closed_at?: string; closed_by?: "tap" | "settled" | "gone" | "sent";
};

const logPath = (): string => join(stateDir(), "deliveries.jsonl");

export function record(r: DeliveryRec): void {
  mkdirSync(stateDir(), { recursive: true });
  appendFileSync(logPath(), JSON.stringify(r) + "\n");
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
// parent's run, unit and park so that settling closes it with its notice.
export function followUp(parent: DeliveryRec, what: { offer: Offer; picker?: Picker } | { say: string }): DeliveryRec {
  const rec: DeliveryRec = {
    key: followUpKey(parent.key),
    phase: "asked",
    run: parent.run,
    ...(parent.unit !== undefined ? { unit: parent.unit } : {}),
    ...(parent.park_at !== undefined ? { park_at: parent.park_at } : {}),
    title: "offer" in what ? what.offer.title : parent.title,
    ...("offer" in what ? { offer: what.offer, ...(what.picker ? { picker: what.picker } : {}) } : { say: what.say }),
  };
  record(rec);
  return rec;
}
