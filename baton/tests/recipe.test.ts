import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  nonce, render, threadTitle, validate, RUN_ID_RE, type Scope,
} from "../src/recipe.ts";

const FIX = join(import.meta.dir, "fixtures", "recipes");
const load = (name: string) => JSON.parse(readFileSync(join(FIX, name), "utf8"));
const relay = () => load("relay.json");

function errorsOf(r: unknown): string[] {
  const res = validate(r);
  if (res.ok) throw new Error("expected validation to fail");
  return res.errors;
}
function expectError(r: unknown, fragment: string) {
  expect(errorsOf(r).some((e) => e.includes(fragment))).toBe(true);
}

const scope: Scope = {
  param: { project: "/p", repo: "o/r" },
  unit: { id: "u1", group: "g1", order: 3, vars: { task: "t" } },
  run: { id: "run1", dir: "/runs/run1", group: "g1" },
  attempt: 2,
  handoff_path: "/h.md",
  pr: { url: "https://github.com/o/r/pull/1", head: "abc123" },
};

describe("validate", () => {
  test("accepts the relay fixture", () => {
    expect(validate(relay()).ok).toBe(true);
  });

  test("unknown placeholder", () => {
    const r = relay();
    r.stages.work.message = "do {nonsense}";
    expectError(r, 'stages.work.message: unknown placeholder "{nonsense}"');
  });

  test("a placeholder naming an undeclared param", () => {
    const r = relay();
    r.stages.work.cwd = "{param.nowhere}";
    expectError(r, 'stages.work.cwd: undeclared param "nowhere"');
    // control: a declared param in the same position passes
    const ok = relay();
    ok.stages.work.cwd = "{param.repo}";
    expect(validate(ok).ok).toBe(true);
  });

  test("a to naming no stage", () => {
    const r = relay();
    r.stages.work.outcomes[0].to = "nowhere";
    expectError(r, 'stages.work.outcomes[0].to: names no stage: "nowhere"');
    // control: done and park are accepted
    for (const t of ["done", "park"]) {
      const ok = relay();
      ok.stages.work.outcomes[0].to = t;
      expect(validate(ok).ok).toBe(true);
    }
  });

  test("an env key failing the pattern or on the denylist", () => {
    const r = relay();
    r.stages.work.env = { lower_key: "1" };
    expectError(r, "stages.work.env.lower_key: denied key");
    // adjacent control: a seat-like upper-case key passes
    const ok = relay();
    ok.stages.work.env = { SEAT_LIKE_KEY: "1" };
    expect(validate(ok).ok).toBe(true);
    for (const k of ["PATH", "HOME", "USER", "SHELL", "IFS", "ENV", "BASH_ENV", "LD_PRELOAD", "LD_LIBRARY_PATH"]) {
      const d = relay();
      d.stages.work.env = { [k]: "x" };
      expectError(d, `stages.work.env.${k}: denied key`);
    }
  });

  test("a session stage with no handoff key", () => {
    const r = relay();
    delete r.stages.work.handoff;
    expectError(r, "stages.work.handoff: required");
    // control: an explicit null and an object both pass
    const n = relay();
    n.stages.work.handoff = null;
    expect(validate(n).ok).toBe(true);
    const o = relay();
    o.stages.work.handoff = { file: "{run.dir}/h.md", token: "T", message: "m" };
    expect(validate(o).ok).toBe(true);
  });

  test("a slot not declared", () => {
    const r = relay();
    r.stages.work.slots = ["gpu"];
    expectError(r, 'stages.work.slots[0]: slot not declared: "gpu"');
    // control: the default slot name passes
    const ok = relay();
    ok.stages.work.slots = ["build"];
    expect(validate(ok).ok).toBe(true);
  });

  test("a stage named after a terminal (done, park) is refused", () => {
    for (const t of ["done", "park"]) {
      const r = relay();
      r.stages[t] = r.stages.work;
      r.seed[0].stage = t;
      expectError(r, `stages.${t}: "${t}" is a terminal (done, park), not a stage name`);
    }
    // adjacent control: a name that only contains a terminal word is a stage like any other
    for (const n of ["done_review", "parked"]) {
      const ok = relay();
      ok.stages[n] = ok.stages.work;
      ok.seed[0].stage = n;
      expect(validate(ok).ok).toBe(true);
    }
  });

  test("a seed or source naming no stage", () => {
    const s = relay();
    s.seed[0].stage = "ghost";
    expectError(s, 'seed[0].stage: names no stage: "ghost"');
    const q = relay();
    q.sources[0].stage = "ghost";
    expectError(q, 'sources[0].stage: names no stage: "ghost"');
  });

  test("a units signal may name the terminal stage done, and no other unknown stage", () => {
    const ok = relay();
    ok.stages.planner_wait.outcomes[1].when[0].units.stages = ["done"];
    expect(validate(ok).ok).toBe(true);
    const bad = relay();
    bad.stages.planner_wait.outcomes[1].when[0].units.stages = ["ghost"];
    expectError(bad, 'units.stages[0]: names no stage: "ghost"');
  });

  test("version other than 1", () => {
    const r = relay();
    r.version = 2;
    expectError(r, "version: must be 1");
  });

  test("a launch_dir outside worktree and root", () => {
    const r = relay();
    r.stages.work.launch_dir = "elsewhere";
    expectError(r, "stages.work.launch_dir");
    for (const v of ["worktree", "root"]) {
      const ok = relay();
      ok.stages.work.launch_dir = v;
      expect(validate(ok).ok).toBe(true);
    }
  });

  test("hooks must be lists of argv lists", () => {
    const r = relay();
    r.stages.work.before = ["echo hi"];
    expectError(r, "stages.work.before");
    const ok = relay();
    ok.stages.work.before = [["echo", "hi"]];
    ok.stages.work.after_launch = [["true"]];
    expect(validate(ok).ok).toBe(true);
  });

  test("omitted slots take the design defaults", () => {
    const r = relay();
    delete r.slots;
    delete r.stages.work.slots;
    const res = validate(r);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.recipe.slots).toEqual({ session: 2, build: 1 });
    const work = res.recipe.stages.work;
    expect(work.kind === "session" && work.slots).toEqual(["session"]);
  });

  test("a recipe's own slots add to the defaults, never remove them", () => {
    const r = relay();
    r.slots = { gpu: 1 };
    const res = validate(r);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.recipe.slots).toEqual({ session: 2, build: 1, gpu: 1 });
  });

  test("nonce and title follow the name rules", () => {
    const ok = relay();
    ok.seed[0].id = "r0.s6.w1";
    expect(validate(ok).ok).toBe(true);
    const bad = relay();
    bad.seed[0].id = "bad id";
    expectError(bad, "seed[0].id");
    const stage = relay();
    stage.stages["Work Stage"] = stage.stages.work;
    expectError(stage, "stages.Work Stage");
    const name = relay();
    name.name = "Bad Name";
    expectError(name, "name:");
    expect(RUN_ID_RE.test("run-1_a")).toBe(true);
    expect(RUN_ID_RE.test("Run")).toBe(false);
    expect(nonce("run1", "r0.s6.w1", "work", 2)).toBe("run1/r0.s6.w1/work/2");
    expect(threadTitle("work r0.s6.w1", nonce("run1", "r0.s6.w1", "work", 2))).toBe(
      "work r0.s6.w1 [baton run1/r0.s6.w1/work/2]",
    );
  });

  test("a non-object recipe is refused", () => {
    expect(validate(null).ok).toBe(false);
    expect(validate([]).ok).toBe(false);
  });
});

