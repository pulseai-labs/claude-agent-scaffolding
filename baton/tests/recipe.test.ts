import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  nonce, own, render, threadTitle, validate, RUN_ID_RE, type Scope,
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

  test("an Object.prototype member is refused as a stage name, seed id or recipe name", () => {
    const own = (o: Record<string, unknown>, k: string, v: unknown) =>
      Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
    for (const n of ["__proto__", "constructor"]) {
      const st = relay();
      own(st.stages, n, st.stages.work);
      expectError(st, `stages.${n}: must not name an Object.prototype member`);
      const sd = relay();
      sd.seed[0].id = n;
      expectError(sd, "seed[0].id: must not name an Object.prototype member");
      const nm = relay();
      nm.name = n;
      expectError(nm, "name: must not name an Object.prototype member");
    }
    const ts = relay();
    ts.seed[0].id = "toString";
    expectError(ts, "seed[0].id: must not name an Object.prototype member");
    // adjacent control: names that only contain such a member are ordinary
    const ok = relay();
    own(ok.stages, "constructors", ok.stages.work);
    ok.seed[0].id = "toStrings";
    ok.name = "proto";
    expect(validate(ok).ok).toBe(true);
  });

  test("an Object.prototype member is refused as a source or seed var name", () => {
    for (const n of ["__proto__", "constructor", "toString"]) {
      const src = relay();
      Object.defineProperty(src.sources[0].vars, n, { value: "task", enumerable: true, writable: true, configurable: true });
      expectError(src, `sources[0].vars.${n}: must not name an Object.prototype member`);
      const sd = relay();
      sd.seed[0].vars = JSON.parse(`{"${n}": "x"}`);
      expectError(sd, `seed[0].vars.${n}: must not name an Object.prototype member`);
    }
    // adjacent control: ordinary var names, including ones containing such a member, pass
    const ok = relay();
    ok.sources[0].vars = { task: "task", proto_task: "task", constructors: "task" };
    ok.seed[0].vars = { task: "x", toStrings: "y" };
    expect(validate(ok).ok).toBe(true);
  });

  test("own reads a map's own value and nothing from its prototype", () => {
    const m = JSON.parse('{"work": 2, "__proto__": 3}') as Record<string, number>;
    expect(own(m, "constructor")).toBeUndefined();
    expect(own(m, "toString")).toBeUndefined();
    expect(own(m, "work")).toBe(2); // control
    expect(own(m, "__proto__")).toBe(3); // an own key named __proto__ is a value like any other
    expect(own(undefined, "work")).toBeUndefined();
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

describe("triage stage", () => {
  const triage = () => ({
    kind: "triage", instance: "triager", model: "small", project: "{param.project}", cwd: "{param.project}",
    title: "triage {pending.stage}",
    message: "Thread {pending.thread} request {pending.request}: {pending.questions}. Write {run.dir}/note.",
    env: { TRIAGE_ROLE: "triage" }, note_file: "{run.dir}/note", stall_minutes: 5,
    stop_file: "{run.dir}/stop/triage", watch: ["{run.dir}/out"], before: [["true"]], after_launch: [["true"]],
    launch_dir: "root",
  });
  const withTriage = (t: unknown = triage()) => ({ ...relay(), triage: t });

  test("a recipe with a triage stage validates", () => {
    const res = validate(withTriage());
    expect(res.ok).toBe(true);
  });

  test("a recipe without triage still validates", () => {
    const res = validate(relay());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.recipe.triage).toBeUndefined();
  });

  test("triage stage rejects outcomes, handoff, slots, max_launches and settle_minutes", () => {
    const extra: Record<string, unknown> = {
      outcomes: [], handoff: null, slots: ["session"], max_launches: 2, settle_minutes: 1,
    };
    for (const [k, v] of Object.entries(extra)) {
      expectError(withTriage({ ...triage(), [k]: v }), `triage.${k}: not allowed on a triage stage`);
    }
  });

  test("triage stage needs note_file and kind triage", () => {
    const t: Record<string, unknown> = triage();
    delete t.note_file;
    expectError(withTriage(t), "triage.note_file: must be a string");
    expectError(withTriage({ ...triage(), kind: "session" }), 'triage.kind: must be "triage"');
  });

  test("triage launch fields validate as a session stage's do", () => {
    expectError(withTriage({ ...triage(), env: { PATH: "x" } }), "triage.env.PATH: denied key");
    expectError(withTriage({ ...triage(), stall_minutes: 0 }), "triage.stall_minutes: must be a positive number");
    expectError(withTriage({ ...triage(), watch: "x" }), "triage.watch: must be a list of strings");
    expectError(withTriage({ ...triage(), cwd: 3 }), "triage.cwd: must be a string");
  });

  test("pending placeholders are valid in triage only", () => {
    expectError(withTriage({ ...triage(), message: "{pending.nope}" }), 'unknown placeholder "{pending.nope}"');
    const r = relay();
    r.stages.work.message = "{pending.thread}";
    expectError(r, 'stages.work.message: unknown placeholder "{pending.thread}"');
  });

  test("pending placeholders are refused in note_file", () => {
    // note_file renders with the unit's own scope, which has no pending request
    expectError(withTriage({ ...triage(), note_file: "{pending.thread}/x" }),
      'triage.note_file: unknown placeholder "{pending.thread}"');
  });

  test("a stage named triage is refused when the recipe has a triage stage", () => {
    for (const from of ["work", "planner_wait", "land"]) {
      const r = withTriage();
      r.stages.triage = r.stages[from];
      expectError(r, "stages.triage: ");
      const plain = relay();
      plain.stages.triage = plain.stages[from];
      expect(validate(plain).ok).toBe(true);
    }
  });
});

const triageBase = () => ({
  kind: "triage", instance: "t", model: "m", project: "/p", cwd: "/p", title: "t", message: "m", env: {}, note_file: "n",
});

describe("driver stage", () => {
  const driver = () => ({
    kind: "driver", instance: "driver", model: "small", project: "{param.project}", cwd: "{param.project}",
    launch_dir: "worktree", title: "driver {unit.id}",
    message: "Unit {unit.id} parked at {driver.stage}: {driver.reason}. State {run.dir}/{unit.id}/state.",
    env: { DRIVER_ROLE: "driver" }, stall_minutes: 15,
    state_file: "{run.dir}/{unit.id}/state", result_file: "{run.dir}/{unit.id}/result",
    ledger: "{run.dir}/{param.project}/ledger",
    clearing: ["rerun-check", "remove-file"],
    resume_to: { work: ["land"] } as Record<string, string[]>,
  });
  const withDriver = (d: unknown = driver()) => ({ ...relay(), driver: d });

  test("driver section validates", () => {
    const res = validate(withDriver());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.recipe.driver?.clearing).toEqual(["rerun-check", "remove-file"]);
  });

  test("driver rejects forbidden keys", () => {
    const extra: Record<string, unknown> = {
      outcomes: [], handoff: null, slots: ["session"], max_launches: 2, settle_minutes: 1,
      before: [["true"]], after_launch: [["true"]], stop_file: "x", watch: ["x"],
    };
    for (const [k, v] of Object.entries(extra)) {
      expectError(withDriver({ ...driver(), [k]: v }), `driver.${k}: not allowed on a driver stage`);
    }
  });

  test("driver clearing", () => {
    expectError(withDriver({ ...driver(), clearing: [] }), "driver.clearing: must be a non-empty list of names");
    expectError(withDriver({ ...driver(), clearing: "x" }), "driver.clearing: must be a non-empty list of names");
    expectError(withDriver({ ...driver(), clearing: ["a", "a"] }), "driver.clearing[1]: duplicate");
    expectError(withDriver({ ...driver(), clearing: ["A b"] }), "driver.clearing[0]: must match ^[a-z0-9_-]+$");
  });

  test("driver resume_to", () => {
    expectError(withDriver({ ...driver(), resume_to: { nope: ["land"] } }), 'driver.resume_to.nope: names no stage: "nope"');
    expectError(withDriver({ ...driver(), resume_to: { work: ["done"] } }),
      'driver.resume_to.work[0]: "done" is a terminal, not a stage');
    expectError(withDriver({ ...driver(), resume_to: { work: ["nowhere"] } }),
      'driver.resume_to.work[0]: names no stage: "nowhere"');
    expectError(withDriver({ ...driver(), resume_to: [] }), "driver.resume_to: must be an object");
    expectError(withDriver({ ...driver(), resume_to: { work: "land" } }), "driver.resume_to.work: must be a list of stage names");
  });

  test("driver placeholders", () => {
    expect(validate(withDriver({ ...driver(), message: "{driver.reason} {driver.stage}" })).ok).toBe(true);
    for (const f of ["state_file", "result_file", "ledger"]) {
      expectError(withDriver({ ...driver(), [f]: "{driver.reason}" }), `driver.${f}: unknown placeholder "{driver.reason}"`);
    }
    expectError(withDriver({ ...driver(), message: "{pending.request}" }), 'driver.message: unknown placeholder "{pending.request}"');
    const r = relay();
    r.stages.work.message = "{driver.reason}";
    expectError(r, 'stages.work.message: unknown placeholder "{driver.reason}"');
    expectError({ ...relay(), triage: { ...triageBase(), message: "{driver.stage}" } },
      'triage.message: unknown placeholder "{driver.stage}"');
  });

  test("a stage named driver is refused when the recipe has a driver", () => {
    const r = withDriver();
    r.stages.driver = r.stages.work;
    expectError(r, "stages.driver: a recipe with a driver stage cannot name a stage driver");
    const plain = relay();
    plain.stages.driver = plain.stages.work;
    expect(validate(plain).ok).toBe(true);
  });

  test("driver kind and file fields", () => {
    expectError(withDriver({ ...driver(), kind: "session" }), 'driver.kind: must be "driver"');
    for (const f of ["state_file", "result_file", "ledger"]) {
      const d: Record<string, unknown> = driver();
      delete d[f];
      expectError(withDriver(d), `driver.${f}: must be a string`);
    }
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

  test("pending placeholders render in a triage scope and throw outside it", () => {
    const pending = { thread: "th-1", request: "rq-9", questions: '[{"q":"ok?"}]', stage: "work" };
    const tpl = "{pending.thread}|{pending.request}|{pending.questions}|{pending.stage}";
    expect(render(tpl, { ...scope, pending })).toBe('th-1|rq-9|[{"q":"ok?"}]|work');
    expect(() => render("{pending.thread}", scope)).toThrow("no pending in scope");
    expect(() => render("{pending.stage}", scope)).toThrow("no pending in scope");
  });
});
