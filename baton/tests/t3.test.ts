import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostAuthError, HostDownError } from "../src/host.ts";
import { callTool, readToken } from "../src/hosts/mcp.ts";
import { startStub, type Stub } from "./t3-stub.ts";

const TOKEN = "test-token-QX7f2k9ZpL"; // a stand-in; no real token is used in tests
const BIN = join(import.meta.dir, "..", "bin", "baton");

const stubs: Stub[] = [];
afterEach(() => {
  while (stubs.length) stubs.pop()!.stop();
});
function stub(opts: Parameters<typeof startStub>[0]): Stub {
  const s = startStub(opts);
  stubs.push(s);
  return s;
}

function tokenFile(mode: number, body: unknown = { access_token: TOKEN, expires_at: Math.floor(Date.now() / 1000) + 86400 * 10, scope: "a:b c:d" }): string {
  const dir = mkdtempSync(join(tmpdir(), "baton-t3-tok-"));
  const p = join(dir, "t3-token.json");
  writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body));
  chmodSync(p, mode);
  return p;
}

async function thrown(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a rejection");
}

// ---- token file ----------------------------------------------------------------------

describe("readToken", () => {
  test("mode 644 token file is refused before reading", () => {
    // Not JSON: a parse would fail differently, so the mode error proves the order.
    const p = tokenFile(0o644, "not json at all");
    let err: unknown;
    try {
      readToken(p);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HostAuthError);
    expect((err as Error).message).toBe("token file mode must be 600");
  });

  test("control: mode 600 reads", () => {
    const t = readToken(tokenFile(0o600));
    expect(t.access_token).toBe(TOKEN);
    expect(typeof t.expires_at).toBe("number");
  });

  test("a malformed token file names no token text", () => {
    const p = tokenFile(0o600, `{"access_token": "${TOKEN}`);
    let err: unknown;
    try {
      readToken(p);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HostAuthError);
    expect((err as Error).message).not.toContain(TOKEN.slice(0, 8));
  });
});

// ---- the MCP client ----------------------------------------------------------------

describe("callTool", () => {
  test("initialize then tools/call, carrying the session id and the bearer token", async () => {
    const s = stub({ token: TOKEN, tools: (name, args) => ({ result: { echoed: name, args } }) });
    const r = await callTool(s.url, TOKEN, "t3_project_list", { limit: 3 });
    expect(r).toEqual({ echoed: "t3_project_list", args: { limit: 3 } });
    const posts = s.seen.filter((x) => x.method !== "DELETE");
    expect(posts.map((x) => x.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(posts[2].headers["mcp-session-id"]).toBe("stub-session-1");
    expect(posts[2].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(posts[0].headers.accept).toContain("text/event-stream");
    expect(posts[0].headers.accept).toContain("application/json");
  });

  test("SSE reply is parsed", async () => {
    const s = stub({ token: TOKEN, sse: true, tools: () => ({ result: { threads: [{ id: "a" }] } }) });
    expect(await callTool(s.url, TOKEN, "t3_thread_list", {})).toEqual({ threads: [{ id: "a" }] });
  });

  test("401 raises token rejected", async () => {
    const s = stub({ token: "some-other-token" });
    const e = await thrown(callTool(s.url, TOKEN, "t3_project_list", {}));
    expect(e).toBeInstanceOf(HostAuthError);
    expect(e.message).toBe("token rejected");
  });

  test("403 raises token rejected", async () => {
    const s = stub({ token: TOKEN, status: 403 });
    const e = await thrown(callTool(s.url, TOKEN, "t3_project_list", {}));
    expect(e).toBeInstanceOf(HostAuthError);
  });

  test("the error text never contains the token", async () => {
    const errs: Error[] = [];
    errs.push(await thrown(callTool(stub({ token: "other" }).url, TOKEN, "x", {})));
    errs.push(await thrown(callTool(stub({ token: TOKEN, status: 503 }).url, TOKEN, "x", {})));
    errs.push(await thrown(callTool("http://127.0.0.1:1/mcp", TOKEN, "x", {})));
    expect(errs.length).toBe(3);
    for (const e of errs) {
      expect(String(e.message)).not.toContain(TOKEN);
      expect(String(e.stack)).not.toContain(TOKEN);
    }
  });

  test("5xx raises HostDownError", async () => {
    const s = stub({ token: TOKEN, status: 502 });
    expect(await thrown(callTool(s.url, TOKEN, "x", {}))).toBeInstanceOf(HostDownError);
  });

  test("refused connection raises HostDownError", async () => {
    const s = startStub({ token: TOKEN });
    const url = s.url;
    s.stop(); // the port is now closed
    expect(await thrown(callTool(url, TOKEN, "x", {}))).toBeInstanceOf(HostDownError);
  });

  test("a tool error comes back as {error}", async () => {
    const s = stub({ token: TOKEN, tools: () => ({ isError: true, result: { code: "thread_not_found", message: "no" } }) });
    expect(await callTool(s.url, TOKEN, "t3_thread_read", {})).toEqual({ error: { code: "thread_not_found", message: "no" } });
  });

  test("a JSON-RPC error comes back as {error}", async () => {
    const s = stub({ token: TOKEN, tools: () => ({ rpcError: { code: -32602, message: "bad params" } }) });
    expect(await callTool(s.url, TOKEN, "x", {})).toEqual({ error: { code: -32602, message: "bad params" } });
  });
});

// ---- CLI ------------------------------------------------------------------------------

async function cli(env: Record<string, string>, ...args: string[]) {
  // A temp HOME: a defaulting bug must never reach the operator's real token file.
  const home = mkdtempSync(join(tmpdir(), "baton-t3-home-"));
  const p = Bun.spawn([BIN, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: home, ...env } });
  const [out, err, rc] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, rc };
}
function config(t3: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "baton-t3-cfg-"));
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify({ t3 }));
  return p;
}

