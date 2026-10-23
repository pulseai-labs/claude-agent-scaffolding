import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "../src/actions.ts";
import { keyboardFor, mint, setMessageId, type Keyboard } from "../src/buttons.ts";
import { handleUpdate, type Update } from "../src/press.ts";
import { makeApi } from "../src/telegram.ts";
import { FakeTelegram } from "./fake-telegram.ts";

const CHAT = 42;
const MSG = 100;
const NOTICE = "baton r1/u1 parked in build: second prompt";
const HEAD = "abcdef1" + "0123456789abcdef0123456789abcdef0";
const PR = "https://github.com/o/r/pull/38";
const T0 = new Date("2026-10-23T12:00:00Z");

let dir: string;
let fake: FakeTelegram;
let base: string;
let runs: string[][];
let reply: (argv: string[]) => { rc: number; stdout: string; stderr: string };

// A recording fake of baton and gh: it records argv and answers from `reply`.
const runner: Runner = async (argv) => {
  runs.push(argv);
  return reply(argv);
};

const ctx = (r: Runner = runner, now = T0) => ({
  api: makeApi("1:T", { base, backoffMs: 1 }),
  chatId: CHAT,
  runner: r,
  now: () => now,
});

let nextUpdate = 1;
const press = (data: string, o: { chat?: number; from?: number; msg?: number; text?: string } = {}): Update => ({
  update_id: nextUpdate++,
  callback_query: {
    id: `cq${nextUpdate}`,
    from: { id: o.from ?? CHAT },
    message: { message_id: o.msg ?? MSG, chat: { id: o.chat ?? CHAT }, text: o.text ?? NOTICE },
    data,
  },
});

const cbButtons = (k: unknown) =>
  ((k as Keyboard | undefined)?.inline_keyboard ?? [])
    .flat()
    .filter((b): b is { text: string; callback_data: string } => "callback_data" in b);
const byText = (k: unknown, text: string): string => cbButtons(k).find((b) => b.text === text)!.callback_data;

// The four buttons a unit-park notice is sent with, bound to MSG.
function sendParkNotice(): Keyboard {
  const k = keyboardFor({ kind: "unit-park", run: "r1", unit: "u1" }, T0)!;
  setMessageId(cbButtons(k).map((b) => b.callback_data), MSG);
  return k;
}

const calls = (method: string) => fake.calls.filter((c) => c.method === method);
const lastEdit = () => calls("editMessageText").at(-1)!.body;
const answers = () => calls("answerCallbackQuery").map((c) => c.body.text);
const pressLog = (): Record<string, unknown>[] =>
  readFileSync(join(dir, "presses.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "bot-press-"));
  process.env.BOT_ON_TELEGRAM_STATE_DIR = dir;
  process.env.BATON_STATE_DIR = join(import.meta.dir, "fixtures", "baton");
  fake = new FakeTelegram();
  base = await fake.start();
  runs = [];
  reply = () => ({ rc: 0, stdout: "", stderr: "" });
});
afterEach(() => {
  fake.stop();
  delete process.env.BOT_ON_TELEGRAM_STATE_DIR;
  delete process.env.BATON_STATE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

test("a press from another chat: no API call, no command, one foreign log line", async () => {
  const k = sendParkNotice();
  await handleUpdate(press(byText(k, "Unpark"), { chat: 999 }), ctx());
  expect(fake.calls).toHaveLength(0);
  expect(runs).toHaveLength(0);
  const log = pressLog();
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ result: "foreign", chat: 999, from: CHAT });
});

test("a press from the locked chat but another user: no API call, no command, foreign", async () => {
  const k = sendParkNotice();
  await handleUpdate(press(byText(k, "Unpark"), { from: 999 }), ctx());
  expect(fake.calls).toHaveLength(0);
  expect(runs).toHaveLength(0);
  expect(pressLog()).toEqual([expect.objectContaining({ result: "foreign", chat: CHAT, from: 999 })]);
});

