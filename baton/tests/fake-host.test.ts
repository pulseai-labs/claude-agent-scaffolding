import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeClaim } from "../src/claims.ts";
import { HostAuthError, HostDownError, type LaunchRequest } from "../src/host.ts";
import { nonce, threadTitle } from "../src/recipe.ts";
import { FakeHost } from "./fake-host.ts";

const saved = { state: process.env.BATON_STATE_DIR, home: process.env.HOME };
let base: string, proj: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "baton-fakehost-")));
  proj = join(base, "proj");
  mkdirSync(proj);
  mkdirSync(join(base, "home"));
  process.env.BATON_STATE_DIR = join(base, "state");
  process.env.HOME = join(base, "home");
});
afterEach(() => {
  process.env.BATON_STATE_DIR = saved.state;
  process.env.HOME = saved.home;
  if (saved.state === undefined) delete process.env.BATON_STATE_DIR;
});

function req(stage: string, rendered = "title", n = 1): LaunchRequest {
  const nc = nonce("r1", "u1", stage, n);
  return { nonce: nc, title: threadTitle(rendered, nc), project: "p", instance: "i", model: "m", cwd: proj, message: "go" };
}

test("fake host records the claim seen at launch", async () => {
  const h = new FakeHost({ build: { ticks: 1, end: "completed" } });
  const r = req("build");
  writeClaim(proj, { A: "1", B: "two" }, r.nonce);
  await h.launch(r);
  expect(h.launches.length).toBe(1);
  expect(h.launches[0].request).toEqual(r);
  expect(h.launches[0].claim).toEqual({ nonce: r.nonce, env: { A: "1", B: "two" } });
  const h2 = new FakeHost({ build: { ticks: 1, end: "completed" } });
  const bare = join(base, "bare");
  mkdirSync(bare);
  await h2.launch({ ...req("build", "t", 2), cwd: bare });
  expect(h2.launches[0].claim).toBeNull();
});

test("writes land on the last tick, then status is completed", async () => {
  const file = join(base, "out.txt");
  const h = new FakeHost({ build: { ticks: 2, writes: [{ path: file, content: "hello" }], end: "completed" } });
  const { threadId } = await h.launch(req("build"));
  expect((await h.status(threadId)).state).toBe("active");
  const a0 = (await h.status(threadId)).activity;
  h.advance();
  const s1 = await h.status(threadId);
  expect(s1.state).toBe("active");
  expect(s1.activity).not.toBe(a0);
  expect(existsSync(file)).toBe(false);
  h.advance();
  expect(readFileSync(file, "utf8")).toBe("hello");
  const s2 = await h.status(threadId);
  expect(s2.state).toBe("completed");
  expect(s2.activity).not.toBe(s1.activity);
  h.advance();
  expect(await h.status(threadId)).toEqual(s2);
});

test("end failed and waiting are reported, handoffLine is kept", async () => {
  const h = new FakeHost({ a: { ticks: 1, end: "failed" }, b: { ticks: 1, end: "waiting", handoffLine: "HANDOFF x" } });
  const ta = (await h.launch(req("a"))).threadId;
  const tb = (await h.launch(req("b"))).threadId;
  h.advance();
  expect((await h.status(ta)).state).toBe("failed");
  expect((await h.status(tb)).state).toBe("waiting");
  expect(h.launches[1].behaviour.handoffLine).toBe("HANDOFF x");
});

test("loseResponse launches but throws, and findByNonce returns the thread", async () => {
  const h = new FakeHost({ build: { ticks: 1, end: "completed", loseResponse: true } });
  const r = req("build");
  let err: unknown;
  try { await h.launch(r); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(Error);
  expect(err).not.toBeInstanceOf(HostAuthError);
  expect(err).not.toBeInstanceOf(HostDownError);
  const ids = await h.findByNonce("p", r.nonce);
  expect(ids.length).toBe(1);
  h.advance();
  expect((await h.status(ids[0])).state).toBe("completed");
  expect(await h.findByNonce("p", "r1/u1/build/9")).toEqual([]);
  expect(await h.findByNonce("other", r.nonce)).toEqual([]);
});

test("stage is parsed from the nonce, not the title text", async () => {
  const h = new FakeHost({ build: { ticks: 1, end: "completed" }, review: { ticks: 1, end: "failed" } });
  const { threadId } = await h.launch(req("build", "review a/b/review/3 the thing"));
  h.advance();
  expect((await h.status(threadId)).state).toBe("completed");
});

test("an unscripted stage is a loud error", async () => {
  const h = new FakeHost({});
  await expect(h.launch(req("nope"))).rejects.toThrow(/nope/);
});

test("unknown thread is gone; interrupt is recorded", async () => {
  const h = new FakeHost({ build: { ticks: 5, end: "completed" } });
  expect(await h.status("zzz")).toEqual({ state: "gone", activity: "" });
  const { threadId } = await h.launch(req("build"));
  await h.interrupt(threadId, "stalled");
  expect(h.interrupts).toEqual([{ threadId, reason: "stalled" }]);
});

test("bind returns cwd unchanged by default; hook overrides; release is recorded", async () => {
  const h = new FakeHost({});
  expect(await h.bind("p", proj, "n", "worktree")).toBe(proj);
  expect(await h.bind("p", proj, "n", "root")).toBe(proj);
  await h.release("p", proj, proj);
  expect(h.releases).toEqual([{ project: "p", cwd: proj, dir: proj }]);
  h.bindDir = (_p, cwd, n, mode) => `${cwd}-${n}-${mode}`;
  expect(await h.bind("p", proj, "n", "worktree")).toBe(`${proj}-n-worktree`);
});

test("down=auth throws HostAuthError from every method", async () => {
  const h = new FakeHost({ build: { ticks: 1, end: "completed" } });
  h.down = "auth";
  const calls: Array<() => Promise<unknown>> = [
    () => h.bind("p", proj, "n", "root"),
    () => h.release("p", proj, proj),
    () => h.launch(req("build")),
    () => h.status("t"),
    () => h.interrupt("t", "r"),
    () => h.findByNonce("p", "n"),
  ];
  for (const c of calls) await expect(c()).rejects.toBeInstanceOf(HostAuthError);
  expect(h.launches.length).toBe(0);
});

test("down=unreachable throws HostDownError, not HostAuthError", async () => {
  const h = new FakeHost({});
  h.down = "unreachable";
  const e = await h.status("t").catch((x) => x);
  expect(e).toBeInstanceOf(HostDownError);
  expect(e).not.toBeInstanceOf(HostAuthError);
  h.down = null;
  expect((await h.status("t")).state).toBe("gone");
});

test("{unit} in a write's path and content is the launching unit's id", async () => {
  const h = new FakeHost({ build: { ticks: 1, writes: [{ path: join(base, "out", "{unit}.done"), content: "by {unit}" }], end: "completed" } });
  const r = req("build");
  await h.launch(r);
  await h.launch({ ...r, title: threadTitle("t", nonce("r1", "u2", "build", 1)) });
  h.advance();
  expect(readFileSync(join(base, "out", "u1.done"), "utf8")).toBe("by u1");
  expect(readFileSync(join(base, "out", "u2.done"), "utf8")).toBe("by u2");
});

test("finish ends any thread; drop makes it gone", async () => {
  const h = new FakeHost({ build: { ticks: 100, end: "completed" } });
  const a = (await h.launch(req("build"))).threadId;
  const b = (await h.launch(req("build", "t", 2))).threadId;
  h.finish(a, "interrupted");
  h.drop(b);
  expect((await h.status(a)).state).toBe("interrupted");
  expect((await h.status(b)).state).toBe("gone");
});
