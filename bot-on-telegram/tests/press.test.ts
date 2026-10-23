import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("merge-yes runs gh pr merge with the reviewed head; a moved head shows gh's refusal and fresh buttons", async () => {
  const m = mint({ action: "merge", run: "r1", unit: "u2", pr_url: PR, head_sha: HEAD, notice_kind: "unit-move", stage: "spine_ack" }, T0);
  setMessageId([m.id], MSG);
  reply = () => ({ rc: 0, stdout: '{"number":38,"baseRefName":"main"}', stderr: "" });
  await handleUpdate(press(m.id), ctx());
  const yes = byText(lastEdit().reply_markup, "Yes");
  reply = () => ({ rc: 1, stdout: "", stderr: "head branch was modified\nmore detail\n" });
  await handleUpdate(press(yes), ctx());
  expect(runs[1]).toEqual(["gh", "pr", "merge", PR, "--merge", "--match-head-commit", HEAD]);
  expect(lastEdit().text).toBe(`${NOTICE}\n\nfailed: head branch was modified`);
  expect((lastEdit().reply_markup as Keyboard).inline_keyboard.flat().map((b) => b.text)).toEqual(["Merge", "Open PR", "Disarm"]);
});

test("merge: a failing gh pr view shows the failure and no confirm; fresh buttons come back and Merge works again", async () => {
  const text = "baton r1/u2 moved to spine_ack";
  const k = keyboardFor({ kind: "unit-move", run: "r1", unit: "u2", stage: "spine_ack" }, T0)!;
  setMessageId(cbButtons(k).map((b) => b.callback_data), MSG);
  reply = () => ({ rc: 1, stdout: "", stderr: "could not resolve to a PullRequest\n" });
  await handleUpdate(press(byText(k, "Merge"), { text }), ctx());
  expect(runs).toHaveLength(1);
  expect(lastEdit().text).toBe(`${text}\n\nfailed: could not resolve to a PullRequest`);
  const fresh = lastEdit().reply_markup as Keyboard;
  expect(fresh.inline_keyboard.flat().map((b) => b.text)).toEqual(["Merge", "Open PR", "Disarm"]);
  for (const b of cbButtons(fresh)) expect(cbButtons(k).map((o) => o.callback_data)).not.toContain(b.callback_data);
  reply = () => ({ rc: 0, stdout: '{"number":7,"baseRefName":"main"}', stderr: "" });
  await handleUpdate(press(byText(fresh, "Merge"), { text: lastEdit().text as string }), ctx());
  expect(runs).toEqual([
    ["gh", "pr", "view", "https://github.com/o/r/pull/7", "--json", "number,baseRefName"],
    ["gh", "pr", "view", "https://github.com/o/r/pull/7", "--json", "number,baseRefName"],
  ]);
  expect(lastEdit().text).toBe(`${text}\n\nMerge PR #7 (head aaaaaaa) into main?`);
});

