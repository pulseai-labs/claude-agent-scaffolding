import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { disarm, merge, prView, unpark, unparkTo, type Runner } from "./actions.ts";
import { newestPark, readUnit, stageNames } from "./baton-state.ts";
import {
  idsOnMessage, keyboardFor, lookup, mint, setMessageId, spend, type ButtonRec, type Keyboard,
} from "./buttons.ts";
import type { Notice } from "./notice.ts";
import { stateDir } from "./paths.ts";
import type { Api } from "./telegram.ts";

export type Update = {
  update_id: number;
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { message_id: number; chat: { id: number }; text?: string };
    data?: string;
  };
  message?: { chat: { id: number }; from?: { id: number }; text?: string };
};

export type PressCtx = { api: Api; chatId: number; runner: Runner; now: () => Date };

type LogLine = {
  at: string;
  update_id: number;
  from?: number;
  chat?: number;
  id?: string;
  action?: string;
  result: string;
};

function logPress(line: LogLine): void {
  mkdirSync(stateDir(), { recursive: true });
  appendFileSync(join(stateDir(), "presses.jsonl"), JSON.stringify(line) + "\n");
}

const firstLine = (s: string): string => s.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";

const failure = (rc: number, stderr: string): string => firstLine(stderr) || `exit ${rc}`;

export async function handleUpdate(u: Update, ctx: PressCtx): Promise<void> {
  const cq = u.callback_query;
  const line: LogLine = { at: ctx.now().toISOString(), update_id: u.update_id, result: "crashed" };
  try {
    if (cq) {
      line.from = cq.from?.id;
      line.chat = cq.message?.chat.id;
      if (cq.data !== undefined) line.id = cq.data;
      // The chat lock: both the chat and the presser must be the locked chat.
      if (line.chat !== ctx.chatId || line.from !== ctx.chatId || !cq.message) {
        line.result = "foreign";
        return;
      }
      line.result = await handlePress(cq.id, cq.message, cq.data ?? "", ctx, line);
      return;
    }
    if (u.message) {
      line.from = u.message.from?.id;
      line.chat = u.message.chat.id;
      if (line.chat !== ctx.chatId || line.from !== ctx.chatId) {
        line.result = "foreign";
        return;
      }
      line.result = "typed";
      await ctx.api.call("sendMessage", { chat_id: ctx.chatId, text: "this bot takes button presses only" });
      return;
    }
    line.result = "ignored";
  } finally {
    logPress(line);
  }
}

