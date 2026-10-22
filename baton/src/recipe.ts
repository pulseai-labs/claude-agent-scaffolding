// The recipe format: types, validation, and template rendering. A recipe is data the
// engine validates and freezes into a run; it alone names commands, files, environment
// keys, briefs and the merge rule.

export type PrTest =
  | "open" | "merged" | "closed" | "checks_green" | "checks_red" | "mergeable" | "conflict";

export type Signal =
  | { file: string }
  | { absent: string }
  | { exit0: string[] }
  | { pr: { url: string[]; test: PrTest } }
  | { units: { group?: string; stages: string[]; count: "all" | "any" | "none" } }
  | { active: "none-in-group" }
  | { record_changed: true };

export type Outcome = { when: Signal[]; to: string; run?: string[][]; notify?: string };

export type SessionStage = {
  kind: "session";
  instance: string;
  model: string;
  project: string;
  cwd: string;
  title: string;
  message: string;
  env: Record<string, string>;
  launch_dir?: "worktree" | "root";
  before?: string[][];
  after_launch?: string[][];
  outcomes: Outcome[];
  stop_file?: string;
  handoff: { file: string; token: string; message: string } | null;
  watch?: string[];
  slots?: string[];
  max_launches?: number;
  stall_minutes?: number;
  settle_minutes?: number;
};
export type WaitStage = { kind: "wait"; outcomes: Outcome[] };
export type MergeStage = {
  kind: "merge";
  pr: string[];
  base: string;
  repo: string;
  ordered: boolean;
  checks?: "green" | "none-required";
  outcomes: { merged: string; red: string; conflict: string };
  run_after?: string[][];
};
export type Stage = SessionStage | WaitStage | MergeStage;

export type Source = {
  dir: string;
  id_key: string;
  group_key: string;
  order_key: string;
  vars: Record<string, string>;
  stage: string;
};

export type Recipe = {
  version: 1;
  name: string;
  params: string[];
  slots?: Record<string, number>;
  sources: Source[];
  seed: { id: string; stage: string; vars?: Record<string, string> }[];
  stages: Record<string, Stage>;
};

export type Scope = {
  param: Record<string, string>;
  unit: { id: string; group: string; order: number | string; vars: Record<string, string> };
  run: { id: string; dir: string; group: string };
  attempt: number;
  handoff_path?: string;
  pr?: { url: string; head: string };
};

// ---- names -------------------------------------------------------------------------

export const RUN_ID_RE = /^[a-z0-9_-]+$/;
export const STAGE_NAME_RE = /^[a-z0-9_-]+$/;
export const UNIT_ID_RE = /^[A-Za-z0-9._-]+$/;

// Every name that keys a plain-object map (run, unit, stage) must not name an Object.prototype
// member: `units["__proto__"] = u` sets the prototype, `launches["constructor"]` reads a function.
const PROTO_NAMES = new Set([...Object.getOwnPropertyNames(Object.prototype), "__proto__"]);
export const isProtoName = (name: string): boolean => PROTO_NAMES.has(name);
export const PROTO_NAME_ERROR = "must not name an Object.prototype member (__proto__, constructor, toString, ...)";

/** `map[key]` only when `key` is the map's own property; never a value from the prototype chain. */
export function own<T>(map: Record<string, T> | undefined, key: string): T | undefined {
  return map !== undefined && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}
export const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;
export const ENV_DENYLIST = [
  "PATH", "HOME", "USER", "SHELL", "IFS", "ENV", "BASH_ENV", "LD_PRELOAD", "LD_LIBRARY_PATH",
];
export const DEFAULT_SLOTS: Record<string, number> = { session: 2, build: 1 };
export const DEFAULT_STAGE_SLOTS = ["session"];

/** The launch nonce: `<run>/<unit>/<stage>/<n>`. */
export function nonce(run: string, unit: string, stage: string, n: number): string {
  return `${run}/${unit}/${stage}/${n}`;
}

/** The thread title: the rendered stage title plus the nonce tag the host searches on. */
export function threadTitle(renderedTitle: string, nonceText: string): string {
  return `${renderedTitle} [baton ${nonceText}]`;
}

