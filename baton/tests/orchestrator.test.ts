// `baton notify-orchestrator` and `baton orchestrator` (#1045). Every test runs against a temp
// state dir and config with HOME in a temp dir, and the `orca` CLI is tests/fake-orca: the real
// binary is never reached, and nothing here sends to a real terminal.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../src/notify.ts";
import { noticeFileName, noticeLine, runOfKey } from "../src/hosts/orchestrator.ts";

const BIN = join(import.meta.dir, "..", "bin", "baton");
const FAKE_ORCA = join(import.meta.dir, "fake-orca");
const RELAY = join(import.meta.dir, "fixtures", "recipes", "relay.json");
const PARAMS = ["--param", "project=/p", "--param", "repo=o/r"];

const root = mkdtempSync(join(tmpdir(), "baton-orch-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Rig = { state: string; cfg: string; orca: string; home: string; fb: string };
let n = 0;
/** A fresh state dir with run `r1` armed, a config naming fake-orca and an argv-logging fallback. */
async function rig(opts: { fallback?: boolean; replies?: Record<string, unknown> } = {}): Promise<Rig> {
  const dir = join(root, `rig${n++}`);
  const r = { state: join(dir, "state"), cfg: join(dir, "config.json"), orca: join(dir, "orca"), home: join(dir, "home"), fb: join(dir, "fallback.log") };
  for (const d of [r.state, r.orca, r.home]) mkdirSync(d, { recursive: true });
  const config: Record<string, unknown> = { orca: { cli: FAKE_ORCA } };
  if (opts.fallback !== false) config.fallback_notify = ["sh", "-c", `printf '%s|%s\\n' "$1" "$2" >> '${r.fb}'`, "sh", "{key}", "{message}"];
  writeFileSync(r.cfg, JSON.stringify(config));
  const replies: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.replies ?? {})) {
    const f = `${k.replaceAll(" ", "_")}.json`;
    writeFileSync(join(r.orca, f), typeof v === "string" ? v : JSON.stringify(v));
    replies[k] = f;
  }
  writeFileSync(join(r.orca, "replies.json"), JSON.stringify(replies));
  expect((await baton(r, ["arm", RELAY, "--run", "r1", ...PARAMS, "--no-timer"])).rc).toBe(0);
  return r;
}
async function baton(r: Rig, args: string[], env: Record<string, string> = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("ORCA_")));
  const p = Bun.spawn([BIN, ...args], {
    stdout: "pipe", stderr: "pipe",
    env: { ...clean, HOME: r.home, BATON_STATE_DIR: r.state, BATON_CONFIG: r.cfg, FAKE_ORCA_DIR: r.orca, ...env },
  });
  const [out, err, rc] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, rc };
}

const STATUS = (id: string) => ({ ok: true, result: { runtime: { runtimeId: id } } });
const SEND_OK = { ok: true, result: { send: { handle: "term_x", accepted: true, bytesWritten: 1 } } };
const SEND_QUEUED = { ok: true, result: { send: { handle: "term_x", accepted: true, bytesWritten: 1 }, prompt: { stages: ["queued"] } } };
const SEND_STALE = readFileSync(join(import.meta.dir, "fixtures", "orca", "terminal-read-stale.json"), "utf8");
const INC = "3f18793b-5ec5-4097-b843-eccc53069cd4";
const HANDLE = "term_a5d05a7d-f1f5-43ac-aef2-48e92e16e190";
const KEY = "r1/w1/park/2026-11-03T10:00:00.000Z";
const MSG = "baton r1/w1 parked in implement: SEATTEXT stop";