describe("baton t3", () => {
  test("token-status prints scope and days left, never the token", async () => {
    const tf = tokenFile(0o600);
    const r = await cli({ BATON_CONFIG: config({ tokenFile: tf }) }, "t3", "token-status");
    expect(r.rc).toBe(0);
    expect(r.out).toBe("scope: a:b c:d\ndays_left: 9\n");
    expect(r.out + r.err).not.toContain(TOKEN);
  });

  test("token-status is rc 3 when expired", async () => {
    const tf = tokenFile(0o600, { access_token: TOKEN, expires_at: Math.floor(Date.now() / 1000) - 60, scope: "a:b" });
    const r = await cli({ BATON_CONFIG: config({ tokenFile: tf }) }, "t3", "token-status");
    expect(r.rc).toBe(3);
    expect(r.out + r.err).not.toContain(TOKEN);
  });

  test("call prints the tool result as JSON", async () => {
    const s = stub({ token: TOKEN, tools: (name, args) => ({ result: { name, args } }) });
    const r = await cli({ BATON_CONFIG: config({ base: s.url, tokenFile: tokenFile(0o600) }) }, "t3", "call", "t3_project_list", '{"limit":2}');
    expect(r.rc).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ name: "t3_project_list", args: { limit: 2 } });
  });

  test("call with a rejected token is rc 3 and prints no token", async () => {
    const s = stub({ token: "other" });
    const r = await cli({ BATON_CONFIG: config({ base: s.url, tokenFile: tokenFile(0o600) }) }, "t3", "call", "x", "{}");
    expect(r.rc).toBe(3);
    expect(r.err).toContain("token rejected");
    expect(r.out + r.err).not.toContain(TOKEN);
  });

  test("call with arguments that are not a JSON object is a usage error", async () => {
    const r = await cli({ BATON_CONFIG: config({ tokenFile: tokenFile(0o600) }) }, "t3", "call", "x", "[1]");
    expect(r.rc).toBe(64);
  });
});

// ---- T3Host against the stub ------------------------------------------------------------

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { LaunchError, type LaunchRequest } from "../src/host.ts";
import { T3Host } from "../src/hosts/t3.ts";

const FIX = join(import.meta.dir, "fixtures", "t3");
const fixture = (name: string) => {
  const { _captured, ...rest } = JSON.parse(readFileSync(join(FIX, name), "utf8"));
  return rest;
};

function git(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", "-c", "user.email=t@example.invalid", "-c", "user.name=t", "-C", cwd, ...args], { stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
  return p.stdout.toString().trim();
}

/** A temp repo on branch `main` with one commit, its realpath. */
function tempRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "baton-t3-repo-")));
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "README"), "x\n");
  git(dir, "add", "README");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

type World = { stub: Stub; host: T3Host; root: string; state: string; tool: Record<string, (args: any) => { result: unknown; isError?: boolean }> };