test("merge: gh pr view with fixed argv, then the confirm copy with Yes / No", async () => {
  const m = mint({ action: "merge", run: "r1", unit: "u2", pr_url: PR, head_sha: HEAD }, T0);
  setMessageId([m.id], MSG);
  reply = () => ({ rc: 0, stdout: '{"number":38,"baseRefName":"main"}', stderr: "" });
  await handleUpdate(press(m.id, { text: "baton r1/u2 moved to spine_ack" }), ctx());
  expect(runs).toEqual([["gh", "pr", "view", PR, "--json", "number,baseRefName"]]);
  const e = lastEdit();
  expect(e.text).toBe("baton r1/u2 moved to spine_ack\n\nMerge PR #38 (head abcdef1) into main?");
  expect(cbButtons(e.reply_markup).map((b) => b.text)).toEqual(["Yes", "No"]);
});

test("merge-yes runs gh pr merge with the reviewed head; a moved head shows gh's refusal", async () => {
  const m = mint({ action: "merge", run: "r1", unit: "u2", pr_url: PR, head_sha: HEAD }, T0);
  setMessageId([m.id], MSG);
  reply = () => ({ rc: 0, stdout: '{"number":38,"baseRefName":"main"}', stderr: "" });
  await handleUpdate(press(m.id), ctx());
  const yes = byText(lastEdit().reply_markup, "Yes");
  reply = () => ({ rc: 1, stdout: "", stderr: "head branch was modified\nmore detail\n" });
  await handleUpdate(press(yes), ctx());
  expect(runs[1]).toEqual(["gh", "pr", "merge", PR, "--merge", "--match-head-commit", HEAD]);
  expect(lastEdit().text).toBe(`${NOTICE} — failed: head branch was modified`);
  expect("reply_markup" in lastEdit()).toBe(false);
});

test("merge: a failing gh pr view shows the failure and no confirm", async () => {
  const m = mint({ action: "merge", run: "r1", unit: "u2", pr_url: PR, head_sha: HEAD }, T0);
  setMessageId([m.id], MSG);
  reply = () => ({ rc: 1, stdout: "", stderr: "could not resolve to a PullRequest\n" });
  await handleUpdate(press(m.id), ctx());
  expect(runs).toHaveLength(1);
  expect(lastEdit().text).toBe(`${NOTICE} — failed: could not resolve to a PullRequest`);
  expect("reply_markup" in lastEdit()).toBe(false);
});

test("merge-no shows the original buttons again with new ids", async () => {
  const m = mint({ action: "merge", run: "r1", unit: "u2", pr_url: "https://github.com/o/r/pull/7", head_sha: HEAD }, T0);
  setMessageId([m.id], MSG);
  reply = () => ({ rc: 0, stdout: '{"number":7,"baseRefName":"main"}', stderr: "" });
  await handleUpdate(press(m.id, { text: "baton r1/u2 moved to spine_ack" }), ctx());
  const no = byText(lastEdit().reply_markup, "No");
  await handleUpdate(press(no, { text: "baton r1/u2 moved to spine_ack\n\nMerge PR #7 (head abcdef1) into main?" }), ctx());
  expect(runs).toHaveLength(1); // only the gh pr view
  const e = lastEdit();
  expect(e.text).toBe("baton r1/u2 moved to spine_ack");
  const shown = (e.reply_markup as Keyboard).inline_keyboard.flat().map((b) => b.text);
  expect(shown).toEqual(["Merge", "Open PR", "Disarm"]);
  expect(byText(e.reply_markup, "Merge")).not.toBe(m.id);
});

test("unpark pressed twice runs the command once; the second press is already done", async () => {
  const k = sendParkNotice();
  const id = byText(k, "Unpark");
  await handleUpdate(press(id), ctx());
  await handleUpdate(press(id), ctx());
  expect(runs).toEqual([["baton", "unpark", "r1", "u1"]]);
  expect(answers()).toEqual([undefined, "already done"]);
  expect(calls("editMessageText")[0]!.body.text).toBe(`${NOTICE} — done`);
  expect(pressLog().map((l) => l.result)).toEqual(["done", "used"]);
});

test("an id minted 8 days ago is expired and runs nothing", async () => {
  const k = sendParkNotice();
  await handleUpdate(press(byText(k, "Unpark")), ctx(runner, new Date(T0.getTime() + 8 * 86400_000)));
  expect(runs).toHaveLength(0);
  expect(answers()).toEqual(["expired"]);
  expect(calls("editMessageText")).toHaveLength(0);
});