const register = (r: Rig) => baton(r, ["orchestrator", "r1"], { ORCA_TERMINAL_HANDLE: HANDLE, ORCA_RUNTIME_SOURCE_INCARNATION: INC });
const orcaCalls = (r: Rig): string[][] =>
  existsSync(join(r.orca, "argv.jsonl")) ? readFileSync(join(r.orca, "argv.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
const fallbackLines = (r: Rig): string[] => (existsSync(r.fb) ? readFileSync(r.fb, "utf8").trim().split("\n") : []);
const noticeFile = (r: Rig) => join(r.state, "runs", "r1", "notices", noticeFileName(KEY));
const mode = (p: string) => statSync(p).mode & 0o777;

describe("which run a key names", () => {
  const saved = process.env.BATON_STATE_DIR;
  const state = join(root, "keys");
  beforeAll(() => {
    process.env.BATON_STATE_DIR = state;
    mkdirSync(join(state, "runs", "r0-s1"), { recursive: true });
    writeFileSync(join(state, "runs", "r0-s1", "run.json"), "{}");
    for (const name of ["auth", "down"]) { // runs named like the host-wide prefixes
      mkdirSync(join(state, "runs", name), { recursive: true });
      writeFileSync(join(state, "runs", name, "run.json"), "{}");
    }
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.BATON_STATE_DIR;
    else process.env.BATON_STATE_DIR = saved;
  });

  // every notifyOnce call site in engine.ts: unit park (435, 866, 1231), run park (714), outcome note (447), done (1396)
  test.each([
    ["r0-s1/w1/park/2026-11-03T10:00:00.000Z", "r0-s1"],
    ["r0-s1/spine-pr/park/2026-11-03T10:00:00.000Z", "r0-s1"],
    ["r0-s1/run/park/2026-11-03T10:00:00.000Z", "r0-s1"],
    ["r0-s1/spine-pr/spine_ack/2026-11-03T10:00:00.000Z", "r0-s1"],
    ["r0-s1/done", "r0-s1"],
  ])("run-scoped %s", (key, run) => {
    expect(runOfKey(key)).toBe(run);
  });

  // host-wide keys (engine.ts 206, 216); runs named `auth` and `down` exist here, so the day shape decides
  test.each([["auth/2026-11-03"], ["down/2026-11-03"]])("host-wide %s names no run", (key) => {
    expect(runOfKey(key)).toBeUndefined();
  });

  test("control: a run named auth is still reachable by its own keys", () => {
    expect(runOfKey("auth/w1/park/2026-11-03T10:00:00.000Z")).toBe("auth");
    expect(runOfKey("auth/done")).toBe("auth");
  });

  test.each([
    ["nosuchrun/w1/park/x"], ["r0-s1"], [""], ["../r0-s1/w1/park/x"], ["R0-S1/w1/park/x"],
    ["constructor/w1/park/x"], ["__proto__/w1/park/x"], ["/w1/park/x"],
  ])("%j names no run", (key) => {
    expect(runOfKey(key)).toBeUndefined();
  });

  test("a key is one file name with no separator", () => {
    expect(noticeFileName("r0-s1/w1/park/2026-11-03T10:00:00.000Z")).toBe("r0-s1_w1_park_2026-11-03T10_00_00.000Z.md");
    expect(noticeFileName("../../x")).not.toContain("/");
    expect(noticeFileName("a b'c")).toBe("a_b_c.md");
  });
});

describe("baton orchestrator", () => {
  test("registers the terminal: handle and incarnation from the env, mode 600", async () => {
    const r = await rig();
    expect((await register(r)).rc).toBe(0);
    const p = join(r.state, "runs", "r1", "orchestrator");
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ handle: HANDLE, incarnation: INC });
    expect(mode(p)).toBe(0o600);
  });

  test("refuses loudly when either variable is unset, and writes nothing", async () => {
    const r = await rig();
    for (const env of [{ ORCA_TERMINAL_HANDLE: HANDLE }, { ORCA_RUNTIME_SOURCE_INCARNATION: INC }, {}]) {
      const x = await baton(r, ["orchestrator", "r1"], env);
      expect(x.rc).toBe(2);
      expect(x.err).toContain("ORCA_TERMINAL_HANDLE and ORCA_RUNTIME_SOURCE_INCARNATION must both be set");
    }
    expect(existsSync(join(r.state, "runs", "r1", "orchestrator"))).toBe(false);
  });

  test("a run that does not exist, or a malformed id, is refused", async () => {
    const r = await rig();
    const env = { ORCA_TERMINAL_HANDLE: HANDLE, ORCA_RUNTIME_SOURCE_INCARNATION: INC };
    expect((await baton(r, ["orchestrator", "nope"], env))).toMatchObject({ rc: 2, err: "no such run: nope\n" });
    expect((await baton(r, ["orchestrator", "../r1"], env)).rc).toBe(2);
    expect((await baton(r, ["orchestrator", "constructor"], env)).rc).toBe(2);
    expect(existsSync(join(r.state, "runs", "nope"))).toBe(false);
  });

  test("--clear removes the pointer, and clearing none is not an error", async () => {
    const r = await rig();
    await register(r);
    expect((await baton(r, ["orchestrator", "r1", "--clear"])).rc).toBe(0);
    expect(existsSync(join(r.state, "runs", "r1", "orchestrator"))).toBe(false);
    expect((await baton(r, ["orchestrator", "r1", "--clear"])).rc).toBe(0);
    expect((await baton(r, ["orchestrator", "nope", "--clear"])).rc).toBe(2);
  });

  test("any other argument shape is usage, rc 64", async () => {
    const r = await rig();
    for (const args of [["orchestrator"], ["orchestrator", "r1", "r2"], ["orchestrator", "r1", "--clear", "--clear"], ["orchestrator", "r1", "--nope"], ["orchestrator", "--clear"]]) {
      expect([args, (await baton(r, args)).rc]).toEqual([args, 64]);
    }
  });

  test("the usage text names both verbs", async () => {
    const r = await rig();
    const u = (await baton(r, [])).err;
    expect(u).toContain("baton orchestrator <run> [--clear]");
    expect(u).toContain("baton notify-orchestrator <key> <message>");
  });
});

