// The driver's pure pieces: its markdown state file, the check on its JSON result, the ledger line.

import { readFileSync } from "node:fs";
import { own, type DriverStage } from "./recipe.ts";
import type { RunState, UnitState } from "./state.ts";

export type DriverLedger = { q: string; a: string; why: string; rejected: string };
export type DriverResult =
  | { result: "resume"; to?: string; cleared: string; ledger: DriverLedger }
  | { result: "escalate"; action: string; ledger: DriverLedger }
  | { result: "stop"; reason: string; ledger: DriverLedger };

const isStr = (v: unknown): v is string => typeof v === "string";

/** The result file, checked. Any refusal returns { invalid } (a reason); the engine escalates it. */
export function readDriverResult(path: string, d: DriverStage, parkStage: string): DriverResult | { invalid: string } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { invalid: "no result file" };
  }
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return { invalid: "not JSON" };
  }
  if (typeof j !== "object" || j === null || Array.isArray(j)) return { invalid: "not JSON" };
  const o = j as Record<string, unknown>;
  if (o.result !== "resume" && o.result !== "escalate" && o.result !== "stop") {
    return { invalid: `unknown result ${JSON.stringify(o.result)}` };
  }
  if (o.result === "resume") {
    if (!isStr(o.cleared) || o.cleared === "") return { invalid: "resume needs cleared" };
    if (!d.clearing.includes(o.cleared)) return { invalid: `cleared "${o.cleared}" is not in the recipe's clearing list` };
    if (o.to !== undefined && (!isStr(o.to) || !(own(d.resume_to, parkStage) ?? []).includes(o.to))) {
      return { invalid: `resume to ${JSON.stringify(o.to)} is not allowed from "${parkStage}"` };
    }
  } else if (o.result === "escalate") {
    if (!isStr(o.action) || o.action.trim() === "") return { invalid: "escalate needs an action" };
  } else if (!isStr(o.reason) || o.reason.trim() === "") {
    return { invalid: "stop needs a reason" };
  }
  const l = o.ledger as Record<string, unknown> | null | undefined;
  if (typeof l !== "object" || l === null || !(["q", "a", "why", "rejected"] as const).every((k) => isStr(l[k]) && l[k] !== "")) {
    return { invalid: "ledger needs q, a, why, rejected" };
  }
  return j as DriverResult;
}

const flat = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, " ");

/** One ledger line: `- <at> <unit> driver | Q: … | A: … | why: … | rejected: …\n`, newlines in fields collapsed to spaces. */
export function ledgerLine(at: string, unit: string, l: DriverLedger): string {
  return `- ${at} ${unit} driver | Q: ${flat(l.q)} | A: ${flat(l.a)} | why: ${flat(l.why)} | rejected: ${flat(l.rejected)}\n`;
}

/** The driver's state file (markdown). `eventsText` is the run's events.jsonl. */
export function renderDriverState(run: RunState, u: UnitState, eventsText: string,
  paths: { result_file: string; ledger: string; stop_file?: string }): string {
  const out: string[] = [`# Driver state — ${run.id}/${u.id}`, "", "## Run", "", `- id: ${run.id}`, `- armed_at: ${run.armed_at}`];
  for (const [k, v] of Object.entries(run.params)) out.push(`- ${k}: ${v}`);

  out.push("", "## Units", "", "| unit | stage | launches here | stalls | parked | pr |", "| --- | --- | --- | --- | --- | --- |");
  const units = Object.values(run.units).sort((a, b) =>
    a.group - b.group || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const x of units) {
    const parked = x.parked ? `${x.parked.reason} @ ${x.parked.at}` : "-";
    out.push(`| ${x.id} | ${x.stage} | ${own(x.launches, x.stage) ?? 0} | ${x.stalls} | ${parked} | ${own(x.vars, "pr_url") ?? "-"} |`);
  }

  const events: Record<string, unknown>[] = [];
  const raw: string[] = [];
  for (const line of eventsText.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const e = JSON.parse(line) as Record<string, unknown>;
      if (typeof e === "object" && e !== null && e.unit === u.id) { events.push(e); raw.push(line); }
    } catch { /* a torn line is not an event */ }
  }

  out.push("", "## This park", "", `- unit: ${u.id}`, `- stage: ${u.stage}`);
  if (u.parked) out.push(`- reason: ${u.parked.reason}`, `- at: ${u.parked.at}`);
  const park = [...events].reverse().find((e) => e.kind === "park");
  if (park) {
    for (const k of ["thread", "questions", "pr", "pr_state", "failing"]) {
      const v = park[k];
      if (v !== undefined && v !== null && v !== "") out.push(`- ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    }
  }

  let from = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if ((e.kind === "transition" && e.to === u.stage) || e.kind === "unit" || e.kind === "unpark") { from = i + 1; break; }
  }
  out.push("", "## Events since the stage entry", "", ...raw.slice(from).slice(-50));

  out.push("", "## Paths", "", `- result file: ${paths.result_file}`, `- ledger: ${paths.ledger}`);
  if (paths.stop_file !== undefined) out.push(`- stop file: ${paths.stop_file}`);
  return out.join("\n") + "\n";
}