test("callback_data that was never minted is expired and runs nothing", async () => {
  sendParkNotice();
  await handleUpdate(press("zzzzzzzzzz"), ctx());
  expect(runs).toHaveLength(0);
  expect(answers()).toEqual(["expired"]);
  expect(pressLog()[0]).toMatchObject({ id: "zzzzzzzzzz", result: "unknown" });
});

test("baton refusing an unpark shows its first stderr line", async () => {
  const k = sendParkNotice();
  reply = () => ({ rc: 2, stdout: "", stderr: "not parked\n" });
  await handleUpdate(press(byText(k, "Unpark")), ctx());
  expect(lastEdit().text).toBe(`${NOTICE} — failed: not parked`);
});

test("unpark-to shows the recipe's sorted stages plus Cancel; a pick runs unpark --to", async () => {
  const k = sendParkNotice();
  await handleUpdate(press(byText(k, "Unpark to stage…")), ctx());
  expect(runs).toHaveLength(0);
  const e = lastEdit();
  expect(e.text).toBe(`${NOTICE}\n\nUnpark to which stage?`);
  expect(cbButtons(e.reply_markup).map((b) => b.text)).toEqual(["build", "review", "spine_ack", "Cancel"]);
  await handleUpdate(press(byText(e.reply_markup, "spine_ack")), ctx());
  expect(runs).toEqual([["baton", "unpark", "r1", "u1", "--to", "spine_ack"]]);
  expect(lastEdit().text).toBe(`${NOTICE} — done`);
});

test("cancel on the stage picker restores the four buttons", async () => {
  const k = sendParkNotice();
  await handleUpdate(press(byText(k, "Unpark to stage…")), ctx());
  await handleUpdate(press(byText(lastEdit().reply_markup, "Cancel")), ctx());
  expect(runs).toHaveLength(0);
  expect(lastEdit().text).toBe(NOTICE);
  expect(cbButtons(lastEdit().reply_markup).map((b) => b.text)).toEqual([
    "Unpark", "Unpark to stage…", "Show question", "Disarm",
  ]);
});

test("disarm asks; disarm-no restores four new buttons; the restored Unpark works once", async () => {
  const k = sendParkNotice();
  const oldIds = cbButtons(k).map((b) => b.callback_data);
  await handleUpdate(press(byText(k, "Disarm")), ctx());
  expect(lastEdit().text).toBe(`${NOTICE}\n\nDisarm run r1?`);
  expect(cbButtons(lastEdit().reply_markup).map((b) => b.text)).toEqual(["Yes", "No"]);
  await handleUpdate(press(byText(lastEdit().reply_markup, "No")), ctx());
  expect(runs).toHaveLength(0);
  const restored = lastEdit().reply_markup;
  expect(lastEdit().text).toBe(NOTICE);
  expect(cbButtons(restored).map((b) => b.text)).toEqual(["Unpark", "Unpark to stage…", "Show question", "Disarm"]);
  for (const b of cbButtons(restored)) expect(oldIds).not.toContain(b.callback_data);
  await handleUpdate(press(byText(restored, "Unpark")), ctx());
  expect(runs).toEqual([["baton", "unpark", "r1", "u1"]]);
});

test("disarm-yes runs baton disarm", async () => {
  const k = sendParkNotice();
  await handleUpdate(press(byText(k, "Disarm")), ctx());
  await handleUpdate(press(byText(lastEdit().reply_markup, "Yes")), ctx());
  expect(runs).toEqual([["baton", "disarm", "r1"]]);
  expect(lastEdit().text).toBe(`${NOTICE} — done`);
});

test("a runner crash mid-command: the same update again runs nothing and is already done", async () => {
  const k = sendParkNotice();
  const crashing: Runner = async (argv) => {
    runs.push(argv);
    throw new Error("killed mid-command");
  };
  const u = press(byText(k, "Unpark"));
  await expect(handleUpdate(u, ctx(crashing))).rejects.toThrow("killed mid-command");
  await handleUpdate(u, ctx(crashing));
  expect(runs).toEqual([["baton", "unpark", "r1", "u1"]]);
  expect(answers()).toEqual(["already done"]);
  expect(pressLog().map((l) => l.result)).toEqual(["crashed", "used"]);
});

