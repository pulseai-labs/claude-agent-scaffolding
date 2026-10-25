import { afterEach, beforeEach, expect, test } from "bun:test";
import { fitText, makeApi, TelegramError, TEXT_LIMIT } from "../src/telegram.ts";
import { FakeTelegram } from "./fake-telegram.ts";

const TOKEN = "123456:FIXTURE-TOKEN-abcdef";
let fake: FakeTelegram;
let base: string;
beforeEach(async () => {
  fake = new FakeTelegram();
  base = await fake.start();
});
afterEach(() => fake.stop());

test("a call succeeds after the fake drops 2 connections", async () => {
  fake.drops = 2;
  const api = makeApi(TOKEN, { base, backoffMs: 5 });
  const r = await api.call<{ message_id: number }>("sendMessage", { chat_id: 1, text: "hi" });
  expect(r.message_id).toBe(100);
  expect(fake.dropped).toBe(2);
  expect(fake.calls).toHaveLength(1);
  expect(fake.calls[0]!.token).toBe(TOKEN);
});

test("the injected drop makes fetch itself reject (not a 5xx)", async () => {
  fake.drops = 1;
  let rejected: unknown;
  await fetch(`${base}/botx/sendMessage`, { method: "POST", body: "{}" }).catch((e) => (rejected = e));
  expect(rejected).toBeDefined();
});

test("after 5 drops it throws TelegramError and the token leaks nowhere", async () => {
  fake.drops = 5;
  const api = makeApi(TOKEN, { base, backoffMs: 5 });
  let err: unknown;
  await api.call("sendMessage", { chat_id: 1, text: "hi" }).catch((e) => (err = e));
  expect(err).toBeInstanceOf(TelegramError);
  const e = err as TelegramError;
  for (const s of [String(e), e.message, e.stack ?? "", JSON.stringify(e), String(e.cause ?? "")]) {
    expect(s).not.toContain(TOKEN);
    expect(s).not.toContain("FIXTURE-TOKEN");
    expect(s).not.toContain(base);
  }
  expect(e.message).toContain("sendMessage");
  expect(fake.dropped).toBe(5);
});

test("a 429 with retry_after 1 waits at least 1 s before the retry", async () => {
  fake.failures = [{ error_code: 429, description: "Too Many Requests", parameters: { retry_after: 1 } }];
  const api = makeApi(TOKEN, { base, backoffMs: 5 });
  const t0 = Date.now();
  await api.call("sendMessage", { chat_id: 1, text: "x" });
  expect(Date.now() - t0).toBeGreaterThanOrEqual(990);
  expect(fake.calls).toHaveLength(2);
});

test("a 400 ok:false is not retried and throws with Telegram's description", async () => {
  fake.failures = [{ error_code: 400, description: "Bad Request: chat not found" }];
  const api = makeApi(TOKEN, { base, backoffMs: 5 });
  const err = await api.call("sendMessage", { chat_id: 1, text: "x" }).catch((e) => e);
  expect(err).toBeInstanceOf(TelegramError);
  expect(err.message).toContain("chat not found");
  expect(fake.calls).toHaveLength(1);
});

test("a 500 is retried", async () => {
  fake.failures = [{ error_code: 500, description: "oops" }];
  const api = makeApi(TOKEN, { base, backoffMs: 5 });
  await api.call("getMe", {});
  expect(fake.calls).toHaveLength(2);
});

test("base defaults from BOT_ON_TELEGRAM_API_BASE", async () => {
  process.env.BOT_ON_TELEGRAM_API_BASE = base;
  try {
    await makeApi(TOKEN, { backoffMs: 5 }).call("getMe", {});
  } finally {
    delete process.env.BOT_ON_TELEGRAM_API_BASE;
  }
  expect(fake.calls).toHaveLength(1);
});

