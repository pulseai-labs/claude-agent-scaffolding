import { keyboardFor, setMessageId } from "./buttons.ts";
import { parseKey } from "./notice.ts";
import { mkdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { stateDir } from "./paths.ts";
import { listSpool, removeSpool } from "./spool.ts";
import { TelegramError, type Api } from "./telegram.ts";

export async function drainSpool(
  api: Api,
  chatId: number,
  now: () => Date,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const { path, item } of listSpool()) {
    try {
      let keyboard = keyboardFor(parseKey(item.key), now());
      const body: Record<string, unknown> = { chat_id: chatId, text: item.message };
      if (keyboard) body.reply_markup = keyboard;
      let msg: { message_id: number };
      try {
        msg = await api.call<{ message_id: number }>("sendMessage", body);
      } catch (e) {
        // A 400 may be the buttons' fault: deliver the notice once more without them.
        if (!(keyboard && e instanceof TelegramError && e.status === 400)) throw e;
        delete body.reply_markup;
        keyboard = undefined;
        msg = await api.call<{ message_id: number }>("sendMessage", body);
      }
      if (keyboard) {
        const ids = keyboard.inline_keyboard.flat().flatMap((b) => ("callback_data" in b ? [b.callback_data] : []));
        setMessageId(ids, msg.message_id);
      }
      removeSpool(path);
      sent++;
    } catch (e) {
      // A permanent rejection (4xx but not 429) would block the spool forever: set it aside and go on.
      // 401/403/404 say the token or bot is wrong, not the notice: stop, like a network give-up.
      const stops = [401, 403, 404, 429];
      if (e instanceof TelegramError && e.status !== undefined && e.status >= 400 && e.status < 500 && !stops.includes(e.status)) {
        const dir = join(stateDir(), "spool-failed");
        mkdirSync(dir, { recursive: true });
        renameSync(path, join(dir, basename(path)));
        console.error(`bot-on-telegram: dropped notice ${item.key}: ${e.description}`);
        failed++;
        continue;
      }
      return { sent, failed: failed + 1 }; // keep order: stop here, leave this and later items
    }
  }
  return { sent, failed };
}
