// `baton answer <run> <unit> <label>`: the one answer path for a worker's pending question.
// It answers one question with one option, by the option's exact label, and nothing else.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { tick } from "../src/engine.ts";
import type { Forge } from "../src/forge.ts";
import { AnswerRefused, type PendingQuestion, type PendingRequest } from "../src/host.ts";
import { setHostForTest } from "../src/hosts/select.ts";
import { notifyOnce } from "../src/notify.ts";
import { openStore } from "../src/state.ts";
import { FakeHost } from "./fake-host.ts";

const saved = { state: process.env.BATON_STATE_DIR, config: process.env.BATON_CONFIG, home: process.env.HOME };
let root: string, state: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "baton-answer-")));
  state = join(root, "state");
  mkdirSync(join(root, "home"));
  process.env.BATON_STATE_DIR = state;
  process.env.BATON_CONFIG = join(root, "config.json");
  process.env.HOME = join(root, "home");
});
afterEach(() => {
  setHostForTest(null);
  for (const [k, v] of [["BATON_STATE_DIR", saved.state], ["BATON_CONFIG", saved.config], ["HOME", saved.home]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const noForge: Forge = {
  view: async () => { throw new Error("no forge in these tests"); },
  merge: async () => { throw new Error("no forge in these tests"); },
};

const recipe = {
  version: 1, name: "rec", params: ["root"], sources: [], seed: [{ id: "a", stage: "work" }],
  stages: {
    work: {
      kind: "session", instance: "inst", model: "mod", project: "proj",
      cwd: "{param.root}/w/{unit.id}", title: "t {unit.id}", message: "go {unit.id}",
      env: {}, handoff: null,
      outcomes: [{ when: [{ file: "{run.dir}/out/{unit.id}.done" }], to: "done" }],
    },
  },
};

const question = (over: Partial<PendingQuestion> = {}): PendingQuestion => ({
  id: "q1", header: "Pick", question: "Proceed?", options: [{ label: "Yes" }, { label: "No", description: "stop" }], ...over,
});
const request = (...qs: PendingQuestion[]): PendingRequest => ({ id: "req-1", questions: qs.length ? qs : [question()] });

/** Arm one unit and launch it, so it has a session on thread-1; returns the host. */
async function launched(opts: { withOptional?: boolean } = { withOptional: true }): Promise<FakeHost> {
  const file = join(root, "r1.recipe.json");
  writeFileSync(file, JSON.stringify(recipe));
  mkdirSync(join(root, "w", "a"), { recursive: true });
  expect(await main(["arm", file, "--run", "r1", "--param", `root=${root}`, "--no-timer"])).toBe(0);
  const host = new FakeHost({ work: { ticks: 100, end: "completed" } }, opts);
  await tick({ store: openStore(state), host, forge: noForge, notify: notifyOnce, now: () => new Date() });
  setHostForTest(host);
  return host;
}

/** `main(argv)` with stderr captured. */
async function run(...argv: string[]): Promise<{ rc: number; err: string }> {
  const real = process.stderr.write;
  let err = "";
  process.stderr.write = ((s: string | Uint8Array) => { err += String(s); return true; }) as typeof process.stderr.write;
  try {
    return { rc: await main(argv), err };
  } finally {
    process.stderr.write = real;
  }
}

const events = () =>
  readFileSync(join(state, "runs", "r1", "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("answer sends the exact label", async () => {
  const host = await launched();
  host.raise("thread-1", request());
  const r = await run("answer", "r1", "a", "Yes");
  expect(r).toEqual({ rc: 0, err: "" });
  expect(host.answers).toEqual([{ threadId: "thread-1", requestId: "req-1", answers: { q1: "Yes" } }]);
  const ev = events().find((e) => e.kind === "answered");
  expect(ev).toMatchObject({ kind: "answered", unit: "a", request: "req-1", label: "Yes" });
});

test("answer sends the label it was given, not the first option", async () => {
  const host = await launched();
  host.raise("thread-1", request());
  expect((await run("answer", "r1", "a", "No")).rc).toBe(0);
  expect(host.answers).toEqual([{ threadId: "thread-1", requestId: "req-1", answers: { q1: "No" } }]);
});

test("answer refuses a label that differs in case or spacing, and sends nothing", async () => {
  const host = await launched();
  host.raise("thread-1", request());
  for (const bad of ["yes", "YES", "Yes ", " Yes", "Y es", "Yes\n"]) {
    const r = await run("answer", "r1", "a", bad);
    expect([bad, r.rc]).toEqual([bad, 2]);
    expect(r.err).toContain(`no option labelled "${bad}"`);
  }
  expect(host.answers).toEqual([]);
  expect(events().some((e) => e.kind === "answered")).toBe(false);
  // The control: the exact label, in the same state, goes through.
  expect((await run("answer", "r1", "a", "Yes")).rc).toBe(0);
  expect(host.answers.length).toBe(1);
});

test("answer refuses several questions", async () => {
  const host = await launched();
  host.raise("thread-1", request(question(), question({ id: "q2" })));
  const r = await run("answer", "r1", "a", "Yes");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("several questions");
  expect(host.answers).toEqual([]);
});

test("answer refuses multi-select", async () => {
  const host = await launched();
  host.raise("thread-1", request(question({ multiSelect: true })));
  const r = await run("answer", "r1", "a", "Yes");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("multi-select");
  expect(host.answers).toEqual([]);
  // The control: multiSelect false is a single choice and goes through.
  host.raise("thread-1", request(question({ multiSelect: false })));
  expect((await run("answer", "r1", "a", "Yes")).rc).toBe(0);
});

test("answer refuses with no pending request", async () => {
  const host = await launched();
  const r = await run("answer", "r1", "a", "Yes");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("no pending request");
  expect(host.answers).toEqual([]);
});

test("answer refuses on a host without respond", async () => {
  const host = await launched({ withOptional: false });
  host.raise("thread-1", request());
  const r = await run("answer", "r1", "a", "Yes");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("host cannot answer");
  expect(host.answers).toEqual([]);
});

test("answer refuses a unit with no live session", async () => {
  const host = await launched();
  host.raise("thread-1", request());
  const st = openStore(state);
  const r1 = st.readRun("r1");
  delete r1.units.a.session;
  st.writeRun(r1);
  const r = await run("answer", "r1", "a", "Yes");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("no live session");
  expect(host.answers).toEqual([]);
});

test("answer refuses an unknown run or unit, and a wrong argument count is usage", async () => {
  await launched();
  expect((await run("answer", "nope", "a", "Yes")).err).toContain("no such run: nope");
  expect((await run("answer", "r1", "nope", "Yes")).err).toContain("no such unit: nope");
  expect((await run("answer", "r1", "constructor", "Yes")).rc).toBe(2);
  expect((await run("answer", "r1", "a")).rc).toBe(64);
});

test("host down is rc 4, and nothing is recorded", async () => {
  const host = await launched();
  host.raise("thread-1", request());
  host.down = "unreachable";
  const r = await run("answer", "r1", "a", "Yes");
  expect(r.rc).toBe(4);
  expect(host.answers).toEqual([]);
  expect(events().some((e) => e.kind === "answered")).toBe(false);
});

test("a host that refuses the answer is rc 2 and records no event", async () => {
  const host = await launched();
  host.raise("thread-1", request());
  host.respond = async () => { throw new AnswerRefused("request already answered"); };
  const r = await run("answer", "r1", "a", "Yes");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("request already answered");
  expect(events().some((e) => e.kind === "answered")).toBe(false);
});
