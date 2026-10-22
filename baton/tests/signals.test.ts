import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { tick } from "../src/engine.ts";
import type { Forge, PrView } from "../src/forge.ts";
import { notifyOnce } from "../src/notify.ts";
import type { PrTest, Scope, Signal } from "../src/recipe.ts";
import { evaluate, Exit0Error, type EvalCtx } from "../src/signals.ts";
import { openStore, type RunState, type UnitState } from "../src/state.ts";
import { FakeHost } from "./fake-host.ts";

const saved = { state: process.env.BATON_STATE_DIR, config: process.env.BATON_CONFIG };
let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "baton-signals-")));
  process.env.BATON_STATE_DIR = join(dir, "state");
  process.env.BATON_CONFIG = join(dir, "config.json");
});
afterEach(() => {
  for (const [k, v] of [["BATON_STATE_DIR", saved.state], ["BATON_CONFIG", saved.config]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const noForge: Forge = {
  view: async () => { throw new Error("no forge"); },
  merge: async () => { throw new Error("no forge"); },
};

const unit = (id: string, group: number, stage: string, live = false): UnitState => ({
  id, group, order: 0, vars: {}, stage, launches: {}, stalls: 0,
  ...(live ? {
    session: {
      nonce: `r/${id}/${stage}/1`, claim_nonce: `r/${id}/${stage}/1`, launch_dir: "/x", claim_key: "k",
      launched_at: "t", last_progress_at: "t", progress_mark: "",
    },
  } : {}),
});

function ctx(units: UnitState[], self: UnitState, runGroup = 1): EvalCtx {
  const run: RunState = {
    id: "r", dir, recipe_sha256: "", params: {}, armed_at: "", status: "armed",
    units: Object.fromEntries([...units, self].map((u) => [u.id, u])),
  };
  const scope: Scope = {
    param: {}, unit: { id: self.id, group: String(self.group), order: self.order, vars: {} },
    run: { id: "r", dir, group: String(runGroup) }, attempt: 0,
  };
  return { run, unit: self, scope, cwd: dir, forge: noForge, prViews: new Map() };
}

const lane = unit("lane", 0, "wait_here");

test("exit0 maps rc 0/1 and parks on rc 2", async () => {
  const c = ctx([], lane);
  expect(await evaluate({ exit0: ["true"] }, c)).toBe("true");
  expect(await evaluate({ exit0: ["false"] }, c)).toBe("false");
  expect(await evaluate({ exit0: ["sh", "-c", "exit 1"] }, c)).toBe("false");
  await expect(evaluate({ exit0: ["sh", "-c", "exit 2"] }, c)).rejects.toBeInstanceOf(Exit0Error);
  await expect(evaluate({ exit0: [join(dir, "no-such-command")] }, c)).rejects.toBeInstanceOf(Exit0Error);
  // The rendered argv runs in the context's cwd.
  writeFileSync(join(dir, "here"), "");
  expect(await evaluate({ exit0: ["test", "-f", "here"] }, c)).toBe("true");

  // Through a tick: the unit parks with `exit0 error`.
  const rec = {
    version: 1, name: "rec", params: [], sources: [], seed: [{ id: "u", stage: "w" }],
    stages: { w: { kind: "wait", outcomes: [{ when: [{ exit0: ["sh", "-c", "exit 2"] }], to: "done" }] } },
  };
  const file = join(dir, "rec.json");
  writeFileSync(file, JSON.stringify(rec));
  expect(await main(["arm", file, "--run", "r1", "--no-timer"])).toBe(0);
  const store = openStore(join(dir, "state"));
  const r = await tick({ store, host: new FakeHost({}), forge: noForge, notify: notifyOnce, now: () => new Date() });
  expect(r.parked).toEqual(["u"]);
  expect(store.readRun("r1").units.u.parked?.reason).toBe("exit0 error");
});

test("exit0 runs without a shell", async () => {
  const c = ctx([], lane);
  expect(await evaluate({ exit0: ["echo", "$(touch x)", "`touch y`"] }, c)).toBe("true");
  expect(readdirSync(dir).filter((f) => f === "x" || f === "y")).toEqual([]);
});

test("file and absent read the rendered path", async () => {
  const c = ctx([], lane);
  expect(await evaluate({ file: "{run.dir}/f" }, c)).toBe("false");
  expect(await evaluate({ absent: "{run.dir}/f" }, c)).toBe("true");
  writeFileSync(join(dir, "f"), "");
  expect(await evaluate({ file: "{run.dir}/f" }, c)).toBe("true");
  expect(await evaluate({ absent: "{run.dir}/f" }, c)).toBe("false");
});

test("units all/any/none over a group", async () => {
  const units = [unit("a", 1, "done"), unit("b", 1, "work"), unit("c", 2, "done")];
  const c = ctx(units, lane);
  const u = (count: "all" | "any" | "none", stages: string[], group?: string): Signal =>
    ({ units: { ...(group !== undefined ? { group } : {}), stages, count } });
  const table: [Signal, string][] = [
    [u("all", ["done"], "1"), "false"],
    [u("all", ["done", "work"], "1"), "true"],
    [u("any", ["done"], "1"), "true"],
    [u("any", ["land"], "1"), "false"],
    [u("none", ["work"], "1"), "false"],
    [u("none", ["work"], "2"), "true"],
    [u("all", ["done"], "2"), "true"],
    [u("all", ["done"], "{run.group}"), "false"],
    [u("all", ["done"], "7"), "false"], // an empty group is never "all"
    [u("none", ["done"], "7"), "true"],
    [u("any", ["work"]), "true"], // no group: every unit in the run
    [u("all", ["done"]), "false"],
    [u("none", ["wait_here"]), "true"], // the asking unit is not counted
  ];
  for (const [sig, want] of table) expect([sig, await evaluate(sig, c)]).toEqual([sig, want]);
});

test("active none-in-group is false while a sibling has a live session", async () => {
  const sib = unit("b", 1, "work", true);
  const c = ctx([unit("a", 1, "done"), sib], lane);
  expect(await evaluate({ active: "none-in-group" }, c)).toBe("false");
});

test("control: active none-in-group is true once the sibling completes", async () => {
  const sib = unit("b", 1, "work", false);
  const other = unit("z", 2, "work", true); // a live session in another group does not count
  expect(await evaluate({ active: "none-in-group" }, ctx([unit("a", 1, "done"), sib, other], lane))).toBe("true");
});

test("record_changed compares the seen digest with the one at stage entry", async () => {
  const u = { ...unit("a", 1, "w"), record_seen: "d1", record_at_entry: "d1" };
  expect(await evaluate({ record_changed: true }, ctx([], u))).toBe("false");
  u.record_seen = "d2";
  expect(await evaluate({ record_changed: true }, ctx([], u))).toBe("true");
  expect(await evaluate({ record_changed: true }, ctx([], unit("s", 0, "w")))).toBe("false");
});

function prForge(v: Partial<PrView>, views: string[] = []): Forge {
  return {
    view: async (url) => {
      views.push(url);
      return { state: "OPEN", head: "abc123", base: "main", mergeable: "MERGEABLE", checks: "green", ...v };
    },
    merge: async () => { throw new Error("signals never merge"); },
  };
}
const PR = "https://github.com/o/r/pull/7";
const prSig = (test: PrTest) => ({ pr: { url: ["echo", PR], test } });
const prCtx = (v: Partial<PrView>, views: string[] = []) => ({ ...ctx([], lane), forge: prForge(v, views) });

test("pr maps the forge read onto each test and sets pr in scope", async () => {
  const table: [PrTest, Partial<PrView>, string][] = [
    ["open", { state: "OPEN" }, "true"], ["open", { state: "MERGED" }, "false"],
    ["merged", { state: "MERGED" }, "true"], ["merged", { state: "OPEN" }, "false"],
    ["closed", { state: "CLOSED" }, "true"], ["closed", { state: "OPEN" }, "false"],
    ["checks_green", { checks: "green" }, "true"], ["checks_green", { checks: "red" }, "false"],
    ["checks_green", { checks: "pending" }, "pending"], ["checks_green", { checks: "none" }, "false"],
    ["checks_red", { checks: "red" }, "true"], ["checks_red", { checks: "green" }, "false"],
    ["checks_red", { checks: "pending" }, "pending"],
    ["mergeable", { mergeable: "MERGEABLE" }, "true"], ["mergeable", { mergeable: "CONFLICTING" }, "false"],
    ["mergeable", { mergeable: "UNKNOWN" }, "pending"],
    ["conflict", { mergeable: "CONFLICTING" }, "true"], ["conflict", { mergeable: "MERGEABLE" }, "false"],
    ["conflict", { mergeable: "UNKNOWN" }, "pending"],
  ];
  for (const [test, v, want] of table) {
    const c = prCtx(v);
    expect([test, JSON.stringify(v), await evaluate(prSig(test), c)]).toEqual([test, JSON.stringify(v), want]);
    expect(c.scope.pr).toEqual({ url: PR, head: "abc123" });
  }
});

test("pr reads the forge once per URL per tick", async () => {
  const views: string[] = [];
  const c = prCtx({}, views);
  await evaluate(prSig("open"), c);
  await evaluate(prSig("checks_green"), c);
  expect(views).toEqual([PR]);
});

test("pr with a URL that is not a pull request throws PrUrlError", async () => {
  const c = prCtx({});
  await expect(evaluate({ pr: { url: ["echo", "x"], test: "open" } }, c)).rejects.toThrow("not a pull request URL");
});