test("merge-no shows the original buttons again with new ids", async () => {
  const m = mint({ action: "merge", run: "r1", unit: "u2", pr_url: "https://github.com/o/r/pull/7", head_sha: HEAD, notice_kind: "unit-move", stage: "spine_ack" }, T0);
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
  expect(lastEdit().text).toBe(`${NOTICE}\n\nfailed: not parked`);
  expect(cbButtons(lastEdit().reply_markup).map((b) => b.text)).toEqual(["Unpark", "Unpark to stage…", "Show question", "Disarm"]);
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
  expect(answers()).toEqual([undefined, "already done"]); // the first press was answered before the command
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

// The r1/u1 fixture's park event carries questions as baton writes them: JSON.stringify of the
// host's PendingQuestion[] (baton/src/engine.ts park(), element shape in baton/src/host.ts).
test("show on a parked unit with a full park event, then the notice buttons come back fresh", async () => {
  const k = sendParkNotice();
  await handleUpdate(press(byText(k, "Show question")), ctx());
  expect(calls("sendMessage")[0]!.body.text).toBe(
    "r1/u1\nstage: build\nreason: second prompt\nquestions:\n- which db?\n- run migrations now?\nthread: th-2",
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

test("disarm-yes failing on a run-park notice: the failure paragraph and a fresh Disarm", async () => {
  const k = keyboardFor({ kind: "run-park", run: "r1" }, T0)!;
  setMessageId(cbButtons(k).map((b) => b.callback_data), MSG);
  const text = "baton run r1 parked";
  await handleUpdate(press(byText(k, "Disarm"), { text }), ctx());
  reply = () => ({ rc: 1, stdout: "", stderr: "" });
  await handleUpdate(press(byText(lastEdit().reply_markup, "Yes"), { text: lastEdit().text as string }), ctx());
  expect(lastEdit().text).toBe(`${text}\n\nfailed: exit 1`);
  expect(cbButtons(lastEdit().reply_markup).map((b) => b.text)).toEqual(["Disarm"]);
});

test("unpark-stage failing: fresh unit-park buttons come back", async () => {
  const k = sendParkNotice();
  await handleUpdate(press(byText(k, "Unpark to stage…")), ctx());
  reply = () => ({ rc: 2, stdout: "", stderr: "no such stage\n" });
  await handleUpdate(press(byText(lastEdit().reply_markup, "review")), ctx());
  expect(lastEdit().text).toBe(`${NOTICE}\n\nfailed: no such stage`);
  expect(cbButtons(lastEdit().reply_markup).map((b) => b.text)).toEqual(["Unpark", "Unpark to stage…", "Show question", "Disarm"]);
});

test("a record with no notice_kind restores no buttons", async () => {
  const m = mint({ action: "merge", run: "r1", unit: "u2", pr_url: PR, head_sha: HEAD }, T0);
  setMessageId([m.id], MSG);
  reply = () => ({ rc: 1, stdout: "", stderr: "boom\n" });
  await handleUpdate(press(m.id), ctx());
  expect(lastEdit().text).toBe(`${NOTICE}\n\nfailed: boom`);
  expect("reply_markup" in lastEdit()).toBe(false);
});

test("the press is answered exactly once, before the runner is called", async () => {
  const k = sendParkNotice();
  let seenAtRun: string[] = [];
  const watching: Runner = async (argv) => {
    seenAtRun = fake.calls.map((c) => c.method);
    return runner(argv);
  };
  await handleUpdate(press(byText(k, "Unpark")), ctx(watching));
  expect(seenAtRun).toEqual(["answerCallbackQuery"]);
  expect(fake.calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
});

test("confirm, picker, restore and show presses are each answered exactly once", async () => {
  const k = sendParkNotice();
  await handleUpdate(press(byText(k, "Disarm")), ctx());
  expect(calls("answerCallbackQuery")).toHaveLength(1);
  await handleUpdate(press(byText(lastEdit().reply_markup, "No")), ctx());
  expect(calls("answerCallbackQuery")).toHaveLength(2);
  await handleUpdate(press(byText(lastEdit().reply_markup, "Unpark to stage…")), ctx());
  expect(calls("answerCallbackQuery")).toHaveLength(3);
  await handleUpdate(press(byText(lastEdit().reply_markup, "Cancel")), ctx());
  expect(calls("answerCallbackQuery")).toHaveLength(4);
  await handleUpdate(press(byText(lastEdit().reply_markup, "Show question")), ctx());
  expect(calls("answerCallbackQuery")).toHaveLength(5);
  reply = () => ({ rc: 1, stdout: "", stderr: "x\n" });
  await handleUpdate(press(byText(lastEdit().reply_markup, "Unpark")), ctx());
  expect(calls("answerCallbackQuery")).toHaveLength(6);
});

test("answerCallbackQuery rejected: the command still runs, the outcome edit still happens, the log shows done", async () => {
  const k = sendParkNotice();
  fake.failOn.answerCallbackQuery = [{ error_code: 400, description: "Bad Request: query is too old" }];
  await handleUpdate(press(byText(k, "Unpark")), ctx());
  expect(runs).toEqual([["baton", "unpark", "r1", "u1"]]);
  expect(lastEdit().text).toBe(`${NOTICE} — done`);
  expect(pressLog().map((l) => l.result)).toEqual(["done"]);
});

test("the outcome edit failing after rc 0 logs the command's result, not crashed", async () => {
  const k = sendParkNotice();
  fake.failOn.editMessageText = [{ error_code: 400, description: "Bad Request: message to edit not found" }];
  await expect(handleUpdate(press(byText(k, "Unpark")), ctx())).rejects.toThrow("message to edit not found");
  expect(runs).toHaveLength(1);
  expect(pressLog().map((l) => l.result)).toEqual(["done"]);
});

test("the outcome edit failing after a failed command logs failed, not crashed", async () => {
  const k = sendParkNotice();
  reply = () => ({ rc: 2, stdout: "", stderr: "not parked\n" });
  fake.failOn.editMessageText = [{ error_code: 400, description: "Bad Request: message to edit not found" }];
  await expect(handleUpdate(press(byText(k, "Unpark")), ctx())).rejects.toThrow();
  expect(pressLog().map((l) => l.result)).toEqual(["failed"]);
});

function longQuestionBaton(): string {
  const root = join(dir, "baton");
  mkdirSync(join(root, "runs", "r9"), { recursive: true });
  writeFileSync(join(root, "runs", "r9", "run.json"), JSON.stringify({
    units: { u1: { stage: "build", parked: { reason: "long", at: "2026-10-23T10:00:00Z" } } },
  }));
  writeFileSync(join(root, "runs", "r9", "events.jsonl"),
    JSON.stringify({ kind: "park", unit: "u1", reason: "long", thread: "th-9", questions: "q".repeat(10_000) }) + "\n");
  return root;
}

test("show with a 10 000-char questions field: the reply is cut to 3500 chars plus an ellipsis; buttons come back", async () => {
  process.env.BATON_STATE_DIR = longQuestionBaton();
  const k = keyboardFor({ kind: "unit-park", run: "r9", unit: "u1" }, T0)!;
  setMessageId(cbButtons(k).map((b) => b.callback_data), MSG);
  await handleUpdate(press(byText(k, "Show question")), ctx());
  const text = calls("sendMessage")[0]!.body.text as string;
  expect(text.length).toBe(3501);
  expect(text.endsWith("q…")).toBe(true);
  expect(text.startsWith("r9/u1\nstage: build\nreason: long\nquestions: qqq")).toBe(true);
  expect(cbButtons(lastEdit().reply_markup).map((b) => b.text)).toEqual(["Unpark", "Unpark to stage…", "Show question", "Disarm"]);
});

test("show with a reply of exactly 3500 chars is not cut", async () => {
  const root = longQuestionBaton();
  const head = "r9/u1\nstage: build\nreason: long\nquestions: ";
  const tail = "\nthread: th-9";
  writeFileSync(join(root, "runs", "r9", "events.jsonl"),
    JSON.stringify({ kind: "park", unit: "u1", reason: "long", thread: "th-9", questions: "q".repeat(3500 - head.length - tail.length) }) + "\n");
  process.env.BATON_STATE_DIR = root;
  const m = mint({ action: "show", run: "r9", unit: "u1", notice_kind: "unit-park" }, T0);
  setMessageId([m.id], MSG);
  await handleUpdate(press(m.id), ctx());
  const text = calls("sendMessage")[0]!.body.text as string;
  expect(text.length).toBe(3500);
  expect(text.endsWith("thread: th-9")).toBe(true);
});

test("show: sendMessage rejected still restores the notice's buttons", async () => {
  const k = sendParkNotice();
  fake.failOn.sendMessage = [{ error_code: 400, description: "Bad Request: message is too long" }];
  await expect(handleUpdate(press(byText(k, "Show question")), ctx())).rejects.toThrow("message is too long");
  expect(lastEdit().text).toBe(NOTICE);
  const restored = lastEdit().reply_markup;
  expect(cbButtons(restored).map((b) => b.text)).toEqual(["Unpark", "Unpark to stage…", "Show question", "Disarm"]);
  await handleUpdate(press(byText(restored, "Unpark")), ctx());
  expect(runs).toEqual([["baton", "unpark", "r1", "u1"]]);
});

test("merge-yes success keeps only the Open PR link", async () => {
  const m = mint({ action: "merge-yes", run: "r1", unit: "u2", pr_url: PR, head_sha: HEAD, notice_kind: "unit-move", stage: "spine_ack" }, T0);
  setMessageId([m.id], MSG);
  await handleUpdate(press(m.id), ctx());
  expect(lastEdit().text).toBe(`${NOTICE} — done`);
  expect(lastEdit().reply_markup).toEqual({ inline_keyboard: [[{ text: "Open PR", url: PR }]] });
});

test("disarm-yes success on a unit-move notice keeps the Open PR link from the unit", async () => {
  const text = "baton r1/u2 moved to spine_ack";
  const k = keyboardFor({ kind: "unit-move", run: "r1", unit: "u2", stage: "spine_ack" }, T0)!;
  setMessageId(cbButtons(k).map((b) => b.callback_data), MSG);
  await handleUpdate(press(byText(k, "Disarm"), { text }), ctx());
  await handleUpdate(press(byText(lastEdit().reply_markup, "Yes"), { text: lastEdit().text as string }), ctx());
  expect(lastEdit().text).toBe(`${text} — done`);
  expect(lastEdit().reply_markup).toEqual({ inline_keyboard: [[{ text: "Open PR", url: "https://github.com/o/r/pull/7" }]] });
});

test("a success on a notice with no PR link leaves no buttons", async () => {
  const k = sendParkNotice();
  await handleUpdate(press(byText(k, "Unpark")), ctx());
  expect(lastEdit().text).toBe(`${NOTICE} — done`);
  expect("reply_markup" in lastEdit()).toBe(false);
});

test("a success on a record with no notice_kind keeps no Open PR link", async () => {
  const m = mint({ action: "merge-yes", run: "r1", unit: "u2", pr_url: PR, head_sha: HEAD }, T0);
  setMessageId([m.id], MSG);
  await handleUpdate(press(m.id), ctx());
  expect(lastEdit().text).toBe(`${NOTICE} — done`);
  expect("reply_markup" in lastEdit()).toBe(false);
});

function questionsBaton(questions: string): string {
  const root = join(dir, "baton");
  mkdirSync(join(root, "runs", "r8"), { recursive: true });
  writeFileSync(join(root, "runs", "r8", "run.json"), JSON.stringify({
    units: { u1: { stage: "build", parked: { reason: "asked", at: "2026-10-23T10:00:00Z" } } },
  }));
  writeFileSync(join(root, "runs", "r8", "events.jsonl"),
    JSON.stringify({ kind: "park", unit: "u1", reason: "asked", thread: "th-8", questions }) + "\n");
  return root;
}

async function showR8(questions: string): Promise<string> {
  process.env.BATON_STATE_DIR = questionsBaton(questions);
  const m = mint({ action: "show", run: "r8", unit: "u1", notice_kind: "unit-park" }, T0);
  setMessageId([m.id], MSG);
  await handleUpdate(press(m.id), ctx());
  return calls("sendMessage")[0]!.body.text as string;
}

test("show decodes each question element: question, then text, then header, a bare string, else its JSON", async () => {
  const encoded = JSON.stringify([
    { question: "q-field", text: "not this", header: "nor this" },
    { text: "text-field", header: "not this" },
    { header: "header-field" },
    "bare string",
    { question: "two\nlines" },
    7,
  ]);
  expect(await showR8(encoded)).toBe(
    "r8/u1\nstage: build\nreason: asked\nquestions:\n- q-field\n- text-field\n- header-field\n- bare string\n- two lines\n- 7\nthread: th-8",
  );
});

test("show prints a questions string that does not decode to an array raw", async () => {
  expect(await showR8('[{"question": "cut off')).toBe(
    'r8/u1\nstage: build\nreason: asked\nquestions: [{"question": "cut off\nthread: th-8',
  );
});

test("show prints JSON that is not an array raw, adjacent to the decoded case", async () => {
  expect(await showR8('{"question":"which db?"}')).toBe(
    'r8/u1\nstage: build\nreason: asked\nquestions: {"question":"which db?"}\nthread: th-8',
  );
});

test("a failure with a 10 000-char stderr line edits to the notice plus a cut failure, under Telegram's 4096", async () => {
  const k = sendParkNotice();
  reply = () => ({ rc: 1, stdout: "", stderr: "x".repeat(10_000) + "\n" });
  await handleUpdate(press(byText(k, "Unpark")), ctx());
  const text = lastEdit().text as string;
  expect(text.length).toBe(3501);
  expect(text.startsWith(`${NOTICE}\n\nfailed: xxx`)).toBe(true);
  expect(text.endsWith("x…")).toBe(true);
  expect(cbButtons(lastEdit().reply_markup).map((b) => b.text)).toEqual(["Unpark", "Unpark to stage…", "Show question", "Disarm"]);
});

for (const bad of [
  "https://github.com/o/r/pull/38/files",
  "https://github.com/o/r/pull/38 --admin",
  "http://github.com/o/r/pull/38",
  "https://github.com.evil/o/r/pull/38",
  "https://github.com/o/r/issues/38",
  "--admin",
]) {
  for (const action of ["merge", "merge-yes"] as const) {
    test(`${action} with pr_url ${JSON.stringify(bad)}: failed: not a PR URL, nothing runs`, async () => {
      const m = mint({ action, run: "r1", unit: "u2", pr_url: bad, head_sha: HEAD }, T0);
      setMessageId([m.id], MSG);
      await handleUpdate(press(m.id), ctx());
      expect(runs).toHaveLength(0);
      expect(lastEdit().text).toBe(`${NOTICE}\n\nfailed: not a PR URL`);
    });
  }
}

test("merge-yes with a well-formed PR URL runs gh (the control beside the refusals)", async () => {
  const m = mint({ action: "merge-yes", run: "r1", unit: "u2", pr_url: PR, head_sha: HEAD }, T0);
  setMessageId([m.id], MSG);
  await handleUpdate(press(m.id), ctx());
  expect(runs).toEqual([["gh", "pr", "merge", PR, "--merge", "--match-head-commit", HEAD]]);
});
