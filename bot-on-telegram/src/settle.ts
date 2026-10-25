import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readUnit } from "./baton-state.ts";
import { idsOnMessage, lookup, spend } from "./buttons.ts";
import { stateDir } from "./paths.ts";
import { TelegramError, type Api } from "./telegram.ts";

export type OpenAction = {
  message_id: number;
  run: string;
  unit: string;
  park_at: string;
  text: string;
  closed_at?: string;
};

const logPath = (): string => join(stateDir(), "open-actions.jsonl");

function append(a: OpenAction): void {
  mkdirSync(stateDir(), { recursive: true });
  appendFileSync(logPath(), JSON.stringify(a) + "\n");
}

export function recordOpen(a: OpenAction): void {
  append(a);
}

// Last record per message_id wins.
function latest(): OpenAction[] {
  const out = new Map<number, OpenAction>();
  let text: string;
  try {
    text = readFileSync(logPath(), "utf8");
  } catch {
    return [];
  }
  for (const line of text.split("\n")) {
    try {
      const r = JSON.parse(line) as OpenAction;
      if (r && typeof r.message_id === "number") out.set(r.message_id, r);
    } catch {
      // a torn or garbage line is skipped
    }
  }
  return [...out.values()];
}

// Edit every action message whose unit is no longer in that park to "settled". Returns the edits made.
export async function sweepSettled(api: Api, chatId: number, now: Date): Promise<number> {
  let edits = 0;
  for (const a of latest()) {
    if (a.closed_at) continue;
    const u = readUnit(a.run, a.unit);
    if (u && u.parked && u.parked.at === a.park_at) continue; // still that park
    const ids = idsOnMessage(a.message_id);
    const unspent = ids.filter((id) => lookup(id, now) !== "used");
    if (unspent.length > 0 || ids.length === 0) {
      try {
        await api.call("editMessageText", {
          chat_id: chatId,
          message_id: a.message_id,
          text: "✅ settled — " + a.text,
        });
        edits++;
      } catch (e) {
        if (!(e instanceof TelegramError && e.description.includes("message is not modified"))) continue;
      }
      for (const id of unspent) spend(id, now);
    }
    append({ ...a, closed_at: now.toISOString() });
  }
  return edits;
}