// ---- render ------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{([^{}]*)\}/g;
const PARAM_NAME_RE = /^[A-Za-z0-9_]+$/;
const VAR_NAME_RE = /^[A-Za-z0-9_]+$/;
const FIXED_NAMES = new Set([
  "unit.id", "run.id", "run.dir", "run.group", "attempt", "handoff_path", "pr.url", "pr.head",
]);

/** Is `name` (the text between braces) a placeholder the recipe may use? Returns a reason or null. */
function placeholderProblem(name: string, params: Set<string>): string | null {
  if (FIXED_NAMES.has(name)) return null;
  if (name.startsWith("param.")) {
    const p = name.slice(6);
    return params.has(p) ? null : `undeclared param "${p}"`;
  }
  if (name.startsWith("unit.vars.")) {
    return VAR_NAME_RE.test(name.slice(10)) ? null : `unknown placeholder "{${name}}"`;
  }
  return `unknown placeholder "{${name}}"`;
}

export function render(tpl: string, scope: Scope): string {
  return tpl.replace(PLACEHOLDER_RE, (_m, name: string) => {
    switch (name) {
      case "unit.id": return scope.unit.id;
      case "run.id": return scope.run.id;
      case "run.dir": return scope.run.dir;
      case "run.group": return scope.run.group;
      case "attempt": return String(scope.attempt);
      case "handoff_path":
        if (scope.handoff_path === undefined) throw new Error("no handoff_path in scope");
        return scope.handoff_path;
      case "pr.url":
      case "pr.head":
        if (!scope.pr) throw new Error("no pr in scope");
        return name === "pr.url" ? scope.pr.url : scope.pr.head;
    }
    if (name.startsWith("param.")) {
      const k = name.slice(6);
      if (PARAM_NAME_RE.test(k) && Object.prototype.hasOwnProperty.call(scope.param, k)) return scope.param[k];
      throw new Error(`unknown param "${k}"`);
    }
    if (name.startsWith("unit.vars.")) {
      const k = name.slice(10);
      if (VAR_NAME_RE.test(k) && Object.prototype.hasOwnProperty.call(scope.unit.vars, k)) return scope.unit.vars[k];
      throw new Error(`unknown unit var "${k}"`);
    }
    throw new Error(`unknown placeholder "{${name}}"`);
  });
}

// ---- validate ----------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isArgv = (v: unknown): v is string[] => isStrArr(v) && v.length > 0;

const PR_TESTS = ["open", "merged", "closed", "checks_green", "checks_red", "mergeable", "conflict"];
const COUNTS = ["all", "any", "none"];
const TERMINALS = ["done", "park"];

