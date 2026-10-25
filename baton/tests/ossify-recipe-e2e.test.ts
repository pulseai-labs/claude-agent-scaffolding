// The example ossify-spine recipe, end to end: baton's real engine drives it against the fake
// host, a forge that lands real merge commits, a fake `oss` over a real state file, and real
// temp git repos. The seats are callbacks (`effects`): each makes, when its thread completes,
// the file and state changes a real seat makes through `oss`. Nothing here runs a model.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main } from "../src/cli.ts";
import { tick } from "../src/engine.ts";
import type { PrView } from "../src/forge.ts";
import type { LaunchRequest } from "../src/host.ts";
import { notifyOnce } from "../src/notify.ts";
import { openStore, type RunState } from "../src/state.ts";
import { commit, FakeForge, git } from "./fake-forge.ts";
import { type Behaviour, FakeHost } from "./fake-host.ts";
import { loadRecipe, RECIPE_PATH } from "./ossify-recipe-helpers.ts";

const FAKE_OSS = join(import.meta.dir, "fixtures", "fake-oss");
const BRIEFS = join(import.meta.dir, "..", "examples", "ossify-spine", "briefs");
const SPINE = "r0.s6";
const BRANCH = "spine/r0.s6-demo";
const W1 = "r0.s6.w1";
const W2 = "r0.s6.w2";
const SPINE_UNIT = "spine-pr";
const T0 = Date.parse("2026-10-22T10:00:00.000Z");
/** Each tick moves the clock 5 minutes: a quiet session settles (10 minutes) after two. */
const STEP_MS = 5 * 60_000;

const saved = { state: process.env.BATON_STATE_DIR, config: process.env.BATON_CONFIG, home: process.env.HOME };
let root: string, state: string, aiRoot: string, stateFile: string, spineDir: string;
let repo: string, origin: string, other: string, runDir: string, clock: number;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "baton-ossify-e2e-")));
  state = join(root, "state");
  mkdirSync(join(root, "home"));
  process.env.BATON_STATE_DIR = state;
  process.env.BATON_CONFIG = join(root, "config.json");
  process.env.HOME = join(root, "home");
  aiRoot = join(root, "ai");
  stateFile = join(aiRoot, ".ossify", "project-state.json");
  spineDir = join(aiRoot, "docs", "spines", SPINE);
  mkdirSync(dirname(stateFile), { recursive: true });
  mkdirSync(spineDir, { recursive: true });
  for (const wi of [W1, W2]) mkdirSync(join(root, "wt", wi), { recursive: true });
  // The canonical: a bare origin, the canonical root on the spine branch, and a second clone
  // the forge lands merges from.
  origin = join(root, "origin.git");
  repo = join(root, "canon");
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
  git(repo, "checkout", "-b", BRANCH);
  git(repo, "push", "-u", "origin", BRANCH);
  git(other, "fetch", "origin");
  runDir = join(state, "runs", "r1");
  clock = T0;
  setState({ [W1]: 0, [W2]: 0 });
});
afterEach(() => {
  for (const [k, v] of [["BATON_STATE_DIR", saved.state], ["BATON_CONFIG", saved.config], ["HOME", saved.home]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true });
});

// ---- ossify's state, through the fake `oss` -------------------------------------------------