test("a sibling pressed after Unpark on the same message is already done", async () => {
  const k = sendParkNotice();
  await handleUpdate(press(byText(k, "Unpark")), ctx());
  await handleUpdate(press(byText(k, "Disarm")), ctx());
  expect(runs).toHaveLength(1);
  expect(answers()).toEqual([undefined, "already done"]);
});

test("show replies with stage, reason, questions and thread; absent fields are not recorded", async () => {
  const m = mint({ action: "show", run: "r1", unit: "u2" }, T0);
  setMessageId([m.id], MSG);
  await handleUpdate(press(m.id), ctx());
  expect(runs).toHaveLength(0);
  const sent = calls("sendMessage");
  expect(sent).toHaveLength(1);
  expect(sent[0]!.body.chat_id).toBe(CHAT);
  expect(sent[0]!.body.text).toBe(
    "r1/u2\nstage: spine_ack\nreason: not recorded\nquestions: not recorded\nthread: not recorded",
  );
});

test("show on a parked unit with a full park event, then the notice buttons come back fresh", async () => {
  const k = sendParkNotice();
  await handleUpdate(press(byText(k, "Show question")), ctx());
  expect(calls("sendMessage")[0]!.body.text).toBe(
    "r1/u1\nstage: build\nreason: second prompt\nquestions: which db?\nthread: th-2",
  );
  const restored = lastEdit().reply_markup;
  expect(lastEdit().text).toBe(NOTICE);
  expect(cbButtons(restored).map((b) => b.text)).toEqual(["Unpark", "Unpark to stage…", "Show question", "Disarm"]);
  for (const b of cbButtons(restored)) expect(cbButtons(k).map((o) => o.callback_data)).not.toContain(b.callback_data);
  await handleUpdate(press(byText(restored, "Unpark")), ctx());
  expect(runs).toEqual([["baton", "unpark", "r1", "u1"]]);
});

test("a typed message from the locked chat gets the presses-only reply and runs nothing", async () => {
  await handleUpdate({ update_id: 7, message: { chat: { id: CHAT }, from: { id: CHAT }, text: "unpark u1" } }, ctx());
  expect(runs).toHaveLength(0);
  expect(fake.calls.map((c) => [c.method, c.body.text])).toEqual([["sendMessage", "this bot takes button presses only"]]);
  expect(pressLog()).toEqual([expect.objectContaining({ update_id: 7, result: "typed" })]);
});

test("a typed message from a stranger gets no reply", async () => {
  await handleUpdate({ update_id: 8, message: { chat: { id: 999 }, from: { id: 999 }, text: "hi" } }, ctx());
  expect(fake.calls).toHaveLength(0);
  expect(pressLog()).toEqual([expect.objectContaining({ update_id: 8, result: "foreign" })]);
});

test("disarm-no on a unit-move notice restores Merge, Open PR, Disarm; the restored Disarm confirms", async () => {
  const text = "baton r1/u2 moved to spine_ack";
  const k = keyboardFor({ kind: "unit-move", run: "r1", unit: "u2", stage: "spine_ack" }, T0)!;
  setMessageId(cbButtons(k).map((b) => b.callback_data), MSG);
  await handleUpdate(press(byText(k, "Disarm"), { text }), ctx());
  expect(lastEdit().text).toBe(`${text}\n\nDisarm run r1?`);
  await handleUpdate(press(byText(lastEdit().reply_markup, "No"), { text: lastEdit().text as string }), ctx());
  expect(runs).toHaveLength(0);
  const restored = lastEdit().reply_markup as Keyboard;
  expect(lastEdit().text).toBe(text);
  expect(restored.inline_keyboard.flat().map((b) => b.text)).toEqual(["Merge", "Open PR", "Disarm"]);
  await handleUpdate(press(byText(restored, "Disarm"), { text }), ctx());
  expect(lastEdit().text).toBe(`${text}\n\nDisarm run r1?`);
  expect(cbButtons(lastEdit().reply_markup).map((b) => b.text)).toEqual(["Yes", "No"]);
  expect(runs).toHaveLength(0);
});