/** A stub T3 whose `pilot-fourseat` project lives at a fresh temp repo. */
function world(): World {
  const root = tempRepo();
  const state = realpathSync(mkdtempSync(join(tmpdir(), "baton-t3-state-")));
  process.env.BATON_STATE_DIR = state;
  const list = fixture("project-list.json");
  list.projects.find((p: any) => p.title === "pilot-fourseat").workspaceRoot = root;
  const tool: World["tool"] = {
    t3_project_list: () => ({ result: list }),
    t3_thread_launch: () => ({ result: fixture("launch.json") }),
    t3_thread_read: () => ({ result: fixture("thread-read-completed.json") }),
    t3_thread_list: () => ({ result: { projectId: "p", currentThreadId: null, threads: [], nextCursor: null, total: 0 } }),
    t3_thread_interrupt: (a) => ({ result: { threadId: a.threadId, runId: null, status: "interrupt_requested" } }),
  };
  const s = stub({
    token: TOKEN,
    tools: (name, args) => {
      const f = tool[name];
      if (!f) return { rpcError: { code: -32602, message: `no tool ${name}` } };
      return f(args);
    },
  });
  return { stub: s, host: new T3Host({ base: s.url, tokenFile: tokenFile(0o600) }), root, state, tool };
}

const req = (cwd: string, nonce = "r1/u1/plan/1"): LaunchRequest => ({
  nonce, title: `Plan [baton ${nonce}]`, project: "pilot-fourseat", instance: "OMP_T3_Inst", model: "default", cwd, message: "do it",
});

function readReturning(fx: string, edit: (j: any) => void) {
  return () => {
    const j = fixture(fx);
    edit(j);
    return { result: j };
  };
}

describe("T3Host.status", () => {
  test("status reads recentRuns not settled", async () => {
    const w = world();
    // completed run, settled false: completed
    expect(fixture("thread-read-completed.json").thread.settled).toBe(false);
    const done = await w.host.status("mcp:t1");
    expect(done.state).toBe("completed");
    // running run, settled true: active
    w.tool.t3_thread_read = () => ({ result: fixture("thread-read-running.json") });
    expect(fixture("thread-read-running.json").thread.settled).toBe(true);
    expect((await w.host.status("mcp:t1")).state).toBe("active");
    expect(w.stub.calls.filter((c) => c.name === "t3_thread_read")[0].args).toEqual({ threadId: "mcp:t1", limit: 1, runLimit: 1 });
  });

  test("settled with no active run is not completed", async () => {
    const w = world();
    w.tool.t3_thread_read = readReturning("thread-read-running.json", (j) => (j.thread.activeRunId = null));
    expect((await w.host.status("mcp:t1")).state).toBe("active");
  });

  test("a completed run with an active run id is still active", async () => {
    const w = world();
    w.tool.t3_thread_read = readReturning("thread-read-completed.json", (j) => (j.thread.activeRunId = "run:next"));
    expect((await w.host.status("mcp:t1")).state).toBe("active");
  });

  test("each failure run status maps to failed", async () => {
    const w = world();
    for (const st of ["failed", "interrupted", "cancelled", "rolled_back"]) {
      w.tool.t3_thread_read = readReturning("thread-read-completed.json", (j) => (j.recentRuns[0].status = st));
      expect([st, (await w.host.status("mcp:t1")).state]).toEqual([st, "failed"]);
    }
  });

  test("a failure run with an active run id is still active", async () => {
    const w = world();
    expect(fixture("thread-read-completed.json").thread.activeRunId).toBeNull();
    for (const st of ["failed", "interrupted", "cancelled", "rolled_back"]) {
      w.tool.t3_thread_read = readReturning("thread-read-completed.json", (j) => {
        j.recentRuns[0].status = st;
        j.thread.activeRunId = "run:next";
      });
      expect([st, (await w.host.status("mcp:t1")).state]).toEqual([st, "active"]);
    }
  });

  test("waiting maps to waiting; preparing and queued are active", async () => {
    const w = world();
    for (const [st, want] of [["waiting", "waiting"], ["preparing", "active"], ["queued", "active"]]) {
      w.tool.t3_thread_read = readReturning("thread-read-completed.json", (j) => (j.recentRuns[0].status = st));
      expect([st, (await w.host.status("mcp:t1")).state]).toEqual([st, want]);
    }
  });

  test("a thread with no runs yet is active", async () => {
    const w = world();
    w.tool.t3_thread_read = readReturning("thread-read-completed.json", (j) => (j.recentRuns = []));
    expect((await w.host.status("mcp:t1")).state).toBe("active");
  });

  test("thread_not_found maps to gone", async () => {
    const w = world();
    const nf = fixture("thread-read-not-found.json");
    w.tool.t3_thread_read = () => ({ isError: true, result: nf.error });
    expect((await w.host.status("mcp:gone")).state).toBe("gone");
  });

  test("another tool error is HostDownError, not gone", async () => {
    const w = world();
    w.tool.t3_thread_read = () => ({ isError: true, result: { code: "unavailable", message: "x" } });
    expect(await thrown(w.host.status("mcp:t1"))).toBeInstanceOf(HostDownError);
  });

  test("activity is the update stamp plus the newest run id, and moves with either", async () => {
    const w = world();
    const a = (await w.host.status("mcp:t1")).activity;
    const fx = fixture("thread-read-completed.json");
    expect(a).toBe(`${fx.thread.updatedAt} ${fx.recentRuns[0].runId}`);
    w.tool.t3_thread_read = readReturning("thread-read-completed.json", (j) => (j.recentRuns[0].runId = "run:2"));
    expect((await w.host.status("mcp:t1")).activity).not.toBe(a);
    w.tool.t3_thread_read = readReturning("thread-read-completed.json", (j) => (j.thread.updatedAt = "2026-10-22T00:00:00.000Z"));
    expect((await w.host.status("mcp:t1")).activity).not.toBe(a);
  });

  test("an expired token is refused before any request", async () => {
    const w = world();
    const h = new T3Host({ base: w.stub.url, tokenFile: tokenFile(0o600, { access_token: TOKEN, expires_at: 1, scope: "x" }) });
    const e = await thrown(h.status("mcp:t1"));
    expect(e).toBeInstanceOf(HostAuthError);
    expect(w.stub.seen.length).toBe(0);
  });
});

