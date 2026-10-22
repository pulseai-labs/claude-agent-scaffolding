import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ForgeReadError, GhForge, prUrl, PrUrlError } from "../src/forge.ts";

// A stub `gh` first on PATH: it logs its argv and replays fixture JSON. No test reaches GitHub.
let dir: string;
const saved = { path: process.env.PATH, log: process.env.GH_LOG, fixture: process.env.GH_FIXTURE, fail: process.env.GH_FAIL };

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "baton-forge-")));
  const stub = join(dir, "gh");
  writeFileSync(stub, [
    "#!/usr/bin/env bash",
    'printf "%s\\n" "$*" >> "$GH_LOG"',
    'if [ "$1 $2" = "pr view" ]; then cat "$GH_FIXTURE" || exit 1; exit 0; fi',
    'if [ "$1 $2" = "pr merge" ]; then [ -n "$GH_FAIL" ] && { echo "boom" >&2; exit 1; }; exit 0; fi',
    "exit 2", "",
  ].join("\n"));
  chmodSync(stub, 0o755);
  process.env.PATH = `${dir}:${saved.path}`;
  process.env.GH_LOG = join(dir, "argv.log");
  process.env.GH_FIXTURE = join(dir, "fixture.json");
  delete process.env.GH_FAIL;
  writeFileSync(process.env.GH_LOG, "");
});
afterEach(() => {
  for (const [k, v] of [["PATH", saved.path], ["GH_LOG", saved.log], ["GH_FIXTURE", saved.fixture], ["GH_FAIL", saved.fail]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const argvLog = () => readFileSync(process.env.GH_LOG!, "utf8").trim().split("\n").filter(Boolean);
const URL_ = "https://github.com/o/r/pull/7";

function fixture(rollup: unknown, over: Record<string, unknown> = {}) {
  writeFileSync(process.env.GH_FIXTURE!, JSON.stringify({
    state: "OPEN", headRefOid: "abc123", baseRefName: "main", mergeable: "MERGEABLE", statusCheckRollup: rollup, ...over,
  }));
}
const run = (conclusion: string, status = "COMPLETED") => ({ __typename: "CheckRun", status, conclusion });
const ctxState = (state: string) => ({ __typename: "StatusContext", state });

test("view reads state, head, base and mergeable through gh pr view --json", async () => {
  fixture([run("SUCCESS")], { state: "MERGED", mergeable: "CONFLICTING", baseRefName: "dev" });
  const v = await new GhForge().view(URL_);
  expect(v).toEqual({ state: "MERGED", head: "abc123", base: "dev", mergeable: "CONFLICTING", checks: "green" });
  expect(argvLog()).toEqual([`pr view ${URL_} --json state,headRefOid,baseRefName,mergeable,statusCheckRollup`]);
});

test("rollup mapping", async () => {
  const table: [string, unknown, string][] = [
    ["all success", [run("SUCCESS"), run("SUCCESS")], "green"],
    ["a failed run", [run("SUCCESS"), run("FAILURE")], "red"],
    ["a cancelled run", [run("CANCELLED")], "red"],
    ["a timed-out run", [run("TIMED_OUT")], "red"],
    ["an action-required run", [run("ACTION_REQUIRED")], "red"],
    ["a startup failure", [run("STARTUP_FAILURE")], "red"],
    ["a failed status context", [run("SUCCESS"), ctxState("FAILURE")], "red"],
    ["an errored status context", [ctxState("ERROR")], "red"],
    ["a run in progress", [run("SUCCESS"), run("", "IN_PROGRESS")], "pending"],
    ["a pending status context", [ctxState("PENDING")], "pending"],
    ["red beats pending", [run("", "QUEUED"), run("FAILURE")], "red"],
    ["a stale run", [run("SUCCESS"), run("STALE")], "pending"],
    ["a completed run with no conclusion", [{ __typename: "CheckRun", status: "COMPLETED", conclusion: null }], "pending"],
    ["an unknown conclusion", [run("SOMETHING_NEW")], "pending"],
    ["an expected status context", [ctxState("EXPECTED")], "pending"],
    ["an unknown status context state", [ctxState("WEIRD")], "pending"],
    ["an empty rollup", [], "none"],
    ["a null rollup", null, "none"],
    ["skipped and success", [run("SKIPPED"), run("SUCCESS")], "green"],
    ["a neutral run", [run("NEUTRAL")], "green"],
    ["a successful status context", [ctxState("SUCCESS")], "green"],
  ];
  for (const [name, rollup, want] of table) {
    fixture(rollup);
    expect([name, (await new GhForge().view(URL_)).checks]).toEqual([name, want]);
  }
});

test("merge passes --merge and the head oid", async () => {
  await new GhForge().merge(URL_, "abc123");
  expect(argvLog()).toEqual([`pr merge ${URL_} --merge --match-head-commit abc123`]);
});

test("a failing gh merge throws and a failing gh view throws", async () => {
  process.env.GH_FAIL = "1";
  await expect(new GhForge().merge(URL_, "abc123")).rejects.toThrow("gh pr merge failed: boom");
  process.env.GH_FIXTURE = join(dir, "missing.json");
  await expect(new GhForge().view(URL_)).rejects.toThrow("gh pr view failed");
});

test("prUrl refuses a non-PR URL", async () => {
  for (const bad of [
    "https://github.com/o/r/pulls/7", "http://github.com/o/r/pull/7", "https://github.com/o/r/pull/7 and more",
    "https://github.com/o/r/pull/7/files", "https://github.com/o/pull/7", "https://github.com/o/r/pull/x", "",
  ]) {
    await expect(prUrl(["printf", "%s", bad])).rejects.toBeInstanceOf(PrUrlError);
  }
});

test("a pr argv that exits non-zero is a failed read to retry, not a bad URL", async () => {
  const e = await prUrl(["false"]).catch((x) => x);
  expect(e).toBeInstanceOf(ForgeReadError);
  expect(e).not.toBeInstanceOf(PrUrlError);
  expect((e as ForgeReadError).what).toBe("pr url");
});

test("control: prUrl accepts a PR URL, with trailing newline trimmed", async () => {
  expect(await prUrl(["echo", "https://github.com/o/r/pull/7"])).toBe("https://github.com/o/r/pull/7");
});