export function validate(raw: unknown): { ok: true; recipe: Recipe } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);

  if (!isObj(raw)) return { ok: false, errors: ["recipe: must be an object"] };
  const r = raw;

  if (r.version !== 1) err("version", "must be 1");
  if (!isStr(r.name) || !RUN_ID_RE.test(r.name)) err("name", "must match ^[a-z0-9_-]+$");
  else if (isProtoName(r.name)) err("name", PROTO_NAME_ERROR);

  const paramList: string[] = [];
  if (!Array.isArray(r.params)) err("params", "must be an array of names");
  else {
    r.params.forEach((p, i) => {
      if (!isStr(p) || !PARAM_NAME_RE.test(p)) err(`params[${i}]`, "must match ^[A-Za-z0-9_]+$");
      else paramList.push(p);
    });
  }
  const params = new Set(paramList);

  // slots: defaults when omitted; a recipe may not remove the defaults.
  let slots: Record<string, number> = { ...DEFAULT_SLOTS };
  if (r.slots !== undefined) {
    if (!isObj(r.slots)) err("slots", "must be an object of name to count");
    else {
      for (const [k, v] of Object.entries(r.slots)) {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1) err(`slots.${k}`, "must be a positive integer");
      }
      slots = { ...DEFAULT_SLOTS, ...(r.slots as Record<string, number>) };
    }
  }

  const stages = isObj(r.stages) ? r.stages : (err("stages", "must be an object"), {} as Obj);
  const stageNames = new Set(Object.keys(stages));
  for (const name of stageNames) {
    if (!STAGE_NAME_RE.test(name)) err(`stages.${name}`, "stage name must match ^[a-z0-9_-]+$");
    else if (isProtoName(name)) err(`stages.${name}`, PROTO_NAME_ERROR);
    else if (TERMINALS.includes(name)) err(`stages.${name}`, `"${name}" is a terminal (done, park), not a stage name`);
  }
  const target = (path: string, to: unknown) => {
    if (!isStr(to)) err(path, "must be a stage name, done or park");
    else if (!TERMINALS.includes(to) && !stageNames.has(to)) err(path, `names no stage: "${to}"`);
  };

  const hooks = (path: string, v: unknown) => {
    if (v === undefined) return;
    if (!Array.isArray(v) || !v.every(isArgv)) err(path, "must be a list of non-empty argv lists");
  };

  const signal = (path: string, s: unknown) => {
    if (!isObj(s) || Object.keys(s).length !== 1) return err(path, "must be an object with exactly one signal key");
    const [k, v] = Object.entries(s)[0];
    switch (k) {
      case "file": case "absent":
        if (!isStr(v)) err(`${path}.${k}`, "must be a string");
        break;
      case "exit0":
        if (!isArgv(v)) err(`${path}.exit0`, "must be a non-empty argv list");
        break;
      case "pr":
        if (!isObj(v) || !isArgv(v.url) || !isStr(v.test) || !PR_TESTS.includes(v.test)) {
          err(`${path}.pr`, `must be {url: argv, test: ${PR_TESTS.join("|")}}`);
        }
        break;
      case "units":
        if (!isObj(v) || !isStrArr(v.stages) || !isStr(v.count) || !COUNTS.includes(v.count)
          || (v.group !== undefined && !isStr(v.group))) {
          err(`${path}.units`, "must be {group?: string, stages: string[], count: all|any|none}");
        } else {
          v.stages.forEach((st, i) => {
            if (st !== "done" && !stageNames.has(st)) err(`${path}.units.stages[${i}]`, `names no stage: "${st}"`);
          });
        }
        break;
      case "active":
        if (v !== "none-in-group") err(`${path}.active`, 'must be "none-in-group"');
        break;
      case "record_changed":
        if (v !== true) err(`${path}.record_changed`, "must be true");
        break;
      default:
        err(path, `unknown signal "${k}"`);
    }
  };

  const outcomes = (path: string, v: unknown) => {
    if (!Array.isArray(v)) return err(path, "must be a list of outcomes");
    v.forEach((o, i) => {
      const p = `${path}[${i}]`;
      if (!isObj(o)) return err(p, "must be an object");
      if (!Array.isArray(o.when)) err(`${p}.when`, "must be a list of signals");
      else o.when.forEach((s, j) => signal(`${p}.when[${j}]`, s));
      target(`${p}.to`, o.to);
      hooks(`${p}.run`, o.run);
      if (o.notify !== undefined && !isStr(o.notify)) err(`${p}.notify`, "must be a string");
    });
  };

  for (const [name, st] of Object.entries(stages)) {
    const p = `stages.${name}`;
    if (!isObj(st)) { err(p, "must be an object"); continue; }
    if (st.kind === "session") {
      for (const f of ["instance", "model", "project", "cwd", "title", "message"]) {
        if (!isStr(st[f])) err(`${p}.${f}`, "must be a string");
      }
      if (!isObj(st.env)) err(`${p}.env`, "must be an object of string values");
      else {
        for (const [k, v] of Object.entries(st.env)) {
          if (!ENV_KEY_RE.test(k) || ENV_DENYLIST.includes(k)) err(`${p}.env.${k}`, "denied key");
          if (!isStr(v)) err(`${p}.env.${k}`, "must be a string");
        }
      }
      if (!("handoff" in st)) err(`${p}.handoff`, "required: an object or null");
      else if (st.handoff !== null) {
        const h = st.handoff;
        if (!isObj(h) || !isStr(h.file) || !isStr(h.token) || !isStr(h.message)) {
          err(`${p}.handoff`, "must be null or {file, token, message} strings");
        }
      }
      if (st.launch_dir !== undefined && st.launch_dir !== "worktree" && st.launch_dir !== "root") {
        err(`${p}.launch_dir`, 'must be "worktree" or "root"');
      }
      hooks(`${p}.before`, st.before);
      hooks(`${p}.after_launch`, st.after_launch);
      outcomes(`${p}.outcomes`, st.outcomes);
      if (st.stop_file !== undefined && !isStr(st.stop_file)) err(`${p}.stop_file`, "must be a string");
      if (st.watch !== undefined && !isStrArr(st.watch)) err(`${p}.watch`, "must be a list of strings");
      for (const f of ["max_launches", "stall_minutes", "settle_minutes"]) {
        const v = st[f];
        if (v !== undefined && (typeof v !== "number" || !(v > 0))) err(`${p}.${f}`, "must be a positive number");
      }
      if (st.slots !== undefined) {
        if (!isStrArr(st.slots)) err(`${p}.slots`, "must be a list of slot names");
        else {
          st.slots.forEach((s, i) => {
            if (!Object.prototype.hasOwnProperty.call(slots, s)) err(`${p}.slots[${i}]`, `slot not declared: "${s}"`);
          });
        }
      } else {
        st.slots = [...DEFAULT_STAGE_SLOTS];
      }
    } else if (st.kind === "wait") {
      outcomes(`${p}.outcomes`, st.outcomes);
    } else if (st.kind === "merge") {
      if (!isArgv(st.pr)) err(`${p}.pr`, "must be a non-empty argv list");
      if (!isStr(st.base)) err(`${p}.base`, "must be a string");
      if (!isStr(st.repo)) err(`${p}.repo`, "must be a string");
      if (typeof st.ordered !== "boolean") err(`${p}.ordered`, "must be a boolean");
      if (st.checks !== undefined && st.checks !== "green" && st.checks !== "none-required") {
        err(`${p}.checks`, 'must be "green" or "none-required"');
      }
      if (!isObj(st.outcomes)) err(`${p}.outcomes`, "must be {merged, red, conflict}");
      else for (const k of ["merged", "red", "conflict"]) target(`${p}.outcomes.${k}`, st.outcomes[k]);
      hooks(`${p}.run_after`, st.run_after);
    } else {
      err(`${p}.kind`, 'must be "session", "wait" or "merge"');
    }
  }

  const unitStage = (path: string, stage: unknown) => {
    if (!isStr(stage)) err(path, "must be a stage name");
    else if (!stageNames.has(stage)) err(path, `names no stage: "${stage}"`);
  };

  if (!Array.isArray(r.sources)) err("sources", "must be an array");
  else {
    r.sources.forEach((s, i) => {
      const p = `sources[${i}]`;
      if (!isObj(s)) return err(p, "must be an object");
      for (const f of ["dir", "id_key", "group_key", "order_key"]) {
        if (!isStr(s[f])) err(`${p}.${f}`, "must be a string");
      }
      if (!isObj(s.vars) || !Object.values(s.vars).every(isStr)) err(`${p}.vars`, "must be an object of strings");
      unitStage(`${p}.stage`, s.stage);
    });
  }

  if (!Array.isArray(r.seed)) err("seed", "must be an array");
  else {
    r.seed.forEach((s, i) => {
      const p = `seed[${i}]`;
      if (!isObj(s)) return err(p, "must be an object");
      if (!isStr(s.id) || !UNIT_ID_RE.test(s.id)) err(`${p}.id`, "must match ^[A-Za-z0-9._-]+$");
      else if (isProtoName(s.id)) err(`${p}.id`, PROTO_NAME_ERROR);
      unitStage(`${p}.stage`, s.stage);
      if (s.vars !== undefined && (!isObj(s.vars) || !Object.values(s.vars).every(isStr))) {
        err(`${p}.vars`, "must be an object of strings");
      }
    });
  }

  // Placeholders: every string in the recipe may use only the closed set, and params must be declared.
  const walk = (v: unknown, path: string) => {
    if (isStr(v)) {
      for (const m of v.matchAll(PLACEHOLDER_RE)) {
        const problem = placeholderProblem(m[1], params);
        if (problem) err(path, problem);
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(r.stages, "stages");
  walk(r.sources, "sources");
  walk(r.seed, "seed");

  if (errors.length) return { ok: false, errors };
  const recipe = { ...(r as unknown as Recipe), slots };
  return { ok: true, recipe };
}
