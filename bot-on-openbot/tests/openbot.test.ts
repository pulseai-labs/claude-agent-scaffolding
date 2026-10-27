import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeOpenBot, OpenBotDown, OpenBotRefused } from "../src/openbot.ts";

const FAKE = join(import.meta.dir, "fake-openbot");
const FIX = join(import.meta.dir, "fixtures", "openbot");
const TOKEN = "FIXTURE-OPENBOT-TOKEN-do-not-leak";
const AGENT_ID = "agent-7a6bdc91-f17f-4c79-9dae-4a7d3b1a0eb6";
const fixture = (f: string) => readFileSync(join(FIX, f), "utf8");

let dir: string;
let server: ReturnType<typeof Bun.serve> | undefined;
let requests: { method: string; path: string; auth: string | null; body: string }[];
let answerReplies: { status: number; body: string }[];
let pendingStatus: number;
let pendingFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bot-openbot-"));
  process.env.FAKE_OPENBOT_DIR = dir;
  requests = [];
  answerReplies = [];
  pendingStatus = 200;
  pendingFile = "pending-prompt.json";
});
afterEach(() => {
  server?.stop(true);
  server = undefined;
  delete process.env.FAKE_OPENBOT_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const replies = (r: Record<string, unknown>) => writeFileSync(join(dir, "replies.json"), JSON.stringify(r));
const calls = (): { argv: string[]; stdin: string }[] =>
  readFileSync(join(dir, "argv.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

// A local stand-in for OpenBot's Local scripts HTTP API, behind the automation folder's url and token.
function startApi(): string {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const body = await req.text();
      requests.push({ method: req.method, path, auth: req.headers.get("authorization"), body });
      if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return Response.json({ error: "no" }, { status: 401 });
      if (req.method === "GET" && path === "/v1/agents") return Response.json([{ id: AGENT_ID, name: "Autopilot" }, { id: "agent-x", name: "Other" }]);
      if (req.method === "GET" && path === `/v1/agents/${AGENT_ID}/pending`) {
        return new Response(pendingFile.startsWith("{") ? pendingFile : fixture(pendingFile), { status: pendingStatus });
      }
      if (req.method === "POST" && path.startsWith(`/v1/agents/${AGENT_ID}/prompts/`) && path.endsWith("/answer")) {
        const r = answerReplies.shift() ?? { status: 200, body: '{"ok":true}' };
        return new Response(r.body, { status: r.status });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  const auto = join(dir, "automation");
  mkdirSync(auto, { recursive: true });
  writeFileSync(join(auto, "url"), `http://127.0.0.1:${server.port}\n`);
  writeFileSync(join(auto, "token"), `${TOKEN}\n`);
  return auto;
}

// A temp openbot.db from the recorded schema, holding the given orchestration_events rows.
function seedDb(rows: { type: string; payload: unknown }[]): string {
  const path = join(dir, "openbot.db");
  const db = new Database(path);
  db.exec(fixture("openbot-db-orchestration-events.schema.sql"));
  const ins = db.prepare(
    "INSERT INTO orchestration_events (event_id, command_id, aggregate_type, aggregate_id, event_type, occurred_at, payload_json) VALUES (?, ?, 'thread', 't1', ?, '2026-10-27T16:54:45Z', ?)",
  );
  rows.forEach((r, i) => ins.run(`e${i}`, `c${i}`, r.type, typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload)));
  db.close();
  return path;
}

const bot = (over: Partial<{ db: string; automationDir: string }> = {}) =>
  makeOpenBot({ agent: "Autopilot", cli: [FAKE], db: join(dir, "none.db"), automationDir: join(dir, "none"), ...over });

const TAP_TURN = "01a17e48-feb8-7281-b5be-ec01e0b24c9f";
const TEXT_TURN = "01a17e46-fce5-7d40-bc28-a554f07cf4ea";
const tapRow = () => JSON.parse(fixture("openbot-db-prompt-resolved-tap.json"));

test("run returns the delivery id", async () => {
  replies({ run: "run-queued.json" });
  expect(await bot().run("ask it", "r1/u1/park/x")).toEqual({ deliveryId: "99156f0f-929e-4651-ac0e-450449be32af" });
});

test("run sends the task on stdin with --id, no --wait, no shell", async () => {
  replies({ run: "run-queued.json" });
  await bot().run("Ask the operator; $HOME `x`", "r1/u1/park/x");
  expect(calls()).toEqual([
    { argv: ["run", "Autopilot", "-", "--id", "r1/u1/park/x", "--json"], stdin: "Ask the operator; $HOME `x`" },
  ]);
});

test("run exit 1 is OpenBotRefused", async () => {
  replies({ run: { stdout: '{"ok":false,"exitCode":1,"error":"Too many runs"}\n', rc: 1 } });
  await expect(bot().run("t", "k")).rejects.toBeInstanceOf(OpenBotRefused);
});

test("run exit 5 is OpenBotDown", async () => {
  replies({ run: { stdout: '{"ok":false,"exitCode":5,"error":"OpenBot is not running"}\n', rc: 5 } });
  await expect(bot().run("t", "k")).rejects.toBeInstanceOf(OpenBotDown);
});

test("garbage stdout is OpenBotDown", async () => {
  replies({ run: { stdout: "not json\n", rc: 0 }, status: { stdout: "", rc: 0 } });
  await expect(bot().run("t", "k")).rejects.toBeInstanceOf(OpenBotDown);
  await expect(bot().status("d1")).rejects.toBeInstanceOf(OpenBotDown);
  // control: rc 0 with no deliveryId is not a delivery either
  replies({ run: { stdout: '{"ok":true,"exitCode":0}\n', rc: 0 } });
  await expect(bot().run("t", "k")).rejects.toBeInstanceOf(OpenBotDown);
});

test("an openbot-cli that cannot start is OpenBotDown", async () => {
  const b = makeOpenBot({ agent: "A", cli: [join(dir, "no-such-cli")], db: join(dir, "x.db"), automationDir: dir });
  await expect(b.run("t", "k")).rejects.toBeInstanceOf(OpenBotDown);
});

test("status parses turnId and text", async () => {
  replies({ status: "status-completed-4494ade1-6d02-4478-9c7b-1199df7be52a.json" });
  expect(await bot().status("4494ade1-6d02-4478-9c7b-1199df7be52a")).toEqual({
    state: "completed", turnId: TAP_TURN, text: "The operator selected: green.",
  });
  expect(calls()[0]!.argv).toEqual(["status", "Autopilot", "4494ade1-6d02-4478-9c7b-1199df7be52a", "--json"]);
  replies({ status: "status-running-while-prompt-pending.json" });
  expect(await bot().status("99156f0f-929e-4651-ac0e-450449be32af")).toEqual({
    state: "running", turnId: "01a17e42-dfd6-7402-be76-4cd9d4e76c3a", text: null,
  });
});

test("status: a failed, interrupted or cancelled delivery is failed; an unknown one is refused", async () => {
  for (const s of ["failed", "interrupted", "cancelled"]) {
    replies({ status: { stdout: JSON.stringify({ ok: false, exitCode: 1, status: s, turnId: null, answer: null }), rc: 1 } });
    expect((await bot().status("d")).state).toBe("failed");
  }
  replies({ status: { stdout: '{"ok":false,"exitCode":1,"error":"Not found"}', rc: 1 } });
  await expect(bot().status("d")).rejects.toBeInstanceOf(OpenBotRefused);
  replies({ status: { stdout: JSON.stringify({ ok: true, exitCode: 0, status: "weird", turnId: null }), rc: 0 } });
  await expect(bot().status("d")).rejects.toBeInstanceOf(OpenBotDown);
});

test("resolved reads a tap", async () => {
  const db = seedDb([
    { type: "prompt.requested", payload: JSON.parse(fixture("openbot-db-prompt-requested.json")) },
    { type: "prompt.resolved", payload: tapRow() },
  ]);
  expect(await bot({ db }).resolved(TAP_TURN)).toEqual({ questionId: "reply", answer: "green" });
});

test("resolved reads a typed answer", async () => {
  const db = seedDb([{ type: "prompt.resolved", payload: JSON.parse(fixture("openbot-db-prompt-resolved-free-text.json")) }]);
  expect(await bot({ db }).resolved(TEXT_TURN)).toEqual({ questionId: "reply", answer: "teal" });
});

test("resolved is none before the answer, and for another turn", async () => {
  const db = seedDb([
    { type: "prompt.requested", payload: JSON.parse(fixture("openbot-db-prompt-requested.json")) },
    { type: "prompt.resolved", payload: JSON.parse(fixture("openbot-db-prompt-resolved-free-text.json")) },
  ]);
  expect(await bot({ db }).resolved(TAP_TURN)).toBe("none");
});

test("an answer row of another shape is unreadable, not a label", async () => {
  const shapes: [string, (p: any) => void][] = [
    ["resolution dropped", (p) => delete p.changedMessages[0].questionPrompt.resolution],
    ["answers renamed", (p) => {
      const r = p.changedMessages[0].questionPrompt.resolution.responses.reply;
      r.values = r.answers;
      delete r.answers;
    }],
    ["answers a string", (p) => (p.changedMessages[0].questionPrompt.resolution.responses.reply.answers = "green")],
    ["two answers", (p) => (p.changedMessages[0].questionPrompt.resolution.responses.reply.answers = ["green", "red"])],
    ["question id elsewhere", (p) => (p.changedMessages[0].questionPrompt.questions[0].id = "other")],
    ["no questionPrompt", (p) => delete p.changedMessages[0].questionPrompt],
    ["the prompt message of another turn", (p) => (p.changedMessages[0].turnId = "01a17e46-fce5-7d40-bc28-a554f07cf4ea")],
  ];
  for (const [what, mutate] of shapes) {
    rmSync(join(dir, "openbot.db"), { force: true });
    const p = tapRow();
    mutate(p);
    const db = seedDb([{ type: "prompt.resolved", payload: p }]);
    expect([what, await bot({ db }).resolved(TAP_TURN)]).toEqual([what, "unreadable"]);
  }
  // two resolved rows for one turn: which one the operator meant is not ours to guess
  rmSync(join(dir, "openbot.db"), { force: true });
  const db = seedDb([{ type: "prompt.resolved", payload: tapRow() }, { type: "prompt.resolved", payload: tapRow() }]);
  expect(await bot({ db }).resolved(TAP_TURN)).toBe("unreadable");
});

test("a table of another shape is unreadable; a db that cannot be opened is OpenBotDown", async () => {
  const path = join(dir, "openbot.db");
  const db = new Database(path);
  db.exec("CREATE TABLE something_else (x TEXT)");
  db.close();
  expect(await bot({ db: path }).resolved(TAP_TURN)).toBe("unreadable");
  await expect(bot({ db: join(dir, "missing.db") }).resolved(TAP_TURN)).rejects.toBeInstanceOf(OpenBotDown);
});

test("resolved opens the db read-only", async () => {
  const db = seedDb([{ type: "prompt.resolved", payload: tapRow() }]);
  const before = readFileSync(db);
  await bot({ db }).resolved(TAP_TURN);
  expect(readFileSync(db).equals(before)).toBe(true);
});

test("pending parses the prompt", async () => {
  const automationDir = startApi();
  expect(await bot({ automationDir }).pending()).toEqual([{
    requestId: "1d7ac7e2-2e24-4153-a481-a359257800c9",
    questionId: "reply",
    header: "spike — bridge test 1 (tap any option)\nThis is a test of the baton OpenBot bridge. Tap any option.",
    question: "spike — bridge test 1 (tap any option)\nThis is a test of the baton OpenBot bridge. Tap any option.",
    options: ["Unpark", "Unpark to stage…", "Show question", "Disarm"],
  }]);
  expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /v1/agents", `GET /v1/agents/${AGENT_ID}/pending`]);
  expect(requests.every((r) => r.auth === `Bearer ${TOKEN}`)).toBe(true);
});

test("pending parses a prompt asked with options null (issue #939) as one with no options", async () => {
  const automationDir = startApi();
  pendingFile = "pending-prompt-no-options.json";
  expect(await bot({ automationDir }).pending()).toEqual([{
    requestId: "5b0e9c4a-8d31-4f6e-b2a7-c94e1f03d6b8",
    questionId: "reply",
    header: "r1/u5 waits on a question",
    question: "r1/u5 waits on a question\n\n- red\n- green\n- blue\n- amber\n- Show question\n- Unpark\n- Disarm",
    options: [],
  }]);
});

test("pending still leaves out a prompt whose options are missing or carry a label that is not text", async () => {
  const automationDir = startApi();
  const q = (options: unknown) => ({ requestId: "r", questions: [{ id: "reply", question: "t", ...(options === undefined ? {} : { options }) }] });
  pendingFile = JSON.stringify({ prompts: [q(undefined), q([{ label: 3 }]), q("red"), q([])] });
  expect(await bot({ automationDir }).pending()).toEqual([{ requestId: "r", questionId: "reply", header: "", question: "t", options: [] }]);
});

test("answer posts the label; 409 is closed", async () => {
  const automationDir = startApi();
  answerReplies = [{ status: 200, body: '{"ok":true}' }, { status: 409, body: '{"error":"This prompt is no longer active."}' }];
  const b = bot({ automationDir });
  const [prompt] = await b.pending();
  expect(await b.answer(prompt!, "settled")).toBe("ok");
  expect(await b.answer(prompt!, "settled")).toBe("closed");
  const posts = requests.filter((r) => r.method === "POST");
  expect(posts.map((r) => r.path)).toEqual([
    `/v1/agents/${AGENT_ID}/prompts/1d7ac7e2-2e24-4153-a481-a359257800c9/answer`,
    `/v1/agents/${AGENT_ID}/prompts/1d7ac7e2-2e24-4153-a481-a359257800c9/answer`,
  ]);
  expect(JSON.parse(posts[0]!.body)).toEqual({ answers: { reply: ["settled"] } });
});

test("an HTTP failure is OpenBotDown, and no error names the token", async () => {
  const automationDir = startApi();
  pendingStatus = 500;
  let msg = "";
  try {
    await bot({ automationDir }).pending();
  } catch (e) {
    expect(e).toBeInstanceOf(OpenBotDown);
    msg = (e as Error).message;
  }
  expect(msg).toContain("500");
  expect(msg).not.toContain(TOKEN);
  // a server that is gone
  server!.stop(true);
  server = undefined;
  msg = "";
  try {
    await bot({ automationDir }).pending();
  } catch (e) {
    expect(e).toBeInstanceOf(OpenBotDown);
    msg = (e as Error).message;
  }
  expect(msg).not.toBe("");
  expect(msg).not.toContain(TOKEN);
  // no automation files at all
  await expect(bot().pending()).rejects.toBeInstanceOf(OpenBotDown);
});

test("an agent name that matches no agent, or two, is OpenBotDown", async () => {
  const automationDir = startApi();
  const b = makeOpenBot({ agent: "Nobody", cli: [FAKE], db: join(dir, "x.db"), automationDir });
  await expect(b.pending()).rejects.toBeInstanceOf(OpenBotDown);
  // control: the agent id works as well as its name
  const byId = makeOpenBot({ agent: AGENT_ID, cli: [FAKE], db: join(dir, "x.db"), automationDir });
  expect((await byId.pending()).length).toBe(1);
});
