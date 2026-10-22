// The example ossify-spine recipe (baton/examples/ossify-spine/recipe.json), pinned
// structurally: the claim every seat carries, the roles, where each stage launches, the
// dispatch count and cap, the R7 gap re-entry, the land order, and the build slot.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, validate, type MergeStage, type Recipe, type SessionStage, type WaitStage } from "../src/recipe.ts";

export const RECIPE_PATH = join(import.meta.dir, "..", "examples", "ossify-spine", "recipe.json");
const BIN = join(import.meta.dir, "..", "bin", "baton");

const raw = (): Record<string, any> => JSON.parse(readFileSync(RECIPE_PATH, "utf8"));

/** The example recipe, validated; throws with baton's errors when it does not validate. */
export function loadRecipe(): Recipe {
  const res = validate(raw());
  if (!res.ok) throw new Error(`ossify-spine recipe does not validate:\n${res.errors.join("\n")}`);
  return res.recipe;
}

/** A session stage's env, rendered for one unit in a stand-in run. */
export function renderStageEnv(
  stage: string,
  unit: { id: string; vars: Record<string, string> },
  params: Record<string, string>,
): Record<string, string> {
  const st = loadRecipe().stages[stage];
  if (!st || st.kind !== "session") throw new Error(`not a session stage: ${stage}`);
  const scope = {
    param: params,
    unit: { id: unit.id, group: "1", order: 1, vars: unit.vars },
    run: { id: "run1", dir: "/runs/run1", group: "1" },
    attempt: 1,
  };
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(st.env)) env[k] = render(v, scope);
  return env;
}

const SESSION_STAGES = [
  "lane", "implement", "regap", "close", "reclose", "correct",
  "spine_open", "spine_review", "spine_work", "spine_finish",
];

function sessions(r: Recipe): [string, SessionStage][] {
  return Object.entries(r.stages).filter(([, s]) => s.kind === "session") as [string, SessionStage][];
}
const rolesOf = (r: Recipe) => Object.fromEntries(sessions(r).map(([n, s]) => [n, s.env.SEAT_MODS_ROLE]));

const OUT = "{run.dir}/out/{unit.id}";
const DISPATCHED = ["env", "-C", "{param.ai_root}", "{param.oss}", "work_item_dispatched", "{unit.id}"];
const CAP_CHECK = [
  "jq", "-e", "--arg", "w", "{unit.id}",
  "any(.work_items[]; .id == $w and (.dispatches // 0) < 3)", "{param.state_file}",
];

const PARAMS: Record<string, string> = {
  spine: "r0.s6", spine_branch: "spine/r0.s6-demo", spine_dir: "/ai/docs/spines/r0.s6",
  ai_root: "/ai", ai_project: "demo-ai", repo: "/canon", project: "demo", state_file: "/ai/.ossify/project-state.json",
  oss: "/bin/oss", briefs: "/briefs", via: "omp-glm-flash",
};

