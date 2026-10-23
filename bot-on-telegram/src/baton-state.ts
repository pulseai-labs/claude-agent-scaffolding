import { readFileSync } from "node:fs";
import { join } from "node:path";
import { batonStateDir } from "./paths.ts";

export type UnitView = { stage: string; parked?: { reason: string; at: string }; pr_url?: string };

const runDir = (run: string): string => join(batonStateDir(), "runs", run);

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function readUnit(run: string, unit: string): UnitView | null {
  const doc = readJson(join(runDir(run), "run.json"));
  if (!isObj(doc) || !Array.isArray(doc.units)) return null;
  const u = doc.units.find((x) => isObj(x) && x.id === unit);
  if (!isObj(u) || typeof u.stage !== "string") return null;
  const view: UnitView = { stage: u.stage };
  if (isObj(u.parked) && typeof u.parked.reason === "string" && typeof u.parked.at === "string") {
    view.parked = { reason: u.parked.reason, at: u.parked.at };
  }
  if (isObj(u.vars) && typeof u.vars.pr_url === "string" && u.vars.pr_url !== "") {
    view.pr_url = u.vars.pr_url;
  }
  return view;
}

export function stageNames(run: string): string[] {
  const doc = readJson(join(runDir(run), "recipe.json"));
  if (!isObj(doc) || !isObj(doc.stages)) return [];
  return Object.keys(doc.stages).sort();
}

export function reviewedHead(run: string, unit: string): string | null {
  let text: string;
  try {
    text = readFileSync(join(runDir(run), "out", unit, "review.md"), "utf8");
  } catch {
    return null;
  }
  const m = /^head: ([0-9a-f]{40})$/.exec(text.split("\n")[1] ?? "");
  return m ? m[1]! : null;
}

export function newestPark(
  run: string,
  unit: string,
): { reason?: string; thread?: string; questions?: string } | null {
  let text: string;
  try {
    text = readFileSync(join(runDir(run), "events.jsonl"), "utf8");
  } catch {
    return null;
  }
  let found: { reason?: string; thread?: string; questions?: string } | null = null;
  for (const line of text.split("\n")) {
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObj(ev) || ev.kind !== "park" || ev.unit !== unit) continue;
    const p: { reason?: string; thread?: string; questions?: string } = {};
    if (typeof ev.reason === "string") p.reason = ev.reason;
    if (typeof ev.thread === "string") p.thread = ev.thread;
    if (typeof ev.questions === "string") p.questions = ev.questions;
    found = p;
  }
  return found;
}