describe("T3Host.bind and launch", () => {
  test("launch sends existing_worktree with the current branch", async () => {
    const w = world();
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), "baton-t3-wt-"))), "item");
    git(w.root, "worktree", "add", "-q", "-b", "feat/x", wt);
    const dir = await w.host.bind("pilot-fourseat", wt, "r1/u1/plan/1", "worktree");
    expect(dir).toBe(wt);
    const r = await w.host.launch(req(dir));
    expect(r).toEqual({ threadId: fixture("launch.json").threadId });
    const sent = w.stub.calls.find((c) => c.name === "t3_thread_launch")!.args;
    expect(sent).toEqual({
      projectId: "8f672ec2-47ef-4237-9ff2-a0d4366bc8c5",
      title: "Plan [baton r1/u1/plan/1]",
      modelSelection: { instanceId: "OMP_T3_Inst", model: "default" },
      runtimeMode: "full-access",
      workspaceStrategy: { type: "existing_worktree", worktreePath: wt, branch: "feat/x" },
      message: "do it",
    });
  });

  test("root cwd binds a per-launch worktree", async () => {
    const w = world();
    const nonce = "r1/u1/plan/2";
    const dir = await w.host.bind("pilot-fourseat", w.root, nonce, "worktree");
    expect(dir).toBe(join(w.state, "launch", "r1_u1_plan_2"));
    expect(git(w.root, "worktree", "list", "--porcelain")).toContain(`worktree ${dir}\n`);
    await w.host.launch(req(dir, nonce));
    const sent = w.stub.calls.find((c) => c.name === "t3_thread_launch")!.args as any;
    expect(sent.workspaceStrategy).toEqual({ type: "existing_worktree", worktreePath: dir });
    await w.host.release("pilot-fourseat", w.root, dir);
    expect(existsSync(dir)).toBe(false);
    expect(git(w.root, "worktree", "list", "--porcelain")).not.toContain(dir);
  });

  test("bind of the same nonce twice returns the same worktree", async () => {
    const w = world();
    const a = await w.host.bind("pilot-fourseat", w.root, "r1/u1/plan/3", "worktree");
    const b = await w.host.bind("pilot-fourseat", w.root, "r1/u1/plan/3", "worktree");
    expect(b).toBe(a);
  });

  test("root mode binds the root itself on its current branch", async () => {
    const w = world();
    const dir = await w.host.bind("pilot-fourseat", w.root, "r1/u1/lane/1", "root");
    expect(dir).toBe(w.root);
    expect(existsSync(join(w.state, "launch"))).toBe(false);
    expect(git(w.root, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length).toBe(1);
    await w.host.launch(req(dir, "r1/u1/lane/1"));
    const sent = w.stub.calls.find((c) => c.name === "t3_thread_launch")!.args as any;
    expect(sent.workspaceStrategy).toEqual({ type: "existing_worktree", worktreePath: w.root, branch: "main" });
  });

  test("a cwd that is not the root is returned as given, with no worktree made", async () => {
    const w = world();
    const other = tempRepo();
    expect(await w.host.bind("pilot-fourseat", other, "r1/u1/plan/4", "worktree")).toBe(other);
    expect(existsSync(join(w.state, "launch"))).toBe(false);
  });

  test("detached HEAD in a recipe worktree raises LaunchError without calling T3", async () => {
    const w = world();
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), "baton-t3-wt-"))), "det");
    git(w.root, "worktree", "add", "-q", "--detach", wt, "HEAD");
    const e = await thrown(w.host.launch(req(wt)));
    expect(e).toBeInstanceOf(LaunchError);
    expect(w.stub.seen.length).toBe(0);
  });

  test("an unknown or ambiguous project title is a LaunchError", async () => {
    const w = world();
    expect(await thrown(w.host.bind("no-such", w.root, "r1/u1/plan/1", "worktree"))).toBeInstanceOf(LaunchError);
    // the fixture holds two projects titled "repo"
    expect(await thrown(w.host.bind("repo", w.root, "r1/u1/plan/1", "worktree"))).toBeInstanceOf(LaunchError);
  });

  test("the project is found on a later page", async () => {
    const w = world();
    const list = fixture("project-list.json");
    const target = list.projects.find((p: any) => p.title === "pilot-fourseat");
    target.workspaceRoot = w.root;
    const others = list.projects.filter((p: any) => p !== target);
    w.tool.t3_project_list = (a) => ({ result: a.cursor === 1 ? { projects: [target], nextCursor: null } : { projects: others, nextCursor: 1 } });
    expect(await w.host.bind("pilot-fourseat", w.root, "r1/u1/plan/5", "root")).toBe(w.root);
  });

  test("a launch the host refuses is a LaunchError", async () => {
    const w = world();
    w.tool.t3_thread_launch = () => ({ isError: true, result: { code: "invalid_request", message: "worktreePath must be one of the project's git worktrees." } });
    expect(await thrown(w.host.launch(req(w.root)))).toBeInstanceOf(LaunchError);
  });
});