describe("baton notify-orchestrator", () => {
  test("sends the orchestrator one tagged line naming a file; no seat text in it; a receipt is no fallback", async () => {
    const r = await rig({ replies: { "status --json": STATUS(INC), "terminal send": SEND_OK } });
    await register(r);
    const x = await baton(r, ["notify-orchestrator", KEY, MSG]);
    expect(x.rc).toBe(0);
    const file = noticeFile(r);
    const text = `[crew message baton] baton notice ${KEY}: read ${file} and follow running-a-spine-on-baton §Notices.`;
    expect(noticeLine(KEY, file)).toBe(text);
    expect(orcaCalls(r)).toEqual([
      ["status", "--json"],
      ["terminal", "send", "--terminal", HANDLE, "--enter", "--wait-submit", "5", "--text", text, "--json"],
    ]);
    expect(orcaCalls(r)[1].join(" ")).not.toContain("SEATTEXT");
    expect(readFileSync(file, "utf8")).toBe(MSG + "\n");
    expect(mode(file)).toBe(0o600);
    expect(fallbackLines(r)).toEqual([]);
  });

  test("a queued receipt counts as sent: the fallback does not also fire", async () => {
    const r = await rig({ replies: { "status --json": STATUS(INC), "terminal send": SEND_QUEUED } });
    await register(r);
    await baton(r, ["notify-orchestrator", KEY, MSG]);
    expect(orcaCalls(r).filter((c) => c[1] === "send")).toHaveLength(1);
    expect(fallbackLines(r)).toEqual([]);
  });

  test("an existing notice file with a loose mode is rewritten at 600", async () => {
    const r = await rig({ replies: { "status --json": STATUS(INC), "terminal send": SEND_OK } });
    await register(r);
    mkdirSync(join(r.state, "runs", "r1", "notices"), { recursive: true });
    writeFileSync(noticeFile(r), "old", { mode: 0o644 });
    await baton(r, ["notify-orchestrator", KEY, MSG]);
    expect(mode(noticeFile(r))).toBe(0o600);
    expect(readFileSync(noticeFile(r), "utf8")).toBe(MSG + "\n");
  });

  test("terminal_handle_stale from the send runs the fallback with the rendered key and message", async () => {
    const r = await rig({ replies: { "status --json": STATUS(INC), "terminal send": SEND_STALE } });
    await register(r);
    expect((await baton(r, ["notify-orchestrator", KEY, MSG])).rc).toBe(0);
    expect(orcaCalls(r).filter((c) => c[1] === "send")).toHaveLength(1); // never resent
    expect(fallbackLines(r)).toEqual([`${KEY}|${MSG}`]);
  });

  test("a different Orca incarnation is lost: no send, the fallback runs", async () => {
    const r = await rig({ replies: { "status --json": STATUS("00000000-0000-0000-0000-000000000000"), "terminal send": SEND_OK } });
    await register(r);
    await baton(r, ["notify-orchestrator", KEY, MSG]);
    expect(orcaCalls(r)).toEqual([["status", "--json"]]);
    expect(fallbackLines(r)).toEqual([`${KEY}|${MSG}`]);
  });

  test("control: an unreadable status decides nothing, the send goes ahead", async () => {
    const r = await rig({ replies: { "terminal send": SEND_OK } }); // fake-orca has no reply for status: rc 2, no JSON
    await register(r);
    await baton(r, ["notify-orchestrator", KEY, MSG]);
    expect(orcaCalls(r).map((c) => c[0])).toEqual(["status", "terminal"]);
    expect(fallbackLines(r)).toEqual([]);
  });

  test("an Orca that answers with garbage runs the fallback", async () => {
    const r = await rig({ replies: { "status --json": STATUS(INC), "terminal send": SEND_OK } });
    await register(r);
    await baton(r, ["notify-orchestrator", KEY, MSG], { FAKE_ORCA_GARBAGE: "1" });
    expect(fallbackLines(r)).toEqual([`${KEY}|${MSG}`]);
  });

  test("no pointer: no orca call, the notice file is written, the fallback runs", async () => {
    const r = await rig({ replies: { "status --json": STATUS(INC), "terminal send": SEND_OK } });
    await baton(r, ["notify-orchestrator", KEY, MSG]);
    expect(orcaCalls(r)).toEqual([]);
    expect(existsSync(noticeFile(r))).toBe(true);
    expect(fallbackLines(r)).toEqual([`${KEY}|${MSG}`]);
  });

  test("a cleared pointer sends nothing to the old terminal", async () => {
    const r = await rig({ replies: { "status --json": STATUS(INC), "terminal send": SEND_OK } });
    await register(r);
    await baton(r, ["orchestrator", "r1", "--clear"]);
    await baton(r, ["notify-orchestrator", KEY, MSG]);
    expect(orcaCalls(r)).toEqual([]);
    expect(fallbackLines(r)).toEqual([`${KEY}|${MSG}`]);
  });

  test.each(["auth/2026-11-03", "down/2026-11-03"])("host-wide key %s goes to the fallback only", async (key) => {
    const r = await rig({ replies: { "status --json": STATUS(INC), "terminal send": SEND_OK } });
    await register(r);
    await baton(r, ["notify-orchestrator", key, "host auth rejected"]);
    expect(orcaCalls(r)).toEqual([]);
    expect(existsSync(join(r.state, "runs", "r1", "notices"))).toBe(false);
    expect(fallbackLines(r)).toEqual([`${key}|host auth rejected`]);
  });

  test("a key of no run on this host goes to the fallback only", async () => {
    const r = await rig({ replies: { "status --json": STATUS(INC), "terminal send": SEND_OK } });
    await register(r);
    await baton(r, ["notify-orchestrator", "other/w1/park/x", "m"]);
    expect(orcaCalls(r)).toEqual([]);
    expect(fallbackLines(r)).toEqual(["other/w1/park/x|m"]);
  });

  test("fallback_notify unset: a failed send ends quietly with rc 0", async () => {
    const r = await rig({ fallback: false, replies: { "status --json": STATUS(INC), "terminal send": SEND_STALE } });
    await register(r);
    const x = await baton(r, ["notify-orchestrator", KEY, MSG]);
    expect(x).toMatchObject({ rc: 0, out: "", err: "" });
    expect(fallbackLines(r)).toEqual([]);
    expect(existsSync(noticeFile(r))).toBe(true);
  });

  test("a malformed pointer is no pointer", async () => {
    const r = await rig({ replies: { "status --json": STATUS(INC), "terminal send": SEND_OK } });
    writeFileSync(join(r.state, "runs", "r1", "orchestrator"), '{"handle":"term_x"}');
    await baton(r, ["notify-orchestrator", KEY, MSG]);
    expect(orcaCalls(r)).toEqual([]);
    expect(fallbackLines(r)).toEqual([`${KEY}|${MSG}`]);
  });

  test("the wrong argument count is usage, nothing sent", async () => {
    const r = await rig({ replies: { "status --json": STATUS(INC), "terminal send": SEND_OK } });
    expect((await baton(r, ["notify-orchestrator", KEY])).rc).toBe(64);
    expect((await baton(r, ["notify-orchestrator", KEY, "a", "b"])).rc).toBe(64);
    expect(orcaCalls(r)).toEqual([]);
  });

  test("end to end through notifyOnce: the config's notify argv runs the notifier", async () => {
    const r = await rig({ replies: { "status --json": STATUS(INC), "terminal send": SEND_OK } });
    await register(r);
    writeFileSync(r.cfg, JSON.stringify({ orca: { cli: FAKE_ORCA }, notify: [BIN, "notify-orchestrator", "{key}", "{message}"] }));
    const env = { ...process.env, HOME: r.home, BATON_STATE_DIR: r.state, BATON_CONFIG: r.cfg, FAKE_ORCA_DIR: r.orca };
    const p = Bun.spawn(["bun", "-e", `import { notifyOnce } from ${JSON.stringify(join(import.meta.dir, "..", "src", "notify.ts"))}; await notifyOnce(${JSON.stringify(KEY)}, ${JSON.stringify(MSG)});`], { env, stdout: "pipe", stderr: "pipe" });
    expect(await p.exited).toBe(0);
    expect(orcaCalls(r).map((c) => c[0])).toEqual(["status", "terminal"]);
    expect(readFileSync(join(r.state, "notify.log"), "utf8")).toContain(MSG);
  });
});