type Item = { id: string; status: string; dispatches: number; pr_url?: string };
function setState(dispatches: Record<string, number>): void {
  const work_items = Object.entries(dispatches).map(([id, d]) => ({ id, status: "active", dispatches: d }));
  writeFileSync(stateFile, JSON.stringify({ spines: [{ id: SPINE, status: "active" }], work_items }, null, 2));
}
const readState = () => JSON.parse(readFileSync(stateFile, "utf8")) as { spines: { id: string; status: string }[]; work_items: Item[] };
const item = (wi: string): Item => readState().work_items.find((w) => w.id === wi)!;
function oss(...args: string[]): void {
  const p = Bun.spawnSync([FAKE_OSS, ...args], { cwd: aiRoot, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`fake-oss ${args.join(" ")}: rc ${p.exitCode} ${p.stderr.toString()}`);
}

// ---- the forge -------------------------------------------------------------------------------

const PR_NO: Record<string, number> = { [W1]: 1, [W2]: 2, [SPINE_UNIT]: 9 };
const prUrl = (unit: string) => `https://github.com/o/canon/pull/${PR_NO[unit]}`;
const openPr = (base: string): PrView => ({ state: "OPEN", head: "pending", base, mergeable: "MERGEABLE", checks: "green" });

/** e2e.test.ts's LandingForge on the spine branch: a merge lands a real merge commit on origin. */
class SpineForge extends FakeForge {
  /** origin's spine tip right after each PR's merge commit was pushed, by URL. */
  landedTip = new Map<string, string>();
  constructor() {
    super();
    for (const wi of [W1, W2]) this.views.set(prUrl(wi), openPr(BRANCH));
    this.views.set(prUrl(SPINE_UNIT), openPr("main"));
  }
  override async merge(url: string, head: string): Promise<void> {
    await super.merge(url, head);
    const name = Object.keys(PR_NO).find((u) => prUrl(u) === url)!;
    git(other, "fetch", "origin");
    git(other, "checkout", "-B", BRANCH, `origin/${BRANCH}`);
    git(other, "checkout", "-b", `pr-${name}`);
    const branchHead = commit(other, `pr-${name}`);
    git(other, "checkout", BRANCH);
    git(other, "merge", "--no-ff", "-m", `merge ${name}`, `pr-${name}`);
    git(other, "push", "origin", BRANCH);
    this.landedTip.set(url, git(other, "rev-parse", "HEAD"));
    this.views.set(url, { ...this.views.get(url)!, state: "MERGED", head: branchHead });
  }
}
const originTip = () => git(origin, "rev-parse", BRANCH);
const repoTip = () => git(repo, "rev-parse", BRANCH);
const mergeCommits = () => git(origin, "log", "--merges", "--reverse", "--format=%s", BRANCH).split("\n").filter(Boolean);

// ---- the host and its seats --------------------------------------------------------------------

/** `[baton <run>/<unit>/<stage>/<seq>]` in a launch title. */
function nonceParts(r: LaunchRequest): { unit: string; stage: string } {
  const m = /\[baton ([^\]]*)\]\s*$/.exec(r.title)!;
  const [, unit, stage] = m[1].split("/");
  return { unit, stage };
}

type Effect = (unit: string, n: number) => void;

/** FakeHost plus seats: when a thread completes, `effects[stage](unit, n)` runs, n its nth completion. */
class SeatHost extends FakeHost {
  advances = 0;
  effects: Record<string, Effect> = {};
  private born: number[] = [];
  private completions = new Map<string, number>();
  override async launch(r: LaunchRequest): Promise<{ threadId: string }> {
    const res = await super.launch(r);
    this.born.push(this.advances);
    return res;
  }
  override advance(): void {
    super.advance();
    this.advances++;
    this.launches.forEach((l, i) => {
      if (this.advances - this.born[i] !== l.behaviour.ticks) return;
      const { unit, stage } = nonceParts(l.request);
      const key = `${unit}/${stage}`;
      const n = (this.completions.get(key) ?? 0) + 1;
      this.completions.set(key, n);
      this.effects[stage]?.(unit, n);
    });
  }
  of(unit: string, stage: string) {
    return this.launches.filter((l) => {
      const p = nonceParts(l.request);
      return p.unit === unit && p.stage === stage;
    });
  }
}

const SESSION_STAGES = ["lane", "implement", "regap", "close", "reclose", "correct", "spine_open", "spine_review", "spine_work", "spine_finish"];
const oneTick = (): Behaviour => ({ ticks: 1, end: "completed" });

