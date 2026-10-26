import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDownError, LaunchError } from "../src/host.ts";
import { runOrca } from "../src/hosts/orca-cli.ts";
import { loadOrcaConfig, OrcaHost, shellQuote } from "../src/hosts/orca.ts";

const FAKE = join(import.meta.dir, "fake-orca");
const FIXTURES = join(import.meta.dir, "fixtures", "orca");
const REPO_PATH = "/home/dev/projects/pilot-fourseat"; // repo-list.json
const HANDLE = "term_3a3a4b2c-380f-4bcc-a4e0-9053d6206ec7"; // terminal-create.json

let base: string, fakeDir: string, state: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ["BATON_STATE_DIR", "BATON_CONFIG", "FAKE_ORCA_DIR", "FAKE_ORCA_HANG", "FAKE_ORCA_GARBAGE"]) saved[k] = process.env[k];
  base = realpathSync(mkdtempSync(join(tmpdir(), "baton-orca-")));
  fakeDir = join(base, "fake");
  state = join(base, "state");
  mkdirSync(fakeDir);
  mkdirSync(state);
  process.env.FAKE_ORCA_DIR = fakeDir;
  process.env.BATON_STATE_DIR = state;
  delete process.env.FAKE_ORCA_HANG;
  delete process.env.FAKE_ORCA_GARBAGE;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function replies(map: Record<string, string | string[]>): void {
  writeFileSync(join(fakeDir, "replies.json"), JSON.stringify({ "repo list": "repo-list.json", ...map }));
}
/** A fixture of our own, written next to the replies (fake-orca looks there first). */
function fixture(name: string, body: unknown): string {
  writeFileSync(join(fakeDir, name), JSON.stringify(body));
  return name;
}
const argvLog = (): string[][] =>
  existsSync(join(fakeDir, "argv.jsonl"))
    ? readFileSync(join(fakeDir, "argv.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
const callsTo = (sub: string) => argvLog().filter((a) => a.slice(0, 2).join(" ") === sub);
const host = (opts?: { timeoutMs?: number }) => new OrcaHost({ cli: FAKE, launcher: "/opt/bin/baton-seat" }, opts);
const req = (over: Record<string, unknown> = {}) => ({
  nonce: "r/u/s/1",
  title: "w [baton r/u/s/1]",
  project: "pilot-fourseat",
  instance: "ignored",
  model: "ignored",
  cwd: REPO_PATH,
  message: "do the thing",
  ...over,
});
async function thrown(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a rejection");
}
const repoListOf = (repos: { displayName: string; path: string }[]) =>
  fixture("repos.json", { ok: true, result: { repos: repos.map((r, i) => ({ id: `id-${i}`, ...r })) } });

describe("runOrca", () => {
  test("appends --json and returns the envelope; an error envelope is a value, not a throw", () => {
    replies({ "terminal create": "terminal-create.json", "terminal read": "terminal-read-stale.json" });
    const ok = runOrca(FAKE, ["terminal", "create"]);
    expect(ok).toMatchObject({ ok: true });
    expect((ok as any).result.terminal.handle).toBe(HANDLE);
    expect(argvLog()[0]).toEqual(["terminal", "create", "--json"]);
    // fake-orca exits 1 on an error reply; the envelope still decides.
    expect(runOrca(FAKE, ["terminal", "read"])).toEqual({ ok: false, code: "terminal_handle_stale", message: "terminal_handle_stale" });
  });

  test("an unspawnable cli, garbage and a hang are all HostDownError", () => {
    expect(() => runOrca(join(base, "no-such-orca"), ["repo", "list"])).toThrow(HostDownError);
    replies({});
    process.env.FAKE_ORCA_GARBAGE = "1";
    expect(() => runOrca(FAKE, ["repo", "list"])).toThrow(HostDownError);
    delete process.env.FAKE_ORCA_GARBAGE;
    process.env.FAKE_ORCA_HANG = "1";
    const t0 = Date.now();
    expect(() => runOrca(FAKE, ["repo", "list"], 500)).toThrow(HostDownError);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  test("JSON that is not an envelope is HostDownError", () => {
    replies({ "repo list": fixture("odd.json", { hello: 1 }), "terminal list": fixture("odd2.json", { ok: false }) });
    expect(() => runOrca(FAKE, ["repo", "list"])).toThrow(HostDownError);
    expect(() => runOrca(FAKE, ["terminal", "list"])).toThrow(HostDownError);
  });
});

describe("shellQuote", () => {
  test("wraps in single quotes and escapes each single quote", () => {
    expect(shellQuote("/a b/c")).toBe("'/a b/c'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote("''")).toBe(`''\\'''\\'''`);
  });
});

describe("loadOrcaConfig", () => {
  test("the orca block overrides cli and launcher; defaults otherwise", () => {
    const cfg = join(base, "config.json");
    process.env.BATON_CONFIG = cfg;
    writeFileSync(cfg, JSON.stringify({ host: "orca", orca: { cli: "/x/orca", launcher: "/y/seat" } }));
    expect(loadOrcaConfig()).toEqual({ cli: "/x/orca", launcher: "/y/seat" });
    process.env.BATON_CONFIG = join(base, "absent.json");
    const d = loadOrcaConfig();
    expect(d.launcher).toBe(join(import.meta.dir, "..", "bin", "baton-seat"));
    expect(d.cli === "orca" || d.cli.endsWith("/.config/orca/cli/bin/orca")).toBe(true);
  });
});

describe("repo lookup", () => {
  test("repo lookup refuses none and two", async () => {
    replies({ "repo list": repoListOf([{ displayName: "other", path: "/o" }]) });
    let e = await thrown(host().bind("pilot-fourseat", REPO_PATH, "n", "root"));
    expect(e).toBeInstanceOf(LaunchError);
    expect(e.message).toBe('no Orca repo named "pilot-fourseat"');
    replies({ "repo list": repoListOf([{ displayName: "pilot-fourseat", path: "/a" }, { displayName: "pilot-fourseat", path: "/b" }]) });
    e = await thrown(host().launch(req()));
    expect(e).toBeInstanceOf(LaunchError);
    expect(e.message).toBe('2 Orca repos are named "pilot-fourseat"');
    expect(callsTo("terminal create")).toEqual([]);
  });

  test("bind and release use the repo path as the root", async () => {
    const root = join(base, "proj");
    mkdirSync(root);
    for (const a of [["init", "-q", "-b", "main"], ["config", "user.email", "t@e.x"], ["config", "user.name", "t"], ["commit", "-q", "--allow-empty", "-m", "i"]]) {
      expect(Bun.spawnSync(["git", "-C", root, ...a]).exitCode).toBe(0);
    }
    replies({ "repo list": repoListOf([{ displayName: "proj", path: root }]) });
    const h = host();
    const dir = await h.bind("proj", root, "r/u/s/1", "worktree");
    expect(dir).toBe(join(state, "launch", encodeURIComponent("r/u/s/1")));
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(await h.bind("proj", root, "r/u/s/1", "root")).toBe(root);
    await h.release("proj", root, dir);
    expect(existsSync(dir)).toBe(false);
  });
});

describe("launch", () => {
  test("launch writes the message file and passes no text through the shell", async () => {
    replies({ "terminal create": "terminal-create.json" });
    const message = `evil $(touch /tmp/pwned) \`id\` "q" 'q' ; rm -rf /\nline two`;
    const r = await host().launch(req({ message }));
    expect(r).toEqual({ threadId: HANDLE });
    const file = join(state, "orca", "messages", `${encodeURIComponent("r/u/s/1")}.txt`);
    expect(readFileSync(file, "utf8")).toBe(message);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(state, "orca", "messages")).mode & 0o777).toBe(0o700);
    const [argv] = callsTo("terminal create");
    expect(argv).toEqual([
      "terminal", "create", "--worktree", `path:${REPO_PATH}`, "--title", "w [baton r/u/s/1]",
      "--command", `cd '${REPO_PATH}' && exec '/opt/bin/baton-seat' '${file}'`, "--json",
    ]);
    expect(JSON.stringify(argvLog())).not.toContain("pwned");
    expect(JSON.stringify(argvLog())).not.toContain("line two");
  });

  test("launch command quotes paths", async () => {
    const odd = join(base, "it's a dir");
    const cwd = join(odd, "cw'd");
    mkdirSync(cwd, { recursive: true });
    process.env.BATON_STATE_DIR = join(odd, "state");
    replies({ "terminal create": "terminal-create.json" });
    await host().launch(req({ cwd }));
    const cmd = callsTo("terminal create")[0][callsTo("terminal create")[0].indexOf("--command") + 1];
    expect(cmd).toContain("exec ");
    const run = cmd.replace("exec ", `printf '%s\\n' "$PWD" `);
    const out = Bun.spawnSync(["bash", "-c", run]);
    expect(out.stderr.toString()).toBe("");
    const file = join(odd, "state", "orca", "messages", `${encodeURIComponent("r/u/s/1")}.txt`);
    expect(out.stdout.toString().split("\n")).toEqual([cwd, "/opt/bin/baton-seat", file, ""]);
  });

  test("launch refusal is LaunchError (and leaves no message file); garbage and hang are HostDownError", async () => {
    replies({ "terminal create": "terminal-create-refused.json" });
    const e = await thrown(host().launch(req()));
    expect(e).toBeInstanceOf(LaunchError);
    expect(readdirSync(join(state, "orca", "messages"))).toEqual([]);

    // Any other error code: the outcome is unknown.
    replies({ "terminal create": fixture("other.json", { ok: false, error: { code: "runtime_unavailable", message: "x" } }) });
    expect(await thrown(host().launch(req()))).toBeInstanceOf(HostDownError);
    // ok: true with no handle.
    replies({ "terminal create": fixture("nohandle.json", { ok: true, result: { terminal: {} } }) });
    expect(await thrown(host().launch(req()))).toBeInstanceOf(HostDownError);

    replies({ "terminal create": "terminal-create.json" });
    process.env.FAKE_ORCA_GARBAGE = "1";
    expect(await thrown(host().launch(req()))).toBeInstanceOf(HostDownError);
    delete process.env.FAKE_ORCA_GARBAGE;
    process.env.FAKE_ORCA_HANG = "1";
    const t0 = Date.now();
    expect(await thrown(host({ timeoutMs: 500 }).launch(req()))).toBeInstanceOf(HostDownError);
    expect(Date.now() - t0).toBeLessThan(10_000);
    // The unknown-outcome launches kept their message file for step 0 to find the terminal.
    expect(readdirSync(join(state, "orca", "messages"))).toEqual([`${encodeURIComponent("r/u/s/1")}.txt`]);
  });
});

describe("findByNonce", () => {
  const term = (title: string, handle: string) => ({ handle, title });
  test("findByNonce matches the title tag only", async () => {
    replies({
      "terminal list": fixture("list.json", {
        ok: true,
        result: { terminals: [term("a [baton r/u/s/1]", "term_a"), term("b [baton r/u/s/10]", "term_b"), term("r/u/s/1 plain", "term_c")], truncated: false },
      }),
    });
    expect(await host().findByNonce("pilot-fourseat", "r/u/s/1")).toEqual(["term_a"]);
    expect(await host().findByNonce("pilot-fourseat", "r/u/s/10")).toEqual(["term_b"]);
    expect(await host().findByNonce("pilot-fourseat", "r/u/s/2")).toEqual([]);
    expect(callsTo("terminal list")[0]).toEqual(["terminal", "list", "--worktree", `path:${REPO_PATH}`, "--limit", "1000", "--json"]);
  });

  test("the recorded list reply: its title is found", async () => {
    replies({ "terminal list": "terminal-list.json" });
    expect(await host().findByNonce("pilot-fourseat", "s/u/st/1")).toEqual([HANDLE]);
  });

  test("truncated list is host down", async () => {
    replies({ "terminal list": fixture("trunc.json", { ok: true, result: { terminals: [term("a [baton r/u/s/1]", "term_a")], truncated: true } }) });
    expect(await thrown(host().findByNonce("pilot-fourseat", "r/u/s/1"))).toBeInstanceOf(HostDownError);
  });
});

describe("interrupt, close, screen", () => {
  test("interrupt sends one Escape byte", async () => {
    replies({ "terminal send": "terminal-send-escape.json" });
    await host().interrupt(HANDLE, "stalled");
    const [a] = callsTo("terminal send");
    expect(a).toEqual(["terminal", "send", "--terminal", HANDLE, "--text", "\u001b", "--json"]);
    expect(a).not.toContain("--interrupt");
  });

  test("close sends terminal close for the handle", async () => {
    replies({ "terminal close": fixture("closed.json", { ok: true, result: { close: { handle: HANDLE } } }) });
    await host().close!(HANDLE);
    expect(callsTo("terminal close")[0]).toEqual(["terminal", "close", "--terminal", HANDLE, "--json"]);
  });

  test("screen joins the tail lines", async () => {
    replies({ "terminal read": "terminal-read-screen.json" });
    const s = await host().screen!(HANDLE);
    const tail = JSON.parse(readFileSync(join(FIXTURES, "terminal-read-screen.json"), "utf8")).result.terminal.tail as string[];
    expect(s.split("\n")).toEqual(tail);
    expect(s).toContain("Review against a base branch");
    expect(callsTo("terminal read")[0]).toEqual(["terminal", "read", "--terminal", HANDLE, "--screen", "--json"]);
  });

  test("stale handle: interrupt and close are quiet, screen is empty", async () => {
    replies({ "terminal send": "terminal-read-stale.json", "terminal close": "terminal-read-stale.json", "terminal read": "terminal-read-stale.json" });
    await host().interrupt(HANDLE, "x");
    await host().close!(HANDLE);
    expect(await host().screen!(HANDLE)).toBe("");
  });

  test("any other refusal is host down (control for the stale case)", async () => {
    const other = fixture("other.json", { ok: false, error: { code: "runtime_unavailable", message: "x" } });
    replies({ "terminal send": other, "terminal close": other, "terminal read": other });
    expect(await thrown(host().interrupt(HANDLE, "x"))).toBeInstanceOf(HostDownError);
    expect(await thrown(host().close!(HANDLE))).toBeInstanceOf(HostDownError);
    expect(await thrown(host().screen!(HANDLE))).toBeInstanceOf(HostDownError);
  });
});