describe("readConfig: fallback_notify", () => {
  const saved = process.env.BATON_CONFIG;
  afterAll(() => {
    if (saved === undefined) delete process.env.BATON_CONFIG;
    else process.env.BATON_CONFIG = saved;
  });
  const cfg = (c: unknown) => {
    const p = join(root, `cfg${n++}.json`);
    writeFileSync(p, JSON.stringify(c));
    process.env.BATON_CONFIG = p;
    return p;
  };

  test("a non-empty argv list is accepted next to notify", () => {
    cfg({ notify: ["baton", "notify-orchestrator", "{key}", "{message}"], fallback_notify: ["notify-send", "baton", "{message}"] });
    expect(readConfig()).toEqual({ notify: ["baton", "notify-orchestrator", "{key}", "{message}"], fallback_notify: ["notify-send", "baton", "{message}"] });
  });

  test.each([[[]], ["notify-send"], [["a", 1]], [null], [{}]])("%j is refused", (bad) => {
    const p = cfg({ fallback_notify: bad });
    expect(() => readConfig()).toThrow(`${p}: fallback_notify must be a non-empty argv list`);
  });

  test("control: notify's own validation is unchanged", () => {
    const p = cfg({ notify: [] });
    expect(() => readConfig()).toThrow(`${p}: notify must be a non-empty argv list`);
  });
});