const out = (unit: string, name: string) => join(runDir, "out", unit, name);
const workFile = (wi: string, name: string) => join(spineDir, `work-${wi}`, name);
function put(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  // temp name without .json, then rename: baton parks the whole run on a half-written record
  writeFileSync(path + ".tmp", content);
  renameSync(path + ".tmp", path);
}

/** ossify's §3 request record, flat (ruling T2-1), plus round, order and issued_at. */
function queue(wi: string, round: number, order: number, issuedAt = new Date(clock).toISOString()): void {
  put(join(runDir, "queue", `${wi}.json`), JSON.stringify({
    work_item_id: wi,
    target_repo: "canonical",
    handoff_path: workFile(wi, "handoff.md"),
    spec_path: workFile(wi, "spec.md"),
    worktree_path: join(root, "wt", wi),
    branch: `work/${wi}`,
    base_sha: "a".repeat(40),
    round, order, issued_at: issuedAt,
  }));
}

/** What a seat that does its job writes, per stage. Tests replace entries. */
function seats(): Record<string, Effect> {
  return {
    implement: (u) => put(workFile(u, "report.md"), "report"),
    close: (u) => oss("work_item_pr", u, prUrl(u)),
    reclose: (u) => oss("work_item_pr", u, prUrl(u)),
    correct: (u) => put(out(u, "corrected"), "x"),
    regap: (u) => {
      const rec = JSON.parse(readFileSync(join(runDir, "queue", `${u}.json`), "utf8"));
      queue(u, rec.round, rec.order, new Date(clock + 1000).toISOString());
    },
    spine_open: () => put(join(runDir, "spine", `${SPINE_UNIT}.json`),
      JSON.stringify({ id: SPINE_UNIT, group: 0, order: 0, pr_url: prUrl(SPINE_UNIT) })),
    spine_review: (u) => put(out(u, "review.md"), "verdict: pass\nhead: abc123\nno findings\n"),
    spine_work: (u) => put(out(u, "round-done"), "x"),
    spine_finish: () => {
      const s = readState();
      s.spines.find((x) => x.id === SPINE)!.status = "closed";
      writeFileSync(stateFile, JSON.stringify(s, null, 2));
    },
  };
}

/** What close writes on a red gate: ossify's correction packet (correction-continuation.md §2). */
function packet(wi: string, failure: string): string {
  return ["OSSIFY CORRECTION CONTINUATION v1", `handoff_path: ${workFile(wi, "handoff.md")}`, `work_item_id: ${wi}`,
    `expected_branch: work/${wi}`, `expected_head_sha: ${"a".repeat(40)}`, `expected_tree_oid: ${"b".repeat(40)}`,
    "failures:", `- ${failure}`, ""].join("\n");
}
/** A Layer 4 red: close writes the `[fidelity]` finding to verify.md and the packet. */
const fidelityRed = (u: string) => {
  put(workFile(u, "verify.md"), "## Findings\n- [fidelity] AC2 is not what the spec says\n");
  put(out(u, "correction.txt"), packet(u, "[fidelity] AC2 is not what the spec says"));
};

function newHost(lane: Effect, extra: Record<string, Effect> = {}): SeatHost {
  const host = new SeatHost(Object.fromEntries(SESSION_STAGES.map((s) => [s, oneTick()])));
  host.effects = { ...seats(), lane, ...extra };
  return host;
}

async function arm(): Promise<void> {
  loadRecipe(); // throws with baton's errors if the example does not validate
  const params: Record<string, string> = {
    spine: SPINE, spine_branch: BRANCH, spine_dir: spineDir, ai_root: aiRoot, ai_project: "demo-ai",
    repo, project: "demo", state_file: stateFile, oss: FAKE_OSS, briefs: BRIEFS, via: "omp-glm-flash",
  };
  const args = ["arm", RECIPE_PATH, "--run", "r1", "--no-timer"];
  for (const [k, v] of Object.entries(params)) args.push("--param", `${k}=${v}`);
  expect(await main(args)).toBe(0);
}