describe("ossify-spine recipe", () => {
  test("ossify recipe validates", async () => {
    expect(validate(raw()).ok).toBe(true);
    const p = Bun.spawn([BIN, "validate", RECIPE_PATH], { stdout: "pipe", stderr: "pipe" });
    const [err, rc] = await Promise.all([new Response(p.stderr).text(), p.exited]);
    expect(err).toBe("");
    expect(rc).toBe(0);
  });

  test("the session stages are exactly the table's", () => {
    expect(sessions(loadRecipe()).map(([n]) => n).sort()).toEqual([...SESSION_STAGES].sort());
  });

  test("no literal brace outside a placeholder", () => {
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(raw());
    const stray = strings.filter((s) => /[{}]/.test(s.replace(/\{[^{}]*\}/g, "")));
    expect(stray).toEqual([]);
  });

  test("every session stage drops T3 MCP and runs molt as a child", () => {
    for (const [name, s] of sessions(loadRecipe())) {
      const where = `stage ${name}`;
      expect([where, s.env.OMP_T3_DROP_T3_MCP]).toEqual([where, "1"]);
      expect([where, s.env.OMP_T3_SEAT]).toEqual([where, "worker"]);
      expect([where, s.env.OMP_T3_VIA]).toEqual([where, "{param.via}"]);
      expect([where, s.env.MOLT_HANDOFF]).toEqual([where, "parent"]);
      expect(s.handoff).not.toBeNull();
      expect([where, s.handoff!.file]).toEqual([where, `${OUT}/molt.log`]);
      expect([where, s.env.MOLT_STATUS_PATH]).toEqual([where, s.handoff!.file]);
      expect([where, s.stop_file]).toEqual([where, `${OUT}/stop`]);
      expect([where, s.env.SPINE_STOP_FILE]).toEqual([where, `${OUT}/stop`]);
      expect([where, s.env.SPINE_LEDGER]).toEqual([where, "{param.spine_dir}/autopilot-ledger.md"]);
      expect([where, s.instance]).toEqual([where, "OMP_Seat"]);
      expect([where, s.before?.[0]]).toEqual([where, ["mkdir", "-p", OUT]]);
    }
  });

  const ROLES = {
    lane: "coordinator", regap: "coordinator", spine_open: "coordinator", spine_finish: "coordinator",
    implement: "implementer", close: "implementer", reclose: "implementer", correct: "implementer",
    spine_work: "implementer", spine_review: "reviewer",
  };

  test("roles match the table", () => {
    expect(rolesOf(loadRecipe())).toEqual(ROLES);
    // adjacent control: the same assertion fails on a copy with regap as an implementer
    const copy = structuredClone(loadRecipe());
    (copy.stages.regap as SessionStage).env.SEAT_MODS_ROLE = "implementer";
    expect(rolesOf(copy)).not.toEqual(ROLES);
  });

  test("root launch is exactly the AI-root and spine-push stages", () => {
    const r = loadRecipe();
    const root = sessions(r).filter(([, s]) => s.launch_dir === "root").map(([n]) => n).sort();
    expect(root).toEqual(["close", "lane", "reclose", "regap", "spine_finish", "spine_open", "spine_work"]);
    for (const n of ["implement", "correct", "spine_review"]) {
      expect([n, (r.stages[n] as SessionStage).launch_dir]).toEqual([n, "worktree"]);
    }
  });

  test("implementer claim allows the item spec dir", () => {
    for (const stage of ["implement", "correct"]) {
      const env = renderStageEnv(stage, { id: "r0.s6.w1", vars: { worktree_path: "/wt/w1" } }, PARAMS);
      const allow = env.SEAT_MODS_ALLOW.split(":");
      expect([stage, allow]).toEqual([stage, ["/ai/docs/spines/r0.s6/work-r0.s6.w1", "/runs/run1/out/r0.s6.w1"]]);
    }
  });

  test("every write allowance matches the table", () => {
    const item = `{param.spine_dir}/work-{unit.id}:${OUT}`;
    const allow = Object.fromEntries(sessions(loadRecipe()).map(([n, s]) => [n, s.env.SEAT_MODS_ALLOW]));
    expect(allow).toEqual({
      lane: OUT, regap: OUT, close: OUT, reclose: OUT, spine_open: OUT, spine_review: OUT, spine_finish: OUT,
      implement: item, correct: item, spine_work: `${OUT}:{param.spine_dir}`,
    });
  });

  test("only implement and correct count, after launch", () => {
    const r = loadRecipe();
    for (const [name, s] of sessions(r)) {
      if (name === "implement" || name === "correct") {
        expect([name, s.after_launch]).toEqual([name, [DISPATCHED]]);
        expect([name, s.before?.[1]]).toEqual([name, CAP_CHECK]);
      } else {
        expect([name, s.after_launch ?? []]).toEqual([name, []]);
      }
      for (const argv of s.before ?? []) expect([name, argv.includes("work_item_dispatched")]).toEqual([name, false]);
    }
  });

  test("gap re-entry carries the R7 signal", () => {
    const w = loadRecipe().stages.gap_wait as WaitStage;
    expect(w.kind).toBe("wait");
    expect(w.outcomes[0].to).toBe("regap");
    expect(w.outcomes[0].when).toContainEqual({ active: "none-in-group" });
    expect(w.outcomes[0].when).toContainEqual({
      units: { group: "{run.group}", stages: ["correct", "reclose"], count: "none" },
    });
  });

  test("land merges by plan (a)'s order", () => {
    const land = loadRecipe().stages.land as MergeStage;
    expect(land.kind).toBe("merge");
    expect(land.ordered).toBe(true);
    expect(land.checks).toBe("green");
    expect(land.base).toBe("{param.spine_branch}");
    expect(land.repo).toBe("{param.repo}");
    expect(land.outcomes).toEqual({ merged: "done", red: "park", conflict: "park" });
    expect(land.run_after).toEqual([
      ["sh", "-c", 'test "$(git -C "$1" symbolic-ref --short HEAD)" = "$2"', "sh", "{param.repo}", "{param.spine_branch}"],
      ["git", "-C", "{param.repo}", "merge", "--ff-only", "origin/{param.spine_branch}"],
      ["git", "-C", "{param.repo}", "merge-base", "--is-ancestor", "{pr.head}", "{param.spine_branch}"],
      ["env", "-C", "{param.ai_root}", "{param.oss}", "work_item_status", "{unit.id}", "complete"],
    ]);
  });

  test("build slot only where a build starts", () => {
    for (const [name, s] of sessions(raw() as Recipe)) {
      const want = name === "implement" || name === "correct" ? ["session", "build"] : ["session"];
      expect([name, s.slots]).toEqual([name, want]);
    }
  });
});
