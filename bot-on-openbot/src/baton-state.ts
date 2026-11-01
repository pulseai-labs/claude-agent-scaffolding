import { closeSync, constants, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { batonStateDir } from "./paths.ts";

export type UnitView = { stage: string; parked?: { reason: string; at: string; blocked?: true }; pr_url?: string };

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

// True when the run's run.json exists and parses as JSON.
export function runReadable(run: string): boolean {
  return readJson(join(runDir(run), "run.json")) !== null;
}

// The repo a run works in: run.json's `params.repo` when it is an absolute path, else null.
export function runRepo(run: string): string | null {
  const doc = readJson(join(runDir(run), "run.json"));
  if (!isObj(doc) || !isObj(doc.params)) return null;
  const repo = doc.params.repo;
  return typeof repo === "string" && isAbsolute(repo) ? repo : null;
}

// run.json keeps `units` as an object keyed by unit id; `parked` is null when not parked.
// A blocked park (a worker waiting on its own question) carries `parked.blocked` as an object.
export function readUnit(run: string, unit: string): UnitView | null {
  const doc = readJson(join(runDir(run), "run.json"));
  if (!isObj(doc) || !isObj(doc.units) || !Object.hasOwn(doc.units, unit)) return null;
  const u = doc.units[unit];
  if (!isObj(u) || typeof u.stage !== "string") return null;
  const view: UnitView = { stage: u.stage };
  if (isObj(u.parked) && typeof u.parked.reason === "string" && typeof u.parked.at === "string") {
    view.parked = { reason: u.parked.reason, at: u.parked.at };
    if (isObj(u.parked.blocked)) view.parked.blocked = true;
  }
  if (isObj(u.vars) && typeof u.vars.pr_url === "string" && u.vars.pr_url !== "") {
    view.pr_url = u.vars.pr_url;
  }
  return view;
}

// The run's status from run.json ("armed", "parked", "disarmed", "done"), or null when unreadable.
export function runStatus(run: string): string | null {
  const doc = readJson(join(runDir(run), "run.json"));
  return isObj(doc) && typeof doc.status === "string" ? doc.status : null;
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

export type ParkEvent = { at?: string; reason?: string; thread?: string; questions?: string; stop_file?: string; action?: string };

// The unit's `park` event, with the `driver escalate` action recorded after it, if any (an escalate
// belongs to the park before it). Without `since`: the newest park event. With `since`, a park's `at`
// (its notice key's last part, or run.json's `parked.at`): the park's own event. baton reads the clock
// for `parked.at`, saves, and only then appends the event, which takes its own later reading, so the
// two differ by a few ms and an earlier park's event is always before `since`. The park's event is
// therefore the first one at or after `since`; a later park's event ends the search.
export function newestPark(run: string, unit: string, since?: string): ParkEvent | null {
  let text: string;
  try {
    text = readFileSync(join(runDir(run), "events.jsonl"), "utf8");
  } catch {
    return null;
  }
  let found: ParkEvent | null = null;
  let locked = false; // `since` found its event: a later park event is another park's
  for (const line of text.split("\n")) {
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObj(ev) || ev.unit !== unit) continue;
    if (ev.kind === "driver escalate") {
      if (found && typeof ev.action === "string") found.action = ev.action;
      continue;
    }
    if (ev.kind !== "park") continue;
    if (since !== undefined) {
      if (locked) break;
      if (typeof ev.at !== "string" || ev.at < since) continue;
      locked = true;
    }
    const p: ParkEvent = {};
    if (typeof ev.at === "string") p.at = ev.at;
    if (typeof ev.reason === "string") p.reason = ev.reason;
    if (typeof ev.thread === "string") p.thread = ev.thread;
    if (typeof ev.questions === "string") p.questions = ev.questions;
    if (typeof ev.stop_file === "string" && isAbsolute(ev.stop_file)) p.stop_file = ev.stop_file;
    found = p;
  }
  return found;
}

const READ_MAX_BYTES = 8192;

// The start of a text file a seat wrote, or null when it is missing, not a regular file or unreadable.
// Never reads past READ_MAX_BYTES, and never opens a FIFO or a device (a seat could plant one).
export function readHead(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK); // a FIFO must not block the open
  } catch {
    return null;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    const buf = Buffer.alloc(READ_MAX_BYTES);
    const n = readSync(fd, buf, 0, READ_MAX_BYTES, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