const readRun = (): RunState => openStore(state).readRun("r1");
const unit = (id: string) => readRun().units[id];
type Ev = Record<string, string>;
const events = (): Ev[] =>
  readFileSync(join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Ev);
const moves = (u: string) => events().filter((e) => e.kind === "transition" && e.unit === u).map((e) => `${e.from}>${e.to}`);
/** Index in events.jsonl of the first event matching `f`; -1 when none. */
const at = (f: (e: Ev) => boolean) => events().findIndex(f);
const moved = (u: string, from: string, to: string) => at((e) => e.kind === "transition" && e.unit === u && e.from === from && e.to === to);
const launchedEv = (u: string, stage: string, seq = 1) => at((e) => e.kind === "launched" && e.nonce === `r1/${u}/${stage}/${seq}`);

type Rig = { host: SeatHost; forge: SpineForge; notes: string[] };
function rig(host: SeatHost, forge = new SpineForge()): Rig {
  return { host, forge, notes: [] };
}

/** tick, advance (seats run), `between(i)`, clock +5 min; stops when `until` holds. Returns ticks run. */
async function drive(r: Rig, max: number, until: () => boolean, between: (i: number) => void = () => {}): Promise<number> {
  for (let i = 1; i <= max; i++) {
    const now = new Date(clock);
    await tick({
      store: openStore(state), host: r.host, forge: r.forge, now: () => now,
      notify: async (k, m) => { r.notes.push(m); await notifyOnce(k, m); },
    });
    r.host.advance();
    between(i);
    clock += STEP_MS;
    if (until()) return i;
  }
  throw new Error(`drive: condition not met in ${max} ticks; units: ${JSON.stringify(Object.values(readRun().units).map((u) => [u.id, u.stage, u.parked?.reason ?? null]))}`);
}
const settle = async (r: Rig, n: number) => {
  let i = 0;
  await drive(r, n, () => ++i >= n);
};

// ---- the tests -----------------------------------------------------------------------------------

test("a two-item round runs to the second spine close", async () => {
  await arm();
  const host = newHost((_u, n) => {
    if (n === 1) {
      queue(W1, 1, 1);
      queue(W2, 1, 2);
      put(out("lane", "lane.done"), "x");
    } else put(join(runDir, "rounds.done"), "x");
  });
  const r = rig(host);
  const seen: Record<string, { repo: string; head: string; status: string; dispatches: number }> = {};
  await drive(r, 80, () => readRun().status === "done", () => {
    const run = readRun();
    for (const wi of [W1, W2]) {
      if (run.units[wi]?.stage === "done" && !seen[wi]) {
        seen[wi] = { repo: repoTip(), head: git(repo, "symbolic-ref", "--short", "HEAD"), status: item(wi).status, dispatches: item(wi).dispatches };
      }
    }
    // The operator merges the spine PR by hand once baton asks.
    if (run.units[SPINE_UNIT]?.stage === "spine_ack") {
      r.forge.views.set(prUrl(SPINE_UNIT), { ...r.forge.views.get(prUrl(SPINE_UNIT))!, state: "MERGED", head: "spinehead" });
    }
  });

  const run = readRun();
  expect(run.status).toBe("done");
  // w1 merged before w2, each as one merge commit on the spine branch.
  expect(r.forge.merges.map((m) => m.url)).toEqual([prUrl(W1), prUrl(W2)]);
  expect(mergeCommits()).toEqual([`merge ${W1}`, `merge ${W2}`]);
  // After each merge the canonical root's spine branch is origin's as that merge left it.
  for (const wi of [W1, W2]) {
    expect(seen[wi]).toEqual({ repo: r.forge.landedTip.get(prUrl(wi))!, head: BRANCH, status: "complete", dispatches: 1 });
  }
  expect(repoTip()).toBe(originTip());
  for (const wi of [W1, W2]) expect(moves(wi)).toEqual(["implement>close", "close>land", "land>done"]);
  expect(moves("lane")).toEqual(["lane>lane_wait", "lane_wait>lane", "lane>spine_open", "spine_open>done"]);
  expect(moves(SPINE_UNIT)).toEqual(["spine_review>spine_wait", "spine_wait>spine_ack", "spine_ack>spine_finish", "spine_finish>done"]);
  expect(host.of("lane", "lane")).toHaveLength(2);
  // One notice names the spine PR: the ask to merge it.
  const log = readFileSync(join(state, "notify.log"), "utf8").split("\n").filter((l) => l.includes(prUrl(SPINE_UNIT)));
  expect(log).toHaveLength(1);
  expect(log[0]).toContain("merge it by hand");
  expect(readState().spines[0].status).toBe("closed");
  expect(readdirSync(join(state, "claims"))).toEqual([]);
});

