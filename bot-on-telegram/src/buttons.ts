import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readUnit, reviewedHead } from "./baton-state.ts";
import type { Notice } from "./notice.ts";
import { batonStateDir, stateDir } from "./paths.ts";

export type Action =
  | "merge" | "merge-yes" | "merge-no"
  | "unpark" | "unpark-to" | "unpark-stage"
  | "disarm" | "disarm-yes" | "disarm-no"
  | "show" | "cancel";

export type ButtonRec = {
  id: string;
  action: Action;
  run: string;
  unit?: string;
  pr_url?: string;
  head_sha?: string;
  stage?: string;
  minted_at: string;
  message_id?: number;
  used_at?: string;
};

export type Keyboard = {
  inline_keyboard: ({ text: string; callback_data: string } | { text: string; url: string })[][];
};

const TTL_MS = 7 * 86400_000;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

const logPath = (): string => join(stateDir(), "buttons.jsonl");

function append(rec: ButtonRec): void {
  mkdirSync(stateDir(), { recursive: true });
  appendFileSync(logPath(), JSON.stringify(rec) + "\n");
}

// Last record per id wins; every appended record is the full merged record.
function latest(): Map<string, ButtonRec> {
  const out = new Map<string, ButtonRec>();
  let text: string;
  try {
    text = readFileSync(logPath(), "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    try {
      const r = JSON.parse(line) as ButtonRec;
      if (r && typeof r.id === "string") out.set(r.id, r);
    } catch {
      // a torn or garbage line is skipped
    }
  }
  return out;
}

export function mint(rec: Omit<ButtonRec, "id" | "minted_at">, now: Date): ButtonRec {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const id = Array.from(bytes, (b) => ALPHABET[b % 32]).join("");
  const full: ButtonRec = { ...rec, id, minted_at: now.toISOString() };
  append(full);
  return full;
}

export function lookup(id: string, now: Date): ButtonRec | "unknown" | "expired" | "used" {
  const rec = latest().get(id);
  if (!rec) return "unknown";
  if (rec.used_at) return "used";
  if (now.getTime() - Date.parse(rec.minted_at) > TTL_MS) return "expired";
  return rec;
}

export function spend(id: string, now: Date): void {
  const rec = latest().get(id);
  if (rec) append({ ...rec, used_at: now.toISOString() });
}

export function setMessageId(ids: string[], messageId: number): void {
  const all = latest();
  for (const id of ids) {
    const rec = all.get(id);
    if (rec) append({ ...rec, message_id: messageId });
  }
}

export function idsOnMessage(messageId: number): string[] {
  return [...latest().values()].filter((r) => r.message_id === messageId).map((r) => r.id);
}

export function keyboardFor(n: Notice, now: Date): Keyboard | undefined {
  const btn = (text: string, rec: Omit<ButtonRec, "id" | "minted_at">) => ({
    text,
    callback_data: mint(rec, now).id,
  });
  switch (n.kind) {
    case "run-park": {
      if (!runReadable(n.run)) return undefined;
      return { inline_keyboard: [[btn("Disarm", { action: "disarm", run: n.run })]] };
    }
    case "unit-park": {
      const u = readUnit(n.run, n.unit);
      if (!u) return undefined;
      const base = { run: n.run, unit: n.unit };
      return {
        inline_keyboard: [
          [btn("Unpark", { action: "unpark", ...base }), btn("Unpark to stage…", { action: "unpark-to", ...base })],
          [btn("Show question", { action: "show", ...base }), btn("Disarm", { action: "disarm", ...base })],
        ],
      };
    }
    case "unit-move": {
      const u = readUnit(n.run, n.unit);
      if (!u) return undefined;
      const base = { run: n.run, unit: n.unit };
      const row: Keyboard["inline_keyboard"][number] = [];
      if (u.pr_url) {
        const head = reviewedHead(n.run, n.unit);
        if (head) row.push(btn("Merge", { action: "merge", ...base, pr_url: u.pr_url, head_sha: head }));
        row.push({ text: "Open PR", url: u.pr_url });
      }
      row.push(btn("Disarm", { action: "disarm", ...base }));
      return { inline_keyboard: [row] };
    }
    default:
      return undefined;
  }
}

function runReadable(run: string): boolean {
  try {
    JSON.parse(readFileSync(join(batonStateDir(), "runs", run, "run.json"), "utf8"));
    return true;
  } catch {
    return false;
  }
}
