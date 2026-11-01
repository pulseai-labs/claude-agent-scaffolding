// `baton clone`: a new run built from another run's state. The pure half: the new run.json from
// the source's, with no I/O. The command (cli.ts) checks the ids, reads the files and writes them.
//
// Skill-first question 2: mechanical work on baton's own closed state (run.json, recipe.json,
// seats.json). Nothing here reads open input or judges anything.
//
// The clone's units are built from an allowlist of fields, not a copy with deletions. A field
// added to UnitState later is then dropped from a clone until it is listed here on purpose, and
// the safe failure is a missing field, never a live session id carried into a new run.

import { createHash } from "node:crypto";
import { isProtoName, own, type Recipe } from "./recipe.ts";
import { enterStage, type RunState, type UnitState } from "./state.ts";

/** The run-level park every clone starts in. The tick does nothing for a run parked for it. */
export const CLONED_PARK = "cloned";

/** Stages every recipe may name without declaring (recipe.ts TERMINALS). */
const TERMINAL_STAGES = ["done", "park"];

export type CloneOpts = {
  newId: string;
  newDir: string;
  /** The clone's recipe and its exact bytes: the source's, or the `--recipe` file's. */
  recipe: Recipe;
  recipeBytes: Uint8Array;
  /** The source's seats.json bytes, copied as they are; absent when the source had none. */
  seatBytes?: Uint8Array;
  /** `--param` overrides, by declared name. */
  params: Record<string, string>;
  /** `--reset <unit>[=<stage>]`: unit id to the stage it goes to, or undefined for its seed stage. */
  reset: Map<string, string | undefined>;
  /** `--fresh`: every unit back to its seed; a unit the seed does not name is dropped. */
  fresh: boolean;
  /** Every path the source's run directory goes by; each is rewritten to `newDir` in params and vars. */
  srcDirs: string[];
  now: string;
};

/** A refusal; the message is printed as it is. */
export class CloneError extends Error {}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Point a path at the new run. Each directory in `from` becomes `to` where it stands as a whole
 * path prefix: `/s/runs/r1` inside `/s/runs/r1/x` moves, inside `/s/runs/r10/x` does not.
 */
function rewriteDirs(text: string, from: string[], to: string): string {
  let out = text;
  for (const d of from) out = out.replace(new RegExp(`(?<![\\w./-])${escapeRe(d)}(?![\\w.-])`, "g"), to);
  return out;
}

function rewriteVars(vars: Record<string, string>, from: string[], to: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const [k, v] of Object.entries(vars)) out[k] = typeof v === "string" ? rewriteDirs(v, from, to) : v;
  return out;
}

function checkStage(recipe: Recipe, stage: string, what: string): void {
  if (isProtoName(stage)) throw new CloneError(`${what}: stage "${stage}" is not a stage of the recipe`);
  if (TERMINAL_STAGES.includes(stage) || Object.prototype.hasOwnProperty.call(recipe.stages, stage)) return;
  throw new CloneError(`${what}: stage "${stage}" is not a stage of the recipe`);
}

/** The new run.json. Throws CloneError on a refusal; the source is never changed. */
export function cloneRunState(src: RunState, o: CloneOpts): RunState {
  const { recipe } = o;

  // Params: the recipe's declared names only. A source value stands unless overridden; a
  // declared name with neither is a refusal, as at arm.
  const declared = new Set(recipe.params);
  const extra = Object.keys(o.params).filter((p) => !declared.has(p));
  if (extra.length) throw new CloneError(`undeclared param: ${extra.join(", ")}`);
  const from = o.srcDirs;
  const params: Record<string, string> = Object.create(null);
  const missing: string[] = [];
  for (const p of recipe.params) {
    if (Object.prototype.hasOwnProperty.call(o.params, p)) params[p] = o.params[p];
    else if (own(src.params, p) !== undefined) params[p] = rewriteDirs(String(own(src.params, p)), from, o.newDir);
    else missing.push(p);
  }
  if (missing.length) throw new CloneError(`missing param: ${missing.join(", ")} (the source run does not have it; pass --param)`);

  // Units.
  const seed = new Map(recipe.seed.map((s, index) => [s.id, { ...s, index }]));
  for (const id of o.reset.keys()) {
    if (!own(src.units, id)) throw new CloneError(`no such unit: ${id}`);
  }
  const units: Record<string, UnitState> = {};
  const put = (u: UnitState) => { units[u.id] = u; };

  if (o.fresh) {
    // The seed as arm would write it. Units that came from the recipe's sources are not copied:
    // the first tick that runs reads them again from their files, at the source's stage.
    for (const s of recipe.seed) {
      checkStage(recipe, s.stage, `seed unit ${s.id}`);
      put({
        id: s.id, group: 0, order: seed.get(s.id)!.index, vars: Object.assign(Object.create(null), s.vars),
        stage: s.stage, launches: {}, stalls: 0,
      });
    }
  } else {
    for (const old of Object.values(src.units)) {
      const has = o.reset.has(old.id);
      let stage = old.stage;
      let record = true;
      let vars = rewriteVars(old.vars, from, o.newDir);
      if (has) {
        const asked = o.reset.get(old.id);
        const sd = seed.get(old.id);
        if (asked !== undefined) stage = asked;
        else if (sd) stage = sd.stage;
        else throw new CloneError(`unit ${old.id} is not in the recipe's seed: name its stage with --reset ${old.id}=<stage>`);
        if (asked === undefined && sd) {
          vars = Object.assign(Object.create(null), sd.vars);
          record = false;
        }
      }
      checkStage(recipe, stage, `unit ${old.id}`);
      // The allowlist. Group, order and vars are the unit's identity; record_seen and
      // record_at_entry are digests of files the new run reads again; the rest is live state
      // (session, driver, triage, parked, kept, claims, counts) and starts empty.
      const u: UnitState = {
        id: old.id, group: old.group, order: old.order, vars, stage, launches: {}, stalls: 0,
        ...(record && old.record_seen !== undefined ? { record_seen: old.record_seen } : {}),
        ...(record && old.record_at_entry !== undefined ? { record_at_entry: old.record_at_entry } : {}),
      };
      // A fresh visit to the stage it is in: zero counts, no triage, no leftover merge counters.
      enterStage(u, stage);
      put(u);
    }
  }

  return {
    id: o.newId,
    dir: o.newDir,
    recipe_sha256: sha(o.recipeBytes),
    ...(o.seatBytes !== undefined ? { seats_sha256: sha(o.seatBytes) } : {}),
    params,
    armed_at: o.now,
    status: "parked",
    parked: { reason: CLONED_PARK, at: o.now },
    units,
  };
}
