import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { tick, type TickReport } from "../src/engine.ts";
import type { PrView } from "../src/forge.ts";
import { notifyOnce } from "../src/notify.ts";
import { openStore, type RunState } from "../src/state.ts";
import { FakeHost } from "./fake-host.ts";
import { commit, FakeForge, git } from "./fake-forge.ts";

const T0 = Date.parse("2026-10-22T10:00:00.000Z");
const saved = { state: process.env.BATON_STATE_DIR, config: process.env.BATON_CONFIG, home: process.env.HOME };
let root: string, state: string, repo: string, origin: string, other: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "baton-merge-")));
  state = join(root, "state");
  mkdirSync(join(root, "home"));
  process.env.BATON_STATE_DIR = state;
  process.env.BATON_CONFIG = join(root, "config.json");
  process.env.HOME = join(root, "home");
  origin = join(root, "origin.git");
  repo = join(root, "repo");
  other = join(root, "other");
  git(root, "init", "--bare", "-b", "main", origin);
  git(root, "clone", origin, repo);
  git(root, "clone", origin, other);
  for (const d of [repo, other]) {
    git(d, "config", "user.email", "t@example.com");
    git(d, "config", "user.name", "t");
    git(d, "config", "commit.gpgsign", "false");
  }
  commit(repo, "init");
  git(repo, "push", "origin", "main");
  git(other, "pull", "origin", "main");
});
afterEach(() => {
  for (const [k, v] of [["BATON_STATE_DIR", saved.state], ["BATON_CONFIG", saved.config], ["HOME", saved.home]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** A branch commit merged with a merge commit into origin's main: the shape of a landed PR. Returns the branch head. */
function landPr(name: string): string {
  git(other, "pull", "origin", "main");
  git(other, "checkout", "-b", name);
  const head = commit(other, name);
  git(other, "checkout", "main");
  git(other, "merge", "--no-ff", "-m", `merge ${name}`, name);
  git(other, "push", "origin", "main");
  return head;
}

const URL1 = "https://github.com/o/r/pull/1";
const URL2 = "https://github.com/o/r/pull/2";
const green: PrView = { state: "OPEN", head: "h1", base: "main", mergeable: "MERGEABLE", checks: "green" };

function mergeStage(over: Record<string, unknown> = {}) {
  return {
    kind: "merge", pr: ["echo", "https://github.com/o/r/pull/{unit.vars.n}"], base: "main", repo: "{param.repo}",
    ordered: true, outcomes: { merged: "done", red: "fixing", conflict: "fixing" }, ...over,
  };
}
const fixing = { kind: "wait", outcomes: [{ when: [{ file: "{run.dir}/never" }], to: "done" }] };

async function arm(stage: Record<string, unknown>, units: string[] = ["o1"]) {
  const rec = {
    version: 1, name: "rec", params: ["root", "repo"], sources: [],
    seed: units.map((id, i) => ({ id, stage: "merge", vars: { n: String(i + 1) } })),
    stages: { merge: stage, fixing },
  };
  const file = join(root, "r1.recipe.json");
  writeFileSync(file, JSON.stringify(rec));
  expect(await main(["arm", file, "--run", "r1", "--param", `root=${root}`, "--param", `repo=${repo}`, "--no-timer"])).toBe(0);
}

let forge: FakeForge;
const doTick = (): Promise<TickReport> =>
  tick({ store: openStore(state), host: new FakeHost({}), forge, notify: notifyOnce, now: () => new Date(T0) });
const runState = (): RunState => openStore(state).readRun("r1");
const stageOf = (u: string) => runState().units[u].stage;
const parkedOf = (u: string) => runState().units[u].parked?.reason;
const kinds = () =>
  readFileSync(join(state, "runs", "r1", "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).kind as string);

beforeEach(() => { forge = new FakeForge(); });

test("merges in declared order", async () => {
  forge.views.set(URL1, { ...green, head: "h1" });
  forge.views.set(URL2, { ...green, head: "h2" });
  await arm(mergeStage(), ["o1", "o2"]);
  await doTick();
  expect(forge.merges).toEqual([{ url: URL1, head: "h1" }]); // o2 waits while o1 is not done

  // Control: once o1 has landed and is done, o2 goes in the same tick.
  forge.views.set(URL1, { ...green, state: "MERGED", head: landPr("b1") });
  await doTick();
  expect(stageOf("o1")).toBe("done");
  expect(forge.merges).toEqual([{ url: URL1, head: "h1" }, { url: URL2, head: "h2" }]);
});

test("unordered stages merge every ready unit", async () => {
  forge.views.set(URL1, { ...green, head: "h1" });
  forge.views.set(URL2, { ...green, head: "h2" });
  await arm(mergeStage({ ordered: false }), ["o1", "o2"]);
  await doTick();
  expect(forge.merges.map((m) => m.url)).toEqual([URL1, URL2]);
});

test("zero checks wait unless none-required", async () => {
  forge.views.set(URL1, { ...green, checks: "none" });
  await arm(mergeStage());
  await doTick();
  expect(forge.merges).toEqual([]);
  expect(stageOf("o1")).toBe("merge");
});

test("control: zero checks merge when the stage says none-required", async () => {
  forge.views.set(URL1, { ...green, checks: "none" });
  await arm(mergeStage({ checks: "none-required" }));
  await doTick();
  expect(forge.merges).toEqual([{ url: URL1, head: "h1" }]);
});

test("pending checks wait", async () => {
  forge.views.set(URL1, { ...green, checks: "pending" });
  await arm(mergeStage({ checks: "none-required" }));
  await doTick();
  expect(forge.merges).toEqual([]);
});

test("unknown mergeability waits", async () => {
  forge.views.set(URL1, { ...green, mergeable: "UNKNOWN" });
  await arm(mergeStage());
  await doTick();
  expect(forge.merges).toEqual([]);
  expect(stageOf("o1")).toBe("merge");
  forge.views.set(URL1, green); // control: mergeable merges
  await doTick();
  expect(forge.merges.length).toBe(1);
});

test("conflict follows the conflict outcome", async () => {
  forge.views.set(URL1, { ...green, mergeable: "CONFLICTING" });
  await arm(mergeStage({ outcomes: { merged: "done", red: "done", conflict: "fixing" } }));
  await doTick();
  expect(stageOf("o1")).toBe("fixing");
  expect(forge.merges).toEqual([]);
});

test("red checks follow the red outcome", async () => {
  forge.views.set(URL1, { ...green, checks: "red" });
  await arm(mergeStage({ outcomes: { merged: "done", red: "fixing", conflict: "done" } }));
  await doTick();
  expect(stageOf("o1")).toBe("fixing");
  expect(forge.merges).toEqual([]);
});

test("head read this tick is the one merged, from one view per URL", async () => {
  forge.views.set(URL1, green);
  forge.rotateHead = "head-";
  await arm(mergeStage());
  await doTick();
  expect(forge.viewCalls).toEqual([URL1]);
  expect(forge.merges).toEqual([{ url: URL1, head: "head-1" }]);
  await doTick(); // not merged yet: the next tick merges the head it read then
  expect(forge.merges[1]).toEqual({ url: URL1, head: "head-2" });
});

test("a merge call that fails retries, and the third failure parks merge failed", async () => {
  forge.views.set(URL1, green);
  forge.mergeFails = 3;
  await arm(mergeStage());
  await doTick();
  await doTick();
  expect(parkedOf("o1")).toBeUndefined();
  expect(runState().units.o1.merge_failures).toBe(2);
  await doTick();
  expect(parkedOf("o1")).toBe("merge failed");
  expect(kinds().filter((k) => k === "merge call failed").length).toBe(3);
});

test("a successful merge call resets the failure count", async () => {
  forge.views.set(URL1, green);
  forge.mergeFails = 2;
  await arm(mergeStage());
  await doTick();
  await doTick();
  await doTick(); // succeeds
  expect(runState().units.o1.merge_failures).toBeUndefined();
  expect(forge.merges.length).toBe(1);
  expect(parkedOf("o1")).toBeUndefined();
});

test("merged but not on origin base parks not landed", async () => {
  const local = commit(repo, "local-only"); // never pushed
  forge.views.set(URL1, { ...green, state: "MERGED", head: local });
  await arm(mergeStage());
  const r = await doTick();
  expect(parkedOf("o1")).toBe("not landed");
  expect(stageOf("o1")).toBe("merge");
  expect(r.merged).toEqual([]);
  expect(kinds()).not.toContain("merged");
});

test("merged with a head unknown to the checkout parks not landed", async () => {
  forge.views.set(URL1, { ...green, state: "MERGED", head: "0123456789012345678901234567890123456789" });
  await arm(mergeStage());
  await doTick();
  expect(parkedOf("o1")).toBe("not landed");
});

test("merged and landed runs run_after then moves on", async () => {
  const head = landPr("feat");
  forge.views.set(URL1, { ...green, state: "MERGED", head });
  await arm(mergeStage({ run_after: [["touch", "{run.dir}/after-{pr.head}"]] }));
  const r = await doTick();
  expect(existsSync(join(state, "runs", "r1", `after-${head}`))).toBe(true);
  expect(stageOf("o1")).toBe("done");
  expect(r.merged).toEqual(["o1"]);
  expect(kinds()).toContain("merged");
  expect(forge.merges).toEqual([]); // nothing to merge: the PR was already merged
});

test("a failing run_after parks and does not report merged", async () => {
  forge.views.set(URL1, { ...green, state: "MERGED", head: landPr("feat") });
  await arm(mergeStage({ run_after: [["false"]] }));
  await doTick();
  expect(parkedOf("o1")).toBe("run failed");
  expect(kinds()).not.toContain("merged");
});

test("wrong base parks", async () => {
  forge.views.set(URL1, { ...green, base: "release" });
  await arm(mergeStage());
  await doTick();
  expect(parkedOf("o1")).toBe("wrong base");
  expect(forge.merges).toEqual([]);
});

test("a closed PR parks pr closed", async () => {
  forge.views.set(URL1, { ...green, state: "CLOSED" });
  await arm(mergeStage());
  await doTick();
  expect(parkedOf("o1")).toBe("pr closed");
});

test("a pr argv that prints no PR URL parks pr url", async () => {
  await arm(mergeStage({ pr: ["echo", "https://github.com/o/r/pulls/1"] }));
  await doTick();
  expect(parkedOf("o1")).toBe("pr url");
  expect(forge.viewCalls).toEqual([]);
});

test("a view that fails is retried next tick without parking", async () => {
  await arm(mergeStage()); // no fake PR yet: view throws
  await doTick();
  expect(parkedOf("o1")).toBeUndefined();
  expect(kinds()).toContain("view failed");
  forge.views.set(URL1, green);
  await doTick();
  expect(forge.merges.length).toBe(1);
});