test("a gap waits for a live sibling", async () => {
  await arm();
  const host = newHost((_u, n) => {
    if (n === 1) { queue(W1, 1, 1); queue(W2, 1, 2); put(out("lane", "lane.done"), "x"); }
  }, {
    implement: (u, n) => (u === W1 && n === 1 ? put(out(u, "gaps.json"), "{}") : put(workFile(u, "report.md"), "r")),
  });
  host.script.implement = { ticks: 3, end: "completed" }; // w2's implementer is at work for three ticks
  const r = rig(host);
  // The build slot (1) runs one implementer at a time: w2's launches in the tick w1 gaps.
  let held = 0;
  await drive(r, 40, () => host.of(W1, "implement").length === 2, () => {
    const run = readRun();
    if (run.units[W1]?.stage === "gap_wait" && run.units[W2]?.session) held++;
  });

  // w1 sat in gap_wait while w2's implementer was live; regap launched only after w2's session ended.
  const w2Ended = moved(W2, "implement", "close");
  expect(held).toBeGreaterThanOrEqual(2);
  expect(moved(W1, "implement", "gap_wait")).toBeLessThan(w2Ended);
  expect(launchedEv(W1, "regap")).toBeGreaterThan(w2Ended);
  // regap rewrote w1's record: w1 relaunched, counted as its second dispatch.
  expect(moves(W1)).toEqual(["implement>gap_wait", "gap_wait>regap", "regap>implement"]);
  expect(item(W1).dispatches).toBe(2);
  expect(existsSync(out(W1, "gaps.json"))).toBe(false); // the answered gap went with the before hook
});

test("two gaps in a round re-enter one at a time", async () => {
  await arm();
  const host = newHost((_u, n) => {
    if (n === 1) { queue(W1, 1, 1); queue(W2, 1, 2); put(out("lane", "lane.done"), "x"); }
  }, {
    implement: (u, n) => (n === 1 ? put(out(u, "gaps.json"), "{}") : put(workFile(u, "report.md"), "r")),
  });
  const r = rig(host);
  await drive(r, 60, () => host.of(W2, "regap").length === 1 || unit(W2)?.parked !== undefined);

  // w2's re-entry launched only after w1 re-entered, relaunched its implementer, and left implement:
  // never in the tick w1's regap ended, when w1 sat in implement with no session yet.
  const w1Closed = moved(W1, "implement", "close");
  expect(w1Closed).toBeGreaterThan(-1); // -1 (never) would make the next comparison vacuous
  expect(launchedEv(W2, "regap")).toBeGreaterThan(w1Closed);
  expect(launchedEv(W1, "implement", 2)).toBeGreaterThan(moved(W1, "regap", "implement"));
  expect(moves(W1).slice(0, 4)).toEqual(["implement>gap_wait", "gap_wait>regap", "regap>implement", "implement>close"]);
  expect(moves(W2)).toEqual(["implement>gap_wait", "gap_wait>regap"]);
});

