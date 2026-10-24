// The forge seam: what the engine reads about a pull request and how it merges one. `GhForge`
// is the `gh` implementation. Merges are always a merge commit, pinned to the head that was read.

export type PrView = {
  state: "OPEN" | "MERGED" | "CLOSED";
  head: string;
  base: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  checks: "green" | "red" | "pending" | "none";
  /** The names of the red checks, when `checks` is red; absent when the forge read none. */
  failing?: string[];
};

export interface Forge {
  view(url: string): Promise<PrView>;
  merge(url: string, headOid: string): Promise<void>;
}

/** A `pr` argv whose output is not a pull-request URL: the unit parks `pr url`. */
export class PrUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrUrlError";
  }
}

/** What a failed forge read was reading; also the park reason at the third failure in a row. */
export type ForgeRead = "pr view failed" | "pr url" | "landed failed";

/**
 * A forge read that failed and may work next tick (a `gh` 502, a rate limit, a network blip).
 * The engine counts these per unit; `FORGE_FAILURES_TO_PARK` in a row park it.
 */
export class ForgeReadError extends Error {
  constructor(public what: ForgeRead, message: string) {
    super(message);
    this.name = "ForgeReadError";
  }
}

export const FORGE_FAILURES_TO_PARK = 3;

const PR_URL_RE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/[0-9]+$/;
const GH_TIMEOUT_MS = 120_000;

type Run = { rc: number | null; out: string; err: string };

async function run(argv: string[], cwd?: string, timeoutMs = GH_TIMEOUT_MS): Promise<Run> {
  try {
    const p = Bun.spawn(argv, { cwd, env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    await p.exited;
    return { rc: p.signalCode ? null : p.exitCode, out, err };
  } catch (e) {
    return { rc: null, out: "", err: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Run the stage's `pr` argv (no shell) and return its output as a PR URL. A non-zero exit is a
 * failed read (`ForgeReadError`, retried). The shape check is a safety rail on open input: it
 * only adds a stop, and approves nothing.
 */
export async function prUrl(argv: string[], cwd?: string): Promise<string> {
  const r = await run(argv, cwd, 60_000);
  if (r.rc !== 0) throw new ForgeReadError("pr url", `pr argv ${JSON.stringify(argv)} did not exit 0`);
  const url = r.out.trim();
  if (!PR_URL_RE.test(url)) throw new PrUrlError(`not a pull request URL: ${JSON.stringify(url.slice(0, 200))}`);
  return url;
}

type Entry = { __typename?: string; status?: string; conclusion?: string; state?: string; name?: string; context?: string };
const RED_CONCLUSIONS = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

const isContext = (e: Entry) => e.__typename === "StatusContext" || (e.status === undefined && e.state !== undefined);
const isRed = (e: Entry) => (isContext(e) ? e.state === "FAILURE" || e.state === "ERROR" : RED_CONCLUSIONS.has(e.conclusion ?? ""));

/** The names of the red entries, for a park's notice: a check run's `name`, a status's `context`. */
export function failingChecks(entries: Entry[]): string[] {
  const names = entries.filter(isRed).map((e) => (isContext(e) ? e.context : e.name) ?? "unnamed check");
  return [...new Set(names)];
}

/** Fold a `statusCheckRollup` into one word: red beats pending beats green; an empty rollup is none. */
export function rollup(entries: Entry[]): PrView["checks"] {
  if (entries.length === 0) return "none";
  if (entries.some(isRed)) return "red";
  // Green is a whitelist: anything neither red nor on it (STALE, a null or unknown conclusion,
  // an unrecognised state) is not yet green and reads pending.
  const isGreen = (e: Entry) =>
    isContext(e) ? e.state === "SUCCESS"
      : e.status === "COMPLETED" && (e.conclusion === "SUCCESS" || e.conclusion === "NEUTRAL" || e.conclusion === "SKIPPED");
  return entries.every(isGreen) ? "green" : "pending";
}

export class GhForge implements Forge {
  async view(url: string): Promise<PrView> {
    const r = await run(["gh", "pr", "view", url, "--json", "state,headRefOid,baseRefName,mergeable,statusCheckRollup"]);
    if (r.rc !== 0) throw new Error(`gh pr view failed: ${r.err.trim().slice(0, 300)}`);
    const j = JSON.parse(r.out) as {
      state: string; headRefOid: string; baseRefName: string; mergeable: string; statusCheckRollup: Entry[] | null;
    };
    if (j.state !== "OPEN" && j.state !== "MERGED" && j.state !== "CLOSED") throw new Error(`gh pr view: unknown state ${j.state}`);
    const failing = failingChecks(j.statusCheckRollup ?? []);
    return {
      state: j.state,
      head: j.headRefOid,
      base: j.baseRefName,
      mergeable: j.mergeable === "MERGEABLE" || j.mergeable === "CONFLICTING" ? j.mergeable : "UNKNOWN",
      checks: rollup(j.statusCheckRollup ?? []),
      ...(failing.length ? { failing } : {}),
    };
  }

  async merge(url: string, headOid: string): Promise<void> {
    const r = await run(["gh", "pr", "merge", url, "--merge", "--match-head-commit", headOid]);
    if (r.rc !== 0) throw new Error(`gh pr merge failed: ${r.err.trim().slice(0, 300)}`);
  }
}

/**
 * Is `oid` on `origin/<base>` of the checkout at `repo`? Fixed git arguments, no shell. A failed
 * fetch or an unusable repo throws; only "not an ancestor" is false.
 */
export async function landed(repo: string, base: string, oid: string): Promise<boolean> {
  const f = await run(["git", "-C", repo, "fetch", "origin", base]);
  if (f.rc !== 0) throw new Error(`git fetch origin ${base} failed: ${f.err.trim().slice(0, 300)}`);
  const m = await run(["git", "-C", repo, "merge-base", "--is-ancestor", oid, `origin/${base}`]);
  if (m.rc === 0) return true;
  // rc 1: not an ancestor. rc 128: the oid is not in this checkout at all (a head that never
  // reached origin/<base>); it cannot be on the base either.
  if (m.rc === 1 || m.rc === 128) return false;
  throw new Error(`git merge-base failed: ${m.err.trim().slice(0, 300)}`);
}
