// One signal, evaluated. Signals read closed inputs only: a path's presence, a fixed argv's
// exit status, unit counts in the run's own state, a recorded digest, and (with the merge
// arm) a PR read through the forge. Nothing here judges a result.

import { existsSync } from "node:fs";
import { ForgeReadError, prUrl, type Forge, type PrView } from "./forge.ts";
import { viewOnce } from "./merge.ts";
import { render, type Scope, type Signal } from "./recipe.ts";
import type { RunState, UnitState } from "./state.ts";

export type EvalCtx = {
  run: RunState;
  unit: UnitState;
  scope: Scope;
  /** Where `exit0` runs: the stage's rendered cwd, or the run dir. */
  cwd: string;
  forge: Forge;
  /** PR reads made this tick, by URL: one `view` per URL per tick. */
  prViews: Map<string, PrView>;
};

export type Verdict = "true" | "false" | "pending";

/** An `exit0` argv that neither passed (rc 0) nor failed (rc 1): the unit parks. */
export class Exit0Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Exit0Error";
  }
}

export const EXIT0_TIMEOUT_MS = 60_000;

/** Run `argv` with no shell in `cwd`; the exit code, or null when it could not run or timed out. */
export function runArgv(argv: string[], cwd: string, timeoutMs: number): number | null {
  try {
    const p = Bun.spawnSync(argv, { cwd, stdin: "ignore", stdout: "ignore", stderr: "ignore", timeout: timeoutMs });
    return p.signalCode ? null : p.exitCode;
  } catch {
    return null;
  }
}

const verdict = (b: boolean): Verdict => (b ? "true" : "false");

export async function evaluate(sig: Signal, ctx: EvalCtx): Promise<Verdict> {
  if ("file" in sig) return verdict(existsSync(render(sig.file, ctx.scope)));
  if ("absent" in sig) return verdict(!existsSync(render(sig.absent, ctx.scope)));
  if ("exit0" in sig) {
    const argv = sig.exit0.map((a) => render(a, ctx.scope));
    const rc = runArgv(argv, ctx.cwd, EXIT0_TIMEOUT_MS);
    if (rc === 0) return "true";
    if (rc === 1) return "false";
    throw new Exit0Error(`exit0 ${JSON.stringify(argv)}: ${rc === null ? "did not run to an exit" : `rc ${rc}`}`);
  }
  if ("pr" in sig) {
    const url = await prUrl(sig.pr.url.map((a) => render(a, ctx.scope)), ctx.cwd);
    let v: PrView;
    try {
      v = await viewOnce(ctx.forge, ctx.prViews, url);
    } catch (e) {
      throw new ForgeReadError("pr view failed", `${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
    delete ctx.unit.forge_failures; // a read that worked
    ctx.scope.pr = { url, head: v.head };
    switch (sig.pr.test) {
      case "open": return verdict(v.state === "OPEN");
      case "merged": return verdict(v.state === "MERGED");
      case "closed": return verdict(v.state === "CLOSED");
      case "checks_green": return v.checks === "pending" ? "pending" : verdict(v.checks === "green");
      case "checks_red": return v.checks === "pending" ? "pending" : verdict(v.checks === "red");
      case "mergeable": return v.mergeable === "UNKNOWN" ? "pending" : verdict(v.mergeable === "MERGEABLE");
      case "conflict": return v.mergeable === "UNKNOWN" ? "pending" : verdict(v.mergeable === "CONFLICTING");
    }
  }
  if ("units" in sig) {
    const { group, stages, count } = sig.units;
    const g = group === undefined ? undefined : render(group, ctx.scope);
    // The asking unit is not one of the units it asks about.
    const set = Object.values(ctx.run.units).filter((u) => u.id !== ctx.unit.id && (g === undefined || String(u.group) === g));
    const inStages = set.filter((u) => stages.includes(u.stage)).length;
    if (count === "all") return verdict(set.length > 0 && inStages === set.length);
    if (count === "any") return verdict(inStages > 0);
    return verdict(inStages === 0);
  }
  if ("active" in sig) {
    // The group is the run's current group (the highest seen): no other unit there has a
    // live session, with or without a thread id.
    const g = ctx.scope.run.group;
    return verdict(!Object.values(ctx.run.units).some((u) => u.id !== ctx.unit.id && String(u.group) === g && u.session));
  }
  if ("record_changed" in sig) {
    const u = ctx.unit;
    return verdict(u.record_seen !== undefined && u.record_seen !== u.record_at_entry);
  }
  throw new Error(`unknown signal ${JSON.stringify(sig)}`);
}