test("a fetch error that quotes the URL (with token) never reaches the thrown error", async () => {
  const leaky = (async (url: string) => {
    throw new Error(`connect failed: ${url}`);
  }) as unknown as typeof fetch;
  const api = makeApi(TOKEN, { base: "http://example.invalid", backoffMs: 1, fetch: leaky });
  const err = await api.call("sendMessage", {}).catch((e) => e);
  expect(err).toBeInstanceOf(TelegramError);
  for (const s of [String(err), err.message, err.stack ?? "", String(err.cause ?? "")]) {
    expect(s).not.toContain("FIXTURE-TOKEN");
    expect(s).not.toContain("example.invalid");
  }
});

test("a call that never answers is aborted by its timeout and retried as a network error", async () => {
  fake.hangs = 1;
  const api = makeApi(TOKEN, { base, backoffMs: 1, timeoutMs: 100, pollTimeoutMs: 60_000 });
  const t0 = Date.now();
  const r = await api.call<{ message_id: number }>("sendMessage", { chat_id: 1, text: "hi" });
  expect(Date.now() - t0).toBeLessThan(5_000);
  expect(fake.hung).toBe(1);
  expect(r.message_id).toBe(100);
});

test("every try timing out gives up with a token-free network error", async () => {
  fake.hangs = 2;
  const api = makeApi(TOKEN, { base, backoffMs: 1, retries: 2, timeoutMs: 100, pollTimeoutMs: 60_000 });
  const err = await api.call("sendMessage", {}).catch((e) => e);
  expect(err).toBeInstanceOf(TelegramError);
  expect(err.message).toBe("telegram sendMessage: gave up after 2 tries (network error)");
  for (const s of [String(err), err.stack ?? "", String(err.cause ?? "")]) {
    expect(s).not.toContain("FIXTURE-TOKEN");
    expect(s).not.toContain(base);
  }
  expect(fake.hung).toBe(2);
});

test("a body with a numeric timeout (long poll) gets the long-poll timeout, not the short one", async () => {
  fake.hangs = 1;
  const api = makeApi(TOKEN, { base, backoffMs: 1, timeoutMs: 60_000, pollTimeoutMs: 100 });
  const t0 = Date.now();
  await api.call("getUpdates", { offset: 0, timeout: 25 });
  expect(Date.now() - t0).toBeLessThan(5_000);
  expect(fake.hung).toBe(1);
});

test("the default timeouts are 15 000 ms, and 40 000 ms for a long poll", async () => {
  const seen: number[] = [];
  const orig = AbortSignal.timeout;
  AbortSignal.timeout = (ms: number) => (seen.push(ms), orig.call(AbortSignal, ms));
  try {
    const api = makeApi(TOKEN, { base, backoffMs: 1 });
    await api.call("sendMessage", { chat_id: 1, text: "x" });
    await api.call("getUpdates", { offset: 0, timeout: 25 });
    await api.call("getUpdates", { offset: 0, timeout: "25" });
  } finally {
    AbortSignal.timeout = orig;
  }
  expect(seen).toEqual([15_000, 40_000, 15_000]);
});

test("fitText: Telegram's 4096 limit in UTF-16 code units, tail cut with an ellipsis", () => {
  expect(TEXT_LIMIT).toBe(4096);
  const fits = "x".repeat(4096);
  expect(fitText(fits)).toBe(fits);
  const over = "y".repeat(4097);
  expect(fitText(over)).toBe("y".repeat(4095) + "…");
  // A surrogate pair at the cut is dropped whole, never split.
  const pair = "z".repeat(4094) + "😀" + "tail";
  const out = fitText(pair);
  expect(out).toBe("z".repeat(4094) + "…");
  expect(out.length).toBeLessThanOrEqual(4096);
  // `keep` is never cut: the head is cut so head + keep fits.
  expect(fitText("k".repeat(4096), " — done")).toBe("k".repeat(4096 - 8) + "… — done");
  expect(fitText("short", " — done")).toBe("short — done");
});