describe("T3Host.release", () => {
  test("dir equal to cwd is a no-op", async () => {
    const w = world();
    await w.host.release("pilot-fourseat", w.root, w.root);
    expect(existsSync(w.root)).toBe(true);
    expect(w.stub.seen.length).toBe(0);
  });

  test("a dir outside the launch directory is refused and left in place", async () => {
    const w = world();
    const wt = join(realpathSync(mkdtempSync(join(tmpdir(), "baton-t3-wt-"))), "item");
    git(w.root, "worktree", "add", "-q", "-b", "feat/y", wt);
    expect(await thrown(w.host.release("pilot-fourseat", w.root, wt))).toBeInstanceOf(LaunchError);
    expect(existsSync(wt)).toBe(true);
  });

  test("a launch worktree already gone is released without error", async () => {
    const w = world();
    const dir = await w.host.bind("pilot-fourseat", w.root, "r1/u1/plan/6", "worktree");
    Bun.spawnSync(["rm", "-rf", dir]);
    await w.host.release("pilot-fourseat", w.root, dir);
    expect(git(w.root, "worktree", "list", "--porcelain")).not.toContain(dir);
  });
});

describe("T3Host.findByNonce and interrupt", () => {
  test("findByNonce returns every match", async () => {
    const w = world();
    expect(await w.host.findByNonce("pilot-fourseat", "r1/u1/plan/1")).toEqual([]);
    expect(w.stub.calls.find((c) => c.name === "t3_thread_list")!.args).toEqual({
      projectId: "8f672ec2-47ef-4237-9ff2-a0d4366bc8c5", titleContains: "[baton r1/u1/plan/1]", limit: 5,
    });
    const item = (id: string) => ({ threadId: id, title: `x [baton r1/u1/plan/1]` });
    w.tool.t3_thread_list = () => ({ result: { projectId: "p", currentThreadId: null, threads: [item("mcp:a"), item("mcp:b")], nextCursor: null, total: 2 } });
    expect(await w.host.findByNonce("pilot-fourseat", "r1/u1/plan/1")).toEqual(["mcp:a", "mcp:b"]);
  });

  test("interrupt sends the reason and the thread's nonce as clientRequestId", async () => {
    const w = world();
    w.tool.t3_thread_read = readReturning("thread-read-completed.json", (j) => (j.thread.title = "Plan [baton r1/u1/plan/7]"));
    await w.host.interrupt("mcp:t1", "stalled");
    expect(w.stub.calls.find((c) => c.name === "t3_thread_interrupt")!.args).toEqual({
      threadId: "mcp:t1", reason: "stalled", clientRequestId: "r1/u1/plan/7",
    });
  });

  test("interrupt of a thread T3 no longer has is a no-op", async () => {
    const w = world();
    w.tool.t3_thread_read = () => ({ isError: true, result: fixture("thread-read-not-found.json").error });
    await w.host.interrupt("mcp:gone", "stop");
    expect(w.stub.calls.some((c) => c.name === "t3_thread_interrupt")).toBe(false);
  });
});