async function handlePress(
  queryId: string,
  message: { message_id: number; text?: string },
  data: string,
  ctx: PressCtx,
  line: LogLine,
): Promise<string> {
  const { api, runner } = ctx;
  const now = ctx.now();
  const found = lookup(data, now);
  if (found === "unknown" || found === "expired") {
    await api.call("answerCallbackQuery", { callback_query_id: queryId, text: "expired" });
    return found;
  }
  if (found === "used") {
    await api.call("answerCallbackQuery", { callback_query_id: queryId, text: "already done" });
    return "used";
  }
  const rec = found;
  line.action = rec.action;

  // Spend before act: every id on this message, the pressed one and its siblings,
  // before any command runs or anything is edited. A crash after this point can
  // never run the command again when the same update is re-polled.
  // The pressed id is included even if its binding to the message never landed.
  const toSpend = new Set([rec.id, ...idsOnMessage(message.message_id)]);
  for (const id of toSpend) {
    if (lookup(id, now) !== "used") spend(id, now);
  }

  const notice = firstLine(message.text ?? "");
  const answer = () => api.call("answerCallbackQuery", { callback_query_id: queryId });
  const edit = async (text: string, keyboard?: Keyboard) => {
    const body: Record<string, unknown> = { chat_id: ctx.chatId, message_id: message.message_id, text };
    if (keyboard) {
      body.reply_markup = keyboard;
      const ids = keyboard.inline_keyboard.flat().flatMap((b) => ("callback_data" in b ? [b.callback_data] : []));
      setMessageId(ids, message.message_id);
    }
    await api.call("editMessageText", body);
  };
  const outcome = async (res: { rc: number; stderr: string }): Promise<string> => {
    await answer();
    if (res.rc === 0) {
      await edit(`${notice} — done`);
      return "done";
    }
    await edit(`${notice} — failed: ${failure(res.rc, res.stderr)}`);
    return "failed";
  };
  const btn = (text: string, r: Omit<ButtonRec, "id" | "minted_at">) => ({ text, callback_data: mint(r, now).id });
  const restore = async (): Promise<string> => {
    await answer();
    await edit(notice, keyboardFor(originalNotice(rec), now));
    return "restored";
  };
  const base = { run: rec.run, ...(rec.unit !== undefined ? { unit: rec.unit } : {}) };

  switch (rec.action) {
    case "merge": {
      if (!rec.pr_url || !rec.head_sha) return outcome({ rc: 1, stderr: "button carries no PR" });
      const view = await prView(rec.pr_url, runner);
      if (view.rc !== 0) return outcome(view);
      const pr = parsePrView(view.stdout);
      if (!pr) return outcome({ rc: 1, stderr: "gh pr view gave no PR number and base" });
      const carry = { ...base, pr_url: rec.pr_url, head_sha: rec.head_sha };
      await answer();
      await edit(`${notice}\n\nMerge PR #${pr.number} (head ${rec.head_sha.slice(0, 7)}) into ${pr.base}?`, {
        inline_keyboard: [[btn("Yes", { action: "merge-yes", ...carry }), btn("No", { action: "merge-no", ...carry })]],
      });
      return "confirm";
    }
    case "merge-yes":
      if (!rec.pr_url || !rec.head_sha) return outcome({ rc: 1, stderr: "button carries no PR" });
      return outcome(await merge(rec.pr_url, rec.head_sha, runner));
    case "unpark":
      if (rec.unit === undefined) return outcome({ rc: 1, stderr: "button carries no unit" });
      return outcome(await unpark(rec.run, rec.unit, runner));
    case "unpark-to": {
      if (rec.unit === undefined) return outcome({ rc: 1, stderr: "button carries no unit" });
      const rows = stageNames(rec.run).map((stage) => [btn(stage, { action: "unpark-stage", ...base, stage })]);
      rows.push([btn("Cancel", { action: "cancel", ...base })]);
      await answer();
      await edit(`${notice}\n\nUnpark to which stage?`, { inline_keyboard: rows });
      return "picker";
    }
    case "unpark-stage":
      if (rec.unit === undefined || !rec.stage) return outcome({ rc: 1, stderr: "button carries no stage" });
      return outcome(await unparkTo(rec.run, rec.unit, rec.stage, runner));
    case "disarm":
      await answer();
      await edit(`${notice}\n\nDisarm run ${rec.run}?`, {
        inline_keyboard: [[btn("Yes", { action: "disarm-yes", ...base }), btn("No", { action: "disarm-no", ...base })]],
      });
      return "confirm";
    case "disarm-yes":
      return outcome(await disarm(rec.run, runner));
    case "merge-no":
    case "disarm-no":
    case "cancel":
      return restore();
    case "show": {
      if (rec.unit === undefined) return outcome({ rc: 1, stderr: "button carries no unit" });
      const unit = readUnit(rec.run, rec.unit);
      const park = newestPark(rec.run, rec.unit);
      const nr = "not recorded";
      await api.call("sendMessage", {
        chat_id: ctx.chatId,
        text: [
          `${rec.run}/${rec.unit}`,
          `stage: ${unit?.stage ?? nr}`,
          `reason: ${unit?.parked?.reason ?? nr}`,
          `questions: ${park?.questions ?? nr}`,
          `thread: ${park?.thread ?? nr}`,
        ].join("\n"),
      });
      // Spending the siblings above killed this notice's buttons; bring them back fresh.
      await restore();
      return "shown";
    }
  }
}

// R3: the notice a pressed record came from, to rebuild its original buttons.
function originalNotice(rec: ButtonRec): Notice {
  if (rec.unit === undefined) return { kind: "run-park", run: rec.run };
  if (rec.pr_url) {
    const u = readUnit(rec.run, rec.unit);
    return { kind: "unit-move", run: rec.run, unit: rec.unit, stage: u?.stage ?? "" };
  }
  return { kind: "unit-park", run: rec.run, unit: rec.unit };
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
