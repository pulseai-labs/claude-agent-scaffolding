export type Api = { call<T>(method: string, body: Record<string, unknown>): Promise<T> };

// Messages are our own text: never the URL (it carries the token) and never a raw fetch error.
export class TelegramError extends Error {
  constructor(readonly method: string, readonly description: string, readonly status?: number) {
    super(`telegram ${method}: ${description}`);
    this.name = "TelegramError";
  }
}

type Reply = {
  ok?: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

export function makeApi(
  token: string,
  opts: { base?: string; retries?: number; backoffMs?: number; fetch?: typeof fetch } = {},
): Api {
  const base = opts.base ?? process.env.BOT_ON_TELEGRAM_API_BASE ?? "https://api.telegram.org";
  const tries = opts.retries ?? 5;
  const backoff = opts.backoffMs ?? 500;
  const doFetch = opts.fetch ?? fetch;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  return {
    async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
      let last = "no attempt made";
      for (let attempt = 1; attempt <= tries; attempt++) {
        let wait = backoff * 2 ** (attempt - 1);
        try {
          const res = await doFetch(`${base}/bot${token}/${method}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          let reply: Reply = {};
          try {
            reply = (await res.json()) as Reply;
          } catch {
            // a non-JSON body is judged by its status alone
          }
          if (res.ok && reply.ok === true) return reply.result as T;
          const code = reply.error_code ?? res.status;
          last = `${code} ${reply.description ?? "no description"}`;
          const retryable = code === 429 || code >= 500;
          if (!retryable) throw new TelegramError(method, reply.description ?? "no description", code);
          const after = reply.parameters?.retry_after;
          if (code === 429 && typeof after === "number") wait = Math.max(wait, after * 1000);
        } catch (e) {
          if (e instanceof TelegramError) throw e;
          last = "network error"; // the raw error may quote the URL, so it is dropped
        }
        if (attempt < tries) await sleep(wait);
      }
      throw new TelegramError(method, `gave up after ${tries} tries (${last})`);
    },
  };
}
