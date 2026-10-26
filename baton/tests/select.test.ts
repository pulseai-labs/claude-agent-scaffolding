// Host selection: `"host"` in the config names the host the CLI builds (design 4.1).

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrcaHost } from "../src/hosts/orca.ts";
import { hostKind, makeHost } from "../src/hosts/select.ts";
import { T3Host } from "../src/hosts/t3.ts";

const BIN = join(import.meta.dir, "..", "bin", "baton");
const FAKE = join(import.meta.dir, "fake-orca");
const KEYS = ["BATON_STATE_DIR", "BATON_CONFIG", "FAKE_ORCA_DIR"];
const saved: Record<string, string | undefined> = {};
let base: string, state: string, cfg: string, fakeDir: string;

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  base = realpathSync(mkdtempSync(join(tmpdir(), "baton-select-")));
  state = join(base, "state");
  fakeDir = join(base, "fake");
  cfg = join(base, "config.json");
  mkdirSync(state);
  mkdirSync(fakeDir);
  process.env.BATON_STATE_DIR = state;
  process.env.BATON_CONFIG = cfg;
  process.env.FAKE_ORCA_DIR = fakeDir;
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const config = (c: unknown) => writeFileSync(cfg, JSON.stringify(c));
const argvLog = (): string[][] =>
  existsSync(join(fakeDir, "argv.jsonl"))
    ? readFileSync(join(fakeDir, "argv.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];

async function tickCli() {
  const p = Bun.spawn([BIN, "tick"], { stdout: "pipe", stderr: "pipe", env: process.env as Record<string, string> });
  const [err, rc] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  return { err, rc };
}
const noticeLog = () => (existsSync(join(state, "notify.log")) ? readFileSync(join(state, "notify.log"), "utf8") : "");
/** A mode-600 token file that expires in a day, and a config pointing the T3 host at it. */
function expiringToken(extra: Record<string, unknown>): void {
  const file = join(base, "token.json");
  writeFileSync(file, JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 86_400 }), { mode: 0o600 });
  config({ t3: { tokenFile: file }, ...extra });
}

test("no host key selects t3", () => {
  expect(hostKind()).toBe("t3"); // no config file at all
  expect(makeHost()).toBeInstanceOf(T3Host);
  config({ slots: { session: 3 } });
  expect(hostKind()).toBe("t3");
  expect(makeHost()).toBeInstanceOf(T3Host);
  config({ host: "t3" });
  expect(makeHost()).toBeInstanceOf(T3Host);
});

test("host orca selects OrcaHost", () => {
  config({ host: "orca" });
  expect(hostKind()).toBe("orca");
  const h = makeHost();
  expect(h).toBeInstanceOf(OrcaHost);
  expect(h).not.toBeInstanceOf(T3Host);
});

test("bad host value fails the tick with a config error", async () => {
  for (const bad of ["T3", "herdr", "", 3, null, ["orca"]]) {
    config({ host: bad });
    expect(() => hostKind()).toThrow('config: host must be "t3" or "orca"');
    const r = await tickCli();
    expect(r.rc).toBe(1);
    expect(r.err).toContain('config: host must be "t3" or "orca"');
  }
  // The control: a valid value ticks cleanly (no runs armed).
  config({ host: "orca", orca: { cli: FAKE } });
  expect((await tickCli()).rc).toBe(0);
});

test("t3 token warning is skipped on orca", async () => {
  // Control first: on t3 the same expiring token raises the notice.
  expiringToken({});
  expect((await tickCli()).rc).toBe(0);
  expect(noticeLog()).toMatch(/token\/\d{4}-\d{2}-\d{2} t3 token expires .* run baton t3 login/);
  // On orca, a fresh state dir and the same token file: no notice.
  state = join(base, "state2");
  mkdirSync(state);
  process.env.BATON_STATE_DIR = state;
  expiringToken({ host: "orca", orca: { cli: FAKE } });
  expect((await tickCli()).rc).toBe(0);
  expect(noticeLog()).not.toContain("token/");
});

test("orca block overrides cli and launcher", async () => {
  // cli: the host built by makeHost() runs the configured binary.
  writeFileSync(join(fakeDir, "replies.json"), JSON.stringify({ "repo list": "repo-list.json", "terminal create": "terminal-create.json" }));
  config({ host: "orca", orca: { cli: FAKE, launcher: "/opt/custom/baton-seat" } });
  const h = makeHost();
  const { threadId } = await h.launch({
    nonce: "r/u/s/1", title: "w [baton r/u/s/1]", project: "pilot-fourseat", instance: "i", model: "m",
    cwd: "/home/dev/projects/pilot-fourseat", message: "go",
  });
  expect(threadId).toMatch(/^term_/);
  const create = argvLog().find((a) => a[0] === "terminal" && a[1] === "create")!;
  expect(create).toBeDefined();
  // launcher: the launch command execs the configured launcher, not baton's own.
  const command = create[create.indexOf("--command") + 1];
  expect(command).toContain("exec '/opt/custom/baton-seat' '");
  expect(command).not.toContain(join(import.meta.dir, "..", "bin", "baton-seat"));
});
