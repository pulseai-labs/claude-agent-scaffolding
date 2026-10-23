import { afterEach, beforeEach, expect, test } from "bun:test";
import { makeApi, TelegramError } from "../src/telegram.ts";
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