test("a gap with no sibling live re-enters on the next tick", async () => {
  await arm();
  const host = newHost((_u, n) => {
    if (n === 1) { queue(W1, 1, 1); put(out("lane", "lane.done"), "x"); }
  }, {
    implement: (u, n) => (n === 1 ? put(out(u, "gaps.json"), "{}") : put(workFile(u, "report.md"), "r")),
  });
  const r = rig(host);
  let gapAt = 0, regapAt = 0;
  await drive(r, 30, () => regapAt > 0, (i) => {
    if (!gapAt && unit(W1)?.stage === "gap_wait") gapAt = i;
    if (!regapAt && host.of(W1, "regap").length) regapAt = i;
  });
  expect(gapAt).toBeGreaterThan(0);
  expect(regapAt).toBe(gapAt + 1);
});

test("a gap waits while a sibling is in correction", async () => {
  await arm();
  // w2 is declared first, so it implements and closes before w1's implementer gaps.
  const host = newHost((_u, n) => {
    if (n === 1) { queue(W2, 1, 1); queue(W1, 1, 2); put(out("lane", "lane.done"), "x"); }
  }, {
    implement: (u, n) => (u === W1 && n === 1 ? put(out(u, "gaps.json"), "{}") : put(workFile(u, "report.md"), "r")),
    close: fidelityRed,
    correct: (u, n) => put(out(u, n === 1 ? "stop" : "corrected"), "x"),
  });
  const r = rig(host);
  await drive(r, 40, () => unit(W2)?.parked !== undefined);
  await settle(r, 5);

  let w2 = unit(W2);
  expect(w2.stage).toBe("correct");
  expect(w2.parked?.reason).toBe("stop");
  expect(w2.session).toBeUndefined();
  expect(unit(W1).stage).toBe("gap_wait");
  expect(host.of(W1, "regap")).toHaveLength(0);

  // Control: the operator clears the stop and unparks w2; regap launches once w2 reaches land.
  rmSync(out(W2, "stop"));
  expect(await main(["unpark", "r1", W2])).toBe(0);
  let w2AtRegap = "";
  await drive(r, 30, () => host.of(W1, "regap").length > 0, () => {
    if (!w2AtRegap && host.of(W1, "regap").length) w2AtRegap = unit(W2).stage;
  });
  expect(w2AtRegap).toBe("land");
  expect(moves(W2)).toEqual(["implement>close", "close>correct", "correct>reclose", "reclose>land"]);
  expect(launchedEv(W1, "regap")).toBeGreaterThan(moved(W2, "reclose", "land"));
});

test("an item at the dispatch cap parks before a fourth execution", async () => {
  setState({ [W1]: 2, [W2]: 3 });
  await arm();
  const host = newHost((_u, n) => {
    if (n === 1) { queue(W1, 1, 1); queue(W2, 1, 2); put(out("lane", "lane.done"), "x"); }
  }, {
    close: fidelityRed,
  });
  const r = rig(host);
  await drive(r, 40, () => unit(W1)?.parked !== undefined && unit(W2)?.parked !== undefined);
  await settle(r, 3);

  // w1: its third execution (implement) ran; the correction that would be the fourth did not.
  expect(unit(W1).stage).toBe("correct");
  expect(unit(W1).parked?.reason).toBe("before failed");
  expect(host.of(W1, "implement")).toHaveLength(1);
  expect(host.of(W1, "correct")).toHaveLength(0);
  expect(item(W1).dispatches).toBe(3);
  // w2 came in at the cap: no implement launch at all.
  expect(unit(W2).stage).toBe("implement");
  expect(unit(W2).parked?.reason).toBe("before failed");
  expect(host.of(W2, "implement")).toHaveLength(0);
  expect(item(W2).dispatches).toBe(3);
});

test("control: an item below the dispatch cap launches its correction", async () => {
  setState({ [W1]: 1, [W2]: 0 });
  await arm();
  const host = newHost((_u, n) => {
    if (n === 1) { queue(W1, 1, 1); put(out("lane", "lane.done"), "x"); }
  }, {
    close: fidelityRed,
  });
  const r = rig(host);
  await drive(r, 30, () => host.of(W1, "correct").length === 1);
  expect(unit(W1).parked).toBeUndefined();
  expect(item(W1).dispatches).toBe(3);
});

