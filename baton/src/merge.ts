// The merge-stage arm of the tick: one unit, one decision, by the recipe's rule. The engine
// hands in what it owns (events, parking, stage moves, hooks); this file decides.

import { existsSync } from "node:fs";
import { ForgeReadError, landed, prUrl, type Forge, type PrView } from "./forge.ts";
import { render, type MergeStage, type Scope } from "./recipe.ts";
import type { RunState, UnitState } from "./state.ts";

export const MERGE_FAILURES_TO_PARK = 3;

export type MergeEnv = {
  run: RunState;
  forge: Forge;
  /** PR reads made this tick, by URL: one `view` per URL per tick. */
  prViews: Map<string, PrView>;
  scope(u: UnitState, extra?: Partial<Scope>): Scope;
  ev(kind: string, obj?: Record<string, unknown>): void;
  park(u: UnitState, reason: string): Promise<void>;
  move(u: UnitState, to: string): Promise<void>;
  /** Run hook argvs in order with no shell; false at the first non-zero. */
  hooks(list: string[][] | undefined, scope: Scope, cwd: string): boolean;
  save(): void;
  merged(u: UnitState): void;
};

/** One `view` per URL per tick. */
export async function viewOnce(forge: Forge, prViews: Map<string, PrView>, url: string): Promise<PrView> {
  let v = prViews.get(url);
  if (v === undefined) {
    v = await forge.view(url);
    prViews.set(url, v);
  }
  return v;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function mergeUnit(env: MergeEnv, u: UnitState, stage: MergeStage): Promise<void> {
  const base0 = env.scope(u);
  // A bad URL throws PrUrlError (parks at once); a failed read throws ForgeReadError, which
  // the engine counts and retries.
  const url = await prUrl(stage.pr.map((a) => render(a, base0)), env.run.dir);
  let view: PrView;
  try {
    view = await viewOnce(env.forge, env.prViews, url);
  } catch (e) {
    throw new ForgeReadError("pr view failed", `${url}: ${message(e)}`);
  }
  if (view.state !== "MERGED") delete u.forge_failures; // a read that worked
  const scope = env.scope(u, { pr: { url, head: view.head } });
  const base = render(stage.base, scope);
  const repo = render(stage.repo, scope);

  if (view.state === "MERGED") {
    let ok: boolean;
    try {
      ok = await landed(repo, base, view.head);
    } catch (e) {
      throw new ForgeReadError("landed failed", `${url}: ${message(e)}`); // could not run: retried
    }
    // A landed check that ran ends in a park or a move; the move's stage entry resets the count.
    if (!ok) {
      env.ev("not landed", { unit: u.id, pr: url, head: view.head, base });
      return env.park(u, "not landed");
    }
    if (!env.hooks(stage.run_after, scope, existsSync(repo) ? repo : env.run.dir)) return env.park(u, "run failed");
    env.ev("merged", { unit: u.id, pr: url, head: view.head });
    env.merged(u);
    return env.move(u, stage.outcomes.merged);
  }
  if (view.state === "CLOSED") return env.park(u, "pr closed");

  if (view.base !== base) {
    env.ev("wrong base", { unit: u.id, pr: url, base: view.base, expected: base });
    return env.park(u, "wrong base");
  }
  if (view.mergeable === "CONFLICTING") return env.move(u, stage.outcomes.conflict);
  if (view.checks === "red") return env.move(u, stage.outcomes.red);
  if (view.checks === "pending" || view.mergeable === "UNKNOWN") return;
  if (view.checks === "none" && stage.checks !== "none-required") return;
  if (stage.ordered) {
    const earlier = Object.values(env.run.units).some(
      (o) => o.id !== u.id && o.group === u.group && o.order < u.order && o.stage !== "done");
    if (earlier) return;
  }

  try {
    await env.forge.merge(url, view.head);
    delete u.merge_failures;
    env.ev("merge requested", { unit: u.id, pr: url, head: view.head });
    env.save();
  } catch (e) {
    u.merge_failures = (u.merge_failures ?? 0) + 1;
    env.ev("merge call failed", { unit: u.id, pr: url, failures: u.merge_failures, reason: message(e) });
    env.save();
    if (u.merge_failures >= MERGE_FAILURES_TO_PARK) return env.park(u, "merge failed");
  }
}
