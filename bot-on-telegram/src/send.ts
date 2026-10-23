import { keyboardFor, setMessageId } from "./buttons.ts";
import { parseKey } from "./notice.ts";
import { listSpool, removeSpool } from "./spool.ts";
import type { Api } from "./telegram.ts";

export async function drainSpool(
  api: Api,
  chatId: number,
  now: () => Date,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  for (const { path, item } of listSpool()) {
    const keyboard = keyboardFor(parseKey(item.key), now());
    const body: Record<string, unknown> = { chat_id: chatId, text: item.message };
    if (keyboard) body.reply_markup = keyboard;
    try {
      const msg = await api.call<{ message_id: number }>("sendMessage", body);
      if (keyboard) {
        const ids = keyboard.inline_keyboard.flat().flatMap((b) => ("callback_data" in b ? [b.callback_data] : []));
        setMessageId(ids, msg.message_id);
      }
      removeSpool(path);
      sent++;
    } catch {
      return { sent, failed: 1 }; // keep order: stop here, leave this and later items
    }
  }
  return { sent, failed: 0 };
}