test("a lane that writes nothing parks instead of looping", async () => {
  await arm();
  const host = newHost(() => put(out("lane", "lane.done"), "x"));
  const r = rig(host);
  await drive(r, 10, () => unit("lane").parked !== undefined);
  await settle(r, 5);

  expect(unit("lane").stage).toBe("lane");
  expect(unit("lane").parked?.reason).toBe("outcome");
  expect(host.of("lane", "lane")).toHaveLength(1);
  // The recipe's driver settles the park: it wrote no result, so the park is escalated.
  expect(r.notes).toEqual(["baton r1/lane parked in lane: outcome — driver gave no valid result (no result file)"]);
  expect(existsSync(out("lane", "lane.done"))).toBe(false);
});

test("a merged item with the canonical root off the spine branch parks", async () => {
  git(repo, "checkout", "main");
  const mainBefore = git(repo, "rev-parse", "main");
  await arm();
  const host = newHost((_u, n) => {
    if (n === 1) { queue(W1, 1, 1); put(out("lane", "lane.done"), "x"); }
  });
  const r = rig(host);
  await drive(r, 30, () => unit(W1)?.parked !== undefined);

  expect(r.forge.merges.map((m) => m.url)).toEqual([prUrl(W1)]); // merged on the remote
  expect(unit(W1).stage).toBe("land");
  expect(unit(W1).parked?.reason).toBe("run failed"); // generic: any run_after argv failing reads the same
  expect(git(repo, "rev-parse", "main")).toBe(mainBefore); // load-bearing: nothing fast-forwarded main
  expect(git(repo, "symbolic-ref", "--short", "HEAD")).toBe("main");
  expect(item(W1).status).toBe("active");
});

test("item CI red parks", async () => {
  await arm();
  const host = newHost((_u, n) => {
    if (n === 1) { queue(W1, 1, 1); put(out("lane", "lane.done"), "x"); }
  });
  const forge = new SpineForge();
  forge.views.set(prUrl(W1), { ...openPr(BRANCH), checks: "red" });
  const r = rig(host, forge);
  await drive(r, 30, () => unit(W1)?.parked !== undefined);

  expect(unit(W1).stage).toBe("land");
  expect(unit(W1).parked?.reason).toBe("outcome");
  expect(forge.merges).toEqual([]);
  expect(item(W1).status).toBe("active");
});

test("a review without a verdict relaunches, then parks", async () => {
  await arm();
  const host = newHost(() => put(join(runDir, "rounds.done"), "x"), {
    spine_review: (u) => put(out(u, "review.md"), "head: abc123\nlooks fine\n"),
  });
  const r = rig(host);
  await drive(r, 60, () => unit(SPINE_UNIT)?.parked !== undefined);

  expect(unit(SPINE_UNIT).stage).toBe("spine_review");
  expect(unit(SPINE_UNIT).parked?.reason).toBe("no result");
  expect(host.of(SPINE_UNIT, "spine_review")).toHaveLength(3);
  expect(moves(SPINE_UNIT)).toEqual([]);
  await settle(r, 5);
  expect(r.notes).toEqual([`baton r1/${SPINE_UNIT} parked in spine_review: no result — driver gave no valid result (no result file)`]);
});

test("a spine PR conflict parks the spine PR", async () => {
  await arm();
  const host = newHost(() => put(join(runDir, "rounds.done"), "x"));
  const forge = new SpineForge();
  forge.views.set(prUrl(SPINE_UNIT), { ...openPr("main"), mergeable: "CONFLICTING" });
  const r = rig(host, forge);
  await drive(r, 40, () => unit(SPINE_UNIT)?.parked !== undefined || host.of(SPINE_UNIT, "spine_work").length > 0);
  await settle(r, 3);

  expect(unit(SPINE_UNIT).stage).toBe("spine_wait");
  expect(unit(SPINE_UNIT).parked?.reason).toBe("outcome");
  expect(host.of(SPINE_UNIT, "spine_work")).toHaveLength(0);
  expect(moves(SPINE_UNIT)).toEqual(["spine_review>spine_wait"]);
});