describe("render", () => {
  test("render substitutes every scope name", () => {
    const tpl =
      "{param.project} {param.repo} {unit.id} {unit.vars.task} {run.id} {run.dir} {run.group} {attempt} {handoff_path} {pr.url} {pr.head}";
    expect(render(tpl, scope)).toBe(
      "/p o/r u1 t run1 /runs/run1 g1 2 /h.md https://github.com/o/r/pull/1 abc123",
    );
  });

  test("render refuses an unknown name at run time", () => {
    expect(() => render("{bogus}", scope)).toThrow();
    expect(() => render("{param.missing}", scope)).toThrow();
    // a param is an own value only: nothing is read through the prototype chain
    expect(() => render("{param.constructor}", scope)).toThrow('unknown param "constructor"');
    const own = { ...scope, param: JSON.parse('{"constructor": "c", "__proto__": "p"}') };
    expect(render("{param.constructor} {param.__proto__}", own)).toBe("c p");
    expect(() => render("{unit.vars.missing}", scope)).toThrow();
  });

  test("a pr placeholder with no pr in scope throws no pr in scope", () => {
    const { pr: _pr, ...rest } = scope;
    expect(() => render("{pr.url}", rest as Scope)).toThrow("no pr in scope");
    expect(() => render("{pr.head}", rest as Scope)).toThrow("no pr in scope");
  });
});
