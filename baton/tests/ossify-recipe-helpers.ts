// Shared by the ossify-spine recipe tests: the example recipe, read and validated, and a
// session stage's env rendered for one unit. A non-test module, so importing it registers
// no tests twice.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, validate, type Recipe } from "../src/recipe.ts";

export const RECIPE_PATH = join(import.meta.dir, "..", "examples", "ossify-spine", "recipe.json");

/** The recipe file as parsed JSON, before validation. */
export const raw = (): Record<string, any> => JSON.parse(readFileSync(RECIPE_PATH, "utf8"));

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