test("a molt successor gets the handoff path and is not a dispatch", async () => {
  await arm();
  const handoff = join(aiRoot, "handoffs", "w1-molt.md");
  const host = newHost((_u, n) => {
    if (n === 1) { queue(W1, 1, 1); put(out("lane", "lane.done"), "x"); }
  }, {
    implement: (u, n) => {
      if (n === 1) put(out(u, "molt.log"), `${new Date(clock + 1000).toISOString()} handed-off ${handoff}\n`);
      else put(workFile(u, "report.md"), "r");
    },
  });
  const r = rig(host);
  await drive(r, 30, () => unit(W1)?.stage === "close");

  const launches = host.of(W1, "implement");
  expect(launches).toHaveLength(2);
  expect(launches[1].request.message).toBe(
    `Continue from the handoff at ${handoff}. Then read the brief named in it and finish the stage.`);
  expect(launches[1].claim?.nonce).toBe(launches[0].claim!.nonce); // the same claim, untouched
  expect(unit(W1).launches.implement).toBe(1);
  expect(item(W1).dispatches).toBe(1);
  expect(at((e) => e.kind === "successor" && e.unit === W1)).toBeGreaterThan(0);
});

test("the lane watches the latest round", async () => {
  await arm();
  const host = newHost((_u, n) => {
    if (n === 1) { queue(W1, 1, 1); put(out("lane", "lane.done"), "x"); }
    else if (n === 2) { queue(W2, 2, 1); put(out("lane", "lane.done"), "x"); }
    else put(join(runDir, "rounds.done"), "x");
  });
  const r = rig(host);
  await drive(r, 60, () => unit("lane").stage === "spine_open" || unit("lane").stage === "done");

  expect(moves("lane").slice(0, 5)).toEqual(["lane>lane_wait", "lane_wait>lane", "lane>lane_wait", "lane_wait>lane", "lane>spine_open"]);
  expect(events().some((e) => e.kind === "park")).toBe(false);
  // Each lane relaunch comes only after its round's last item merged.
  expect(launchedEv("lane", "lane", 2)).toBeGreaterThan(moved(W1, "land", "done"));
  expect(moved(W2, "land", "done")).toBeGreaterThan(launchedEv("lane", "lane", 2));
  expect(launchedEv("lane", "lane", 3)).toBeGreaterThan(moved(W2, "land", "done"));
  expect(readRun().units[W2].group).toBe(2);
});

test("a red close at any layer routes through the correction packet", async () => {
  await arm();
  let packetAtCorrect = false;
  const host = newHost((_u, n) => {
    if (n === 1) { queue(W1, 1, 1); put(out("lane", "lane.done"), "x"); }
  }, {
    // A Layer 1 red: impl-check halts before Layer 4, so there is no verify.md, only the packet.
    close: (u) => put(out(u, "correction.txt"), packet(u, "[AC] AC1 fails: exit 1")),
    correct: (u) => {
      packetAtCorrect = existsSync(out(u, "correction.txt"));
      put(out(u, "corrected"), "x");
    },
  });
  const r = rig(host);
  await drive(r, 40, () => unit(W1)?.stage === "done" || unit(W1)?.parked !== undefined);

  expect(existsSync(workFile(W1, "verify.md"))).toBe(false);
  expect(moves(W1)).toEqual(["implement>close", "close>correct", "correct>reclose", "reclose>land", "land>done"]);
  expect(host.of(W1, "close")).toHaveLength(1); // routed on the first close, no no-result relaunch
  expect(host.of(W1, "correct")[0].request.message).toContain(`Correction packet: ${out(W1, "correction.txt")}.`);
  expect(packetAtCorrect).toBe(true);
  expect(existsSync(out(W1, "correction.txt"))).toBe(false); // cleared on the way to reclose
  expect(item(W1).dispatches).toBe(2);
});
