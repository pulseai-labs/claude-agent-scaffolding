// Upgrade inputs: what a run armed before baton 0.14.0 (which removed triage) still carries.
// The recipe fixture copies the shape of a live recipe's top-level `triage` stage, whose message uses
// {pending.*} placeholders, and its seats file names a `triage` role. Each test pins one place the
// old shape must still load, and most carry a control that must still fail.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tick } from "../src/engine.ts";
import type { Forge } from "../src/forge.ts";
import { notifyOnce } from "../src/notify.ts";
import { openStore } from "../src/state.ts";
import { FakeHost } from "./fake-host.ts";

const BIN = join(import.meta.dir, "..", "bin", "baton");
const LEGACY = join(import.meta.dir, "fixtures", "recipes", "legacy-triage.json");
const T0 = Date.parse("2026-11-01T10:00:00.000Z");
const saved = { state: process.env.BATON_STATE_DIR, config: process.env.BATON_CONFIG, home: process.env.HOME };
let root: string, state: string, clock: number, host: FakeHost;

const now = () => new Date(clock);
const at = (min: number) => { clock = T0 + min * 60_000; };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "baton-legacy-")));
  state = join(root, "state");
  mkdirSync(join(root, "home"));
  process.env.BATON_STATE_DIR = state;
  process.env.BATON_CONFIG = join(root, "config.json");
  process.env.HOME = join(root, "home");
  clock = T0;
});
afterEach(() => {
  for (const [k, v] of [["BATON_STATE_DIR", saved.state], ["BATON_CONFIG", saved.config], ["HOME", saved.home]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const noForge: Forge = {
  view: async () => { throw new Error("no forge in these tests"); },
  merge: async () => { throw new Error("no forge in these tests"); },
};

async function baton(...args: string[]) {
  const p = Bun.spawn([BIN, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const [out, err, rc] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, rc };
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const runDir = (id = "r1") => join(state, "runs", id);
const readRun = (id = "r1") => JSON.parse(readFileSync(join(runDir(id), "run.json"), "utf8"));
const writeRun = (run: unknown, id = "r1") => writeFileSync(join(runDir(id), "run.json"), JSON.stringify(run, null, 2) + "\n");
const events = (id = "r1") =>
  readFileSync(join(runDir(id), "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const doTick = () => tick({ store: openStore(state), host, forge: noForge, notify: notifyOnce, now });

const seat = (name: string) => ({
  agent: `${name}-agent`, argv: ["seat-bin", name], brief_delivery: "inject", expected_model: "m", effort: "high", env: {},
});
/** The live seats file's shape: the roles the recipe's stages use, and a `triage` one. */
const WITH_TRIAGE = { implementer: seat("implementer"), triage: seat("triage"), driver: seat("driver") };
const WITHOUT_TRIAGE = { implementer: seat("implementer") };

function writeSeats(table: unknown, name = "seats.json"): string {
  const file = join(root, name);
  writeFileSync(file, JSON.stringify(table));
  return file;
}

const params = () => [
  "--param", `root=${root}`, "--param", "ai_project=proj", "--param", "ai_root=/ai",
  "--param", "briefs=/briefs", "--param", "spine_dir=/spine",
];

async function armLegacy(id = "r1", table: unknown = WITH_TRIAGE, recipe = LEGACY) {
  mkdirSync(join(root, "w", "u1"), { recursive: true });
  const r = await baton("arm", recipe, "--run", id, ...params(), "--seats", writeSeats(table, `${id}.seats.json`), "--no-timer");
  expect(r).toMatchObject({ rc: 0, err: "" });
}

// ---- the recipe: validate, arm, the tick, clone ---------------------------------------------

test("baton validate accepts the legacy triage key, its {pending.*} placeholders included", async () => {
  expect(await baton("validate", LEGACY)).toMatchObject({ rc: 0, err: "" });
});

test("baton validate: control: {pending.*} in a stage is still refused", async () => {
  const bad = JSON.parse(readFileSync(LEGACY, "utf8"));
  bad.stages.work.message = "stuck: {pending.thread}";
  const file = join(root, "bad.json");
  writeFileSync(file, JSON.stringify(bad));
  const r = await baton("validate", file);
  expect(r.rc).toBe(2);
  expect(r.err).toContain('stages.work.message: unknown placeholder "{pending.thread}"');
});

test("arm freezes the legacy recipe byte for byte, and its digest is of those bytes", async () => {
  await armLegacy();
  const frozen = readFileSync(join(runDir(), "recipe.json"));
  expect(frozen).toEqual(readFileSync(LEGACY));
  expect(readRun().recipe_sha256).toBe(sha(frozen));
  expect(JSON.parse(frozen.toString("utf8")).triage.kind).toBe("triage"); // the key stays in the run's copy
});

test("arm needs no triage role in the seats file; a triage row in it is accepted", async () => {
  await armLegacy("with", WITH_TRIAGE);
  await armLegacy("without", WITHOUT_TRIAGE);
  expect(readFileSync(join(runDir("with"), "seats.json"), "utf8")).toContain('"triage"');
  expect(readFileSync(join(runDir("without"), "seats.json"), "utf8")).not.toContain('"triage"');
});

test("arm: control: a role a real stage names is still required, triage row or not", async () => {
  mkdirSync(join(root, "w", "u1"), { recursive: true });
  const seats = writeSeats({ triage: seat("triage"), driver: seat("driver") });
  const r = await baton("arm", LEGACY, "--run", "r1", ...params(), "--seats", seats, "--no-timer");
  expect(r.rc).toBe(2);
  expect(r.err).toContain('role table has no role "implementer" (stage work)');
  expect(existsSync(runDir())).toBe(false);
});

test("a recipe whose only role is the legacy triage's arms with no --seats", async () => {
  const rec = JSON.parse(readFileSync(LEGACY, "utf8"));
  delete rec.stages.work.role;
  rec.stages.work.instance = "inst";
  rec.stages.work.model = "mod";
  const file = join(root, "triage-role-only.json");
  writeFileSync(file, JSON.stringify(rec));
  mkdirSync(join(root, "w", "u1"), { recursive: true });
  expect(await baton("arm", file, "--run", "r1", ...params(), "--no-timer")).toMatchObject({ rc: 0, err: "" });
  // control: a role on a real stage still needs --seats
  const r = await baton("arm", LEGACY, "--run", "r2", ...params(), "--no-timer");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("recipe names roles (implementer); pass --seats <file>");
});

test("the tick reads the legacy recipe as armed: the work seat runs to done, no triage event, recipe untouched", async () => {
  await armLegacy();
  host = new FakeHost({ work: { ticks: 2, end: "completed" } }, { withOptional: true });
  await doTick();
  expect(host.launches.map((l) => l.request.nonce)).toEqual(["r1/u1/work/1"]);
  mkdirSync(join(runDir(), "out", "u1"), { recursive: true });
  writeFileSync(join(runDir(), "out", "u1", "done"), "ok");
  host.finish("thread-1", "completed");
  at(1);
  await doTick();
  expect(readRun().units.u1.stage).toBe("done");
  expect(events().map((e) => e.kind).filter((k) => /triage|pending/.test(k))).toEqual([]);
  expect(sha(readFileSync(join(runDir(), "recipe.json")))).toBe(readRun().recipe_sha256);
});

test("a waiting seat goes to the blocked park on a legacy-triage run: no model is asked, the operator is", async () => {
  await armLegacy();
  host = new FakeHost({ work: { ticks: 1000, end: "completed" } }, { withOptional: true });
  await doTick();
  host.block("thread-1");
  host.screens["thread-1"] = "Which database?\n  1. pg\n  2. sqlite";
  at(1);
  await doTick();
  expect(readRun().units.u1.parked?.reason).toBe("blocked");
  expect(host.launches.length).toBe(1); // no triage seat
  expect(host.interrupts).toEqual([]);
});

test("clone of a legacy run: recipe and seats bytes carry over, the digest is of those bytes, no triage state", async () => {
  await armLegacy();
  const run = readRun();
  run.units.u1.triaged = ["REQ-1"];
  run.units.u1.triage = { request_id: "REQ-1", session: { nonce: "r1/u1/triage/1", thread_id: "T-OLD" } };
  writeRun(run);
  const r = await baton("clone", "r1", "c1", ...params());
  expect(r).toMatchObject({ rc: 0 });
  expect(readFileSync(join(runDir("c1"), "recipe.json"))).toEqual(readFileSync(LEGACY));
  expect(readFileSync(join(runDir("c1"), "seats.json"))).toEqual(readFileSync(join(runDir("r1"), "seats.json")));
  const c = readRun("c1");
  expect(c.recipe_sha256).toBe(sha(readFileSync(LEGACY)));
  expect(c.seats_sha256).toBe(sha(readFileSync(join(runDir("r1"), "seats.json"))));
  expect(JSON.stringify(c.units)).not.toMatch(/triage|T-OLD|REQ-1/);
});

test("clone --recipe re-pins to a legacy recipe file, and refuses a broken one", async () => {
  await armLegacy();
  expect(await baton("clone", "r1", "c1", "--recipe", LEGACY, ...params())).toMatchObject({ rc: 0 });
  expect(readRun("c1").recipe_sha256).toBe(sha(readFileSync(LEGACY)));
  const bad = JSON.parse(readFileSync(LEGACY, "utf8"));
  bad.stages.work.title = "{pending.stage}";
  const file = join(root, "bad.json");
  writeFileSync(file, JSON.stringify(bad));
  const r = await baton("clone", "r1", "c2", "--recipe", file, ...params());
  expect(r.rc).toBe(2);
  expect(r.err).toContain('unknown placeholder "{pending.stage}"');
  expect(existsSync(runDir("c2"))).toBe(false);
});

// ---- state: triaged and triage on a unit ------------------------------------------------------

const OLD_TRIAGE = {
  request_id: "REQ-1",
  session: {
    nonce: "r1/u1/triage/1", claim_nonce: "r1/u1/triage/1", launch_dir: "/tmp/triage-dir", thread_id: "T-TRIAGE",
    claim_key: "k", launched_at: "2026-11-01T09:00:00.000Z", last_progress_at: "2026-11-01T09:00:00.000Z", progress_mark: "",
  },
};

test("a unit's triaged and triage fields are never read and never written: the run loads, the fields stay as they were", async () => {
  await armLegacy();
  const run = readRun();
  run.units.u1.triaged = ["REQ-1"];
  run.units.u1.triage = OLD_TRIAGE;
  writeRun(run);
  host = new FakeHost({ work: { ticks: 1000, end: "completed" } }, { withOptional: true });
  const rep = await doTick(); // launches the seat and saves
  expect(rep.errors).toEqual([]);
  expect(host.launches.length).toBe(1);
  // The unit moves through a stage entry (the work seat's done file): enterStage no longer clears them.
  mkdirSync(join(runDir(), "out", "u1"), { recursive: true });
  writeFileSync(join(runDir(), "out", "u1", "done"), "ok");
  host.finish("thread-1", "completed");
  at(1);
  await doTick();
  const u = readRun().units.u1;
  expect(u.stage).toBe("done");
  expect(u.triaged).toEqual(["REQ-1"]);
  expect(u.triage).toEqual(OLD_TRIAGE);
  // The old triage thread is not touched: not interrupted, not closed, its directory not released.
  expect(host.interrupts).toEqual([]);
  expect(host.closes.filter((t) => t === "T-TRIAGE")).toEqual([]);
  expect(host.releases.filter((r) => r.dir === "/tmp/triage-dir")).toEqual([]);
});

test("disarm of a run with a legacy triage on a unit succeeds and leaves the field alone", async () => {
  await armLegacy();
  const run = readRun();
  run.units.u1.triage = OLD_TRIAGE;
  writeRun(run);
  expect(await baton("disarm", "r1")).toMatchObject({ rc: 0, err: "" });
  expect(readRun().status).toBe("disarmed");
  expect(readRun().units.u1.triage).toEqual(OLD_TRIAGE);
});

// ---- parks the removed code made -------------------------------------------------------------

test("a unit parked for `second prompt` or `triage gave no answer` unparks in place", async () => {
  for (const reason of ["second prompt", "triage gave no answer"]) {
    await armLegacy(`p-${reason.split(" ")[0]}`);
  }
  for (const [id, reason] of [["p-second", "second prompt"], ["p-triage", "triage gave no answer"]]) {
    const run = readRun(id);
    run.units.u1.parked = { reason, at: "2026-11-01T09:30:00.000Z" };
    run.units.u1.launches = { work: 2 };
    run.units.u1.stalls = 1;
    writeRun(run, id);
    expect(await baton("unpark", id, "u1")).toMatchObject({ rc: 0, err: "" });
    const u = readRun(id).units.u1;
    expect([reason, u.parked]).toEqual([reason, undefined]);
    expect([u.stalls, u.launches.work]).toEqual([0, 0]);
    expect(events(id).at(-1)).toMatchObject({ kind: "unpark", unit: "u1" });
  }
});

test("a unit parked for `second prompt` unparks into a stage", async () => {
  await armLegacy();
  const run = readRun();
  run.units.u1.parked = { reason: "second prompt", at: "2026-11-01T09:30:00.000Z" };
  writeRun(run);
  expect(await baton("unpark", "r1", "u1", "--to", "work")).toMatchObject({ rc: 0, err: "" });
  const u = readRun().units.u1;
  expect([u.stage, u.parked]).toEqual(["work", undefined]);
});

test("control: unpark of a running unit (a live session, not parked) is still refused", async () => {
  await armLegacy();
  const run = readRun();
  run.units.u1.session = { ...OLD_TRIAGE.session, nonce: "r1/u1/work/1", thread_id: "T-LIVE" };
  writeRun(run);
  const r = await baton("unpark", "r1", "u1");
  expect(r.rc).toBe(2);
  expect(r.err).toContain("is running (live session) and not parked");
});

// ---- baton report over an old events.jsonl ------------------------------------------------------

test("baton report passes triage and pending events from an old run, and counts only what it names", async () => {
  mkdirSync(runDir("old"), { recursive: true });
  const evs = [
    { at: "2026-10-23T10:24:11.934Z", kind: "armed", recipe: "triage-live" },
    { at: "2026-10-23T10:24:12.145Z", kind: "launched", unit: "probe1", nonce: "o/probe1/probe/1", thread: "T1" },
    { at: "2026-10-23T10:24:30.000Z", kind: "pending", unit: "probe1", nonce: "o/probe1/probe/1", request: "REQ-1" },
    { at: "2026-10-23T10:24:46.359Z", kind: "triage", unit: "probe1", nonce: "o/probe1/triage/1", request: "REQ-1" },
    { at: "2026-10-23T10:26:16.641Z", kind: "triage answered", unit: "probe1", nonce: "o/probe1/triage/1", request: "REQ-1" },
    { at: "2026-10-23T10:27:00.000Z", kind: "triage relaunch", unit: "probe1", nonce: "o/probe1/probe/1", stalls: 1 },
    { at: "2026-10-23T10:28:00.000Z", kind: "triage dropped", unit: "probe1", nonce: "o/probe1/triage/2", request: "REQ-2" },
    {
      at: "2026-10-23T10:29:00.000Z", kind: "park", unit: "probe1", stage: "probe", reason: "second prompt", thread: "T1",
      questions: JSON.stringify([{ id: "q1", header: "Pick", question: "Which?", options: [{ label: "a" }] }]),
    },
    { at: "2026-10-23T10:30:00.000Z", kind: "park", unit: "probe1", stage: "probe", reason: "triage gave no answer", thread: "T1" },
    { at: "2026-10-23T10:31:00.000Z", kind: "unpark", unit: "probe1", stage: "probe" },
    { at: "2026-10-23T11:24:11.934Z", kind: "done" },
  ];
  writeFileSync(join(runDir("old"), "events.jsonl"), evs.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const r = await baton("report", "old");
  expect(r.rc).toBe(0);
  expect(r.out).toBe("launched 1\nsuccessor 0\nstall 0\npark 2\nunpark 1\nmerged 0\nwall_seconds 3600\n");
});
