// The tick: one pass, under the store lock, over every armed run. Per run, in order:
// 0 orphan recovery, 1 sources, 2 stop files, 3 live sessions, 4 wait stages,
// 5 merge stages, 6 launches due, 7 drivers, 8 done. A host that refuses the credentials or
// cannot be reached stops the tick with nothing marked. Step 3 also runs the decision procedure
// for a session waiting on a pending request: wait, triage it once, act on the triage's result.
// Step 7, with a driver in the recipe: a parked unit gets one driver session, whose result
// resumes it, escalates it to the operator, or stops the run. Only an escalate or a stop notifies.

import { createHash } from "node:crypto";
import {
  appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { ClaimBusy, claimKey, liveClaim, removeClaim, writeClaim } from "./claims.ts";
import { ledgerLine, readDriverResult, renderDriverState } from "./driver.ts";
import { FORGE_FAILURES_TO_PARK, ForgeReadError, PrUrlError, type Forge, type PrView } from "./forge.ts";
import {
  HostAuthError, HostDownError, LaunchError, type Host, type LaunchRequest, type PendingRequest, type ThreadStatus,
} from "./host.ts";
import { readConfig, type Config } from "./notify.ts";
import {
  DEFAULT_SLOTS, DEFAULT_STAGE_SLOTS, isProtoName, nonce as launchNonce, own, render, threadTitle, UNIT_ID_RE,
  type DriverStage, type Outcome, type Recipe, type Scope, type SessionStage, type Stage, type TriageStage, type WaitStage,
} from "./recipe.ts";
import { mergeUnit, type ParkPr } from "./merge.ts";
import { runSummary } from "./summary.ts";
import { evaluate, Exit0Error, runArgv, type EvalCtx } from "./signals.ts";
import { enterStage, type RunState, type Session, type Store, type UnitState } from "./state.ts";

export type TickReport = {
  launched: string[];
  transitioned: string[];
  parked: string[];
  merged: string[];
  errors: string[];
  /** Set when the host stopped the tick: `auth` (rc 3) or `down` (rc 4). */
  host?: "auth" | "down";
};

export type Notify = (key: string, message: string) => void | Promise<void>;

export type TickOpts = {
  store: Store;
  host: Host;
  forge: Forge;
  notify: Notify;
  now: () => Date;
  runId?: string;
};

/** The CLI's exit code for a tick: 0 done (a busy lock included), 3 host auth, 4 host down, 1 other. */
export function exitCode(r: TickReport): number {
  if (r.host === "auth") return 3;
  if (r.host === "down") return 4;
  return r.errors.length ? 1 : 0;
}

const MIN = 60_000;
const DEFAULT_LAUNCH_DIR = "worktree";
const DEFAULT_MAX_LAUNCHES = 3;
const DEFAULT_STALL_MINUTES = 45;
const DEFAULT_SETTLE_MINUTES = 10;
const DEFAULT_TRIAGE_STALL_MINUTES = 10;
/** The `seq` key and nonce segment of a triage launch: `<run>/<unit>/triage/<n>`. */
const TRIAGE = "triage";
const DEFAULT_DRIVER_STALL_MINUTES = 10;
/** The `seq` key and nonce segment of a driver launch: `<run>/<unit>/driver/<n>`. */
const DRIVER = "driver";
const ORPHAN_MS = 2 * MIN;
const STALLS_TO_PARK = 2;
const DOWN_NOTIFY_MS = 30 * MIN;
const HOOK_TIMEOUT_MS = 10 * MIN;
const WALK_LIMIT = 5000;

const emptyReport = (): TickReport => ({ launched: [], transitioned: [], parked: [], merged: [], errors: [] });
const isHostError = (e: unknown) => e instanceof HostAuthError || e instanceof HostDownError;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const day = (d: Date) => d.toISOString().slice(0, 10);
const atWork = (st: ThreadStatus) => st.state === "active" || st.state === "waiting";

function runGroup(run: RunState): number {
  let g = 0;
  for (const u of Object.values(run.units)) if (u.group > g) g = u.group;
  return g;
}

/** The scope a unit's templates render with. */
export function unitScope(run: RunState, u: UnitState, extra: Partial<Scope> = {}): Scope {
  return {
    param: run.params,
    // A live session renders with the vars it launched with; a rewritten record applies from
    // the next launch.
    unit: { id: u.id, group: String(u.group), order: u.order, vars: u.session?.vars ?? u.vars },
    run: { id: run.id, dir: run.dir, group: String(runGroup(run)) },
    attempt: own(u.launches, u.stage) ?? 0,
    ...extra,
  };
}

/** Unpark `u` in place (`to` undefined) or into stage `to`. A `stop` park's stop file is renamed
 *  to `<path>.consumed-<nowIso>`. A live driver's claim is removed and `u.driver` deleted.
 *  `recipe` is required for `to`; with none, an in-place unpark still resets but skips stop-file
 *  consumption. Returns the stage the unit is now in and the consumed path, if any. Caller holds the lock and saves. */
export function unparkUnit(run: RunState, recipe: Recipe | undefined, u: UnitState, to: string | undefined, nowIso: string):
  { stage: string; consumed?: string } {
  let consumed: string | undefined;
  if (u.parked?.reason === "stop") {
    // Rendered before any stage move: the park stage's stop_file is the one that blocks.
    const stage = recipe ? own(recipe.stages, u.stage) : undefined;
    if (stage?.kind === "session" && stage.stop_file !== undefined) {
      try {
        const path = render(stage.stop_file, unitScope(run, u));
        if (existsSync(path)) {
          consumed = `${path}.consumed-${nowIso}`;
          renameSync(path, consumed);
        }
      } catch {
        consumed = undefined; // a path that cannot render or move: the park still ends
      }
    }
  }
  if (u.driver) {
    removeClaim(u.driver.session.claim_key, u.driver.session.claim_nonce);
    delete u.driver;
  }
  delete u.parked;
  if (to !== undefined) {
    enterStage(u, to, recipe && triageNote(run, recipe, u)); // the same stage entry an outcome's move makes
  } else {
    // Resume in place: the counts that parked it start over; the visit's record_at_entry stands.
    u.stalls = 0;
    delete u.merge_failures;
    delete u.forge_failures;
    u.launches[u.stage] = 0;
  }
  return consumed === undefined ? { stage: u.stage } : { stage: u.stage, consumed };
}

/** The unit's rendered triage note path; undefined with no triage stage or a path that cannot render. */
export function triageNote(run: RunState, recipe: Recipe, u: UnitState): string | undefined {
  if (!recipe.triage) return undefined;
  try {
    return render(recipe.triage.note_file, unitScope(run, u));
  } catch {
    return undefined;
  }
}

/** A merge-stage park names its PR and what stopped it, so the notice alone says where to look. */
function prSuffix(pr: ParkPr | undefined): string {
  return pr === undefined ? ""
    : ` — ${pr.why === "conflict" ? "conflict" : `red${pr.failing ? `: ${pr.failing.join(", ")}` : ""}`} — ${pr.url}`;
}

function removeFile(path: string): void {
  try {
    unlinkSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

export async function tick(opts: TickOpts): Promise<TickReport> {
  const report = emptyReport();
  const r = await opts.store.withLock(async () => {
    await tickLocked(opts, report);
    return report;
  });
  return r === "busy" ? emptyReport() : r;
}

async function tickLocked(opts: TickOpts, report: TickReport): Promise<void> {
  let config: Config;
  try {
    config = readConfig();
  } catch (e) {
    report.errors.push(`config: ${message(e)}`);
    return;
  }
  const all: RunTick[] = [];
  for (const id of opts.store.listRuns()) {
    try {
      const run = opts.store.readRun(id);
      if (run.status !== "armed" && run.status !== "parked") continue;
      const recipe = JSON.parse(readFileSync(join(run.dir, "recipe.json"), "utf8")) as Recipe;
      all.push(new RunTick(opts, report, config, all, run, recipe));
    } catch (e) {
      if (opts.runId === undefined || opts.runId === id) report.errors.push(`${id}: ${message(e)}`);
    }
  }
  const downFile = join(opts.store.dir, "host-down");
  try {
    for (const rt of all) {
      if (opts.runId !== undefined && rt.run.id !== opts.runId) continue;
      await rt.tick();
    }
    if (existsSync(downFile)) unlinkSync(downFile);
  } catch (e) {
    const now = opts.now();
    if (e instanceof HostAuthError) {
      report.host = "auth";
      report.errors.push(`host auth: ${e.message}`);
      await opts.notify(`auth/${day(now)}`, "t3 token rejected — run baton t3 login");
    } else if (e instanceof HostDownError) {
      report.host = "down";
      report.errors.push(`host down: ${e.message}`);
      let since = Number.NaN;
      try {
        since = Date.parse(readFileSync(downFile, "utf8").trim());
      } catch { /* first tick of the outage */ }
      if (Number.isNaN(since)) writeFileSync(downFile, now.toISOString() + "\n", { mode: 0o600 });
      else if (now.getTime() - since >= DOWN_NOTIFY_MS) {
        await opts.notify(`down/${day(now)}`, `host unreachable since ${new Date(since).toISOString()}`);
      }
    } else {
      throw e;
    }
  }
}

type Ctx = { stage: Stage; scope: Scope };

class RunTick {
  private saved: string;
  private held = new Set<string>();
  private prViews = new Map<string, PrView>();
  /** Units that entered a stage this tick: steps 4 and 5 read them again next tick, not now. */
  private entered = new Set<string>();

  constructor(
    private opts: TickOpts,
    private report: TickReport,
    private config: Config,
    private all: RunTick[],
    public run: RunState,
    public recipe: Recipe,
  ) {
    this.saved = JSON.stringify(run);
  }

  // ---- plumbing --------------------------------------------------------------------------

  private get host(): Host { return this.opts.host; }
  private nowMs(): number { return this.opts.now().getTime(); }
  private nowIso(): string { return this.opts.now().toISOString(); }

  /** Write run.json only when it changed, so a tick that does nothing leaves it byte-identical. */
  private save(): void {
    const text = JSON.stringify(this.run);
    if (text === this.saved) return;
    this.opts.store.writeRun(this.run);
    this.saved = text;
  }

  private ev(kind: string, obj: Record<string, unknown> = {}): void {
    this.opts.store.event(this.run.id, { kind, ...obj });
  }

  private group(): number {
    return runGroup(this.run);
  }

  private ordered(): UnitState[] {
    return Object.values(this.run.units).sort((a, b) =>
      a.group - b.group || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private scope(u: UnitState, extra: Partial<Scope> = {}): Scope {
    return unitScope(this.run, u, extra);
  }

  private ctx(u: UnitState): Ctx {
    return { stage: own(this.recipe.stages, u.stage), scope: this.scope(u) };
  }

  stageSlots(stageName: string): string[] {
    const st = own(this.recipe.stages, stageName);
    return st?.kind === "session" ? st.slots ?? DEFAULT_STAGE_SLOTS : [];
  }

  /** Live sessions, with or without a thread id, that hold `slot`. */
  liveIn(slot: string): number {
    return Object.values(this.run.units).filter((u) => u.session && this.stageSlots(u.stage).includes(slot)).length;
  }

  private async notify(key: string, text: string): Promise<void> {
    await this.opts.notify(key, text);
  }

  // ---- unit exits -------------------------------------------------------------------------

  /**
   * End the unit's session: interrupt (if asked), remove its claim, release its directory. A
   * triage still running for it is interrupted and released first: every exit ends the triage.
   */
  private async endSession(u: UnitState, o: { interrupt?: string; release?: boolean } = {}): Promise<void> {
    await this.endTriage(u, { interrupt: true });
    const s = u.session;
    if (!s) return;
    const { stage, scope } = this.ctx(u);
    if (o.interrupt && s.thread_id) await this.host.interrupt(s.thread_id, o.interrupt);
    removeClaim(s.claim_key, s.claim_nonce);
    if (o.release !== false && stage.kind === "session") await this.release(u, stage, scope, s.launch_dir, s);
    delete u.session;
    delete u.quiet_since;
    this.save();
  }

  /**
   * The project and cwd a session was launched with. An in-flight session never re-renders them:
   * its record may have been rewritten since. A session from older state without them re-renders.
   */
  private launchedWith(stage: SessionStage, scope: Scope, s?: Session): { project: string; cwd: string } {
    return { project: s?.project ?? render(stage.project, scope), cwd: s?.cwd ?? render(stage.cwd, scope) };
  }

  private async release(u: UnitState, stage: SessionStage, scope: Scope, dir: string, s?: Session): Promise<void> {
    await this.releaseDir(u, dir, () => this.launchedWith(stage, scope, s));
  }

  private async releaseDir(u: UnitState, dir: string, where: () => { project: string; cwd: string }): Promise<void> {
    try {
      const w = where();
      await this.host.release(w.project, w.cwd, dir);
    } catch (e) {
      if (isHostError(e)) throw e;
      this.report.errors.push(`${this.run.id}/${u.id}: release failed: ${message(e)}`);
      this.ev("release failed", { unit: u.id, dir, reason: message(e) });
    }
  }

  private async park(
    u: UnitState, reason: string,
    o: { interrupt?: string; release?: boolean; questions?: unknown[]; thread?: string; pr?: ParkPr } = {},
  ): Promise<void> {
    const thread = u.session?.thread_id ?? o.thread; // endSession deletes the session; a caller that ended it first passes it
    await this.endSession(u, o);
    const at = this.nowIso();
    u.parked = { reason, at };
    this.save();
    this.ev("park", {
      unit: u.id, stage: u.stage, reason,
      ...(thread ? { thread } : {}),
      ...(o.questions ? { questions: JSON.stringify(o.questions) } : {}),
      ...(o.pr ? { pr: o.pr.url, pr_state: o.pr.why, ...(o.pr.failing ? { failing: o.pr.failing } : {}) } : {}),
    });
    this.report.parked.push(u.id);
    // With a driver, step 7 settles the park: only its escalate or stop reaches the operator.
    if (this.recipe.driver) return;
    await this.notify(`${this.run.id}/${u.id}/park/${at}`, `baton ${this.run.id}/${u.id} parked in ${u.stage}: ${reason}${prSuffix(o.pr)}`);
  }

  /** `note` is the outcome's notice, rendered by the caller before any side effect. */
  private async move(u: UnitState, o: Outcome, note?: string, thread?: string, pr?: ParkPr): Promise<void> {
    if (o.to === "park") return this.park(u, "outcome", { thread, pr });
    const from = u.stage;
    enterStage(u, o.to, triageNote(this.run, this.recipe, u));
    this.entered.add(u.id);
    this.save();
    this.ev("transition", { unit: u.id, from, to: o.to });
    this.report.transitioned.push(u.id);
    if (note !== undefined) await this.notify(`${this.run.id}/${u.id}/${o.to}/${this.nowIso()}`, note);
  }

  /** Run hook argvs in order with no shell; false at the first non-zero. */
  private hooks(list: string[][] | undefined, scope: Scope, cwd: string): boolean {
    for (const argv of list ?? []) {
      const rendered = argv.map((a) => render(a, scope));
      const rc = runArgv(rendered, cwd, HOOK_TIMEOUT_MS);
      if (rc !== 0) {
        this.ev("hook failed", { unit: scope.unit.id, argv: rendered, rc });
        return false;
      }
    }
    return true;
  }

  private existingDir(...dirs: (string | undefined)[]): string {
    for (const d of dirs) if (d !== undefined && existsSync(d)) return d;
    return this.run.dir;
  }

  /**
   * The first outcome whose signals all read true, with the scope they were read with (a `pr`
   * signal sets `pr` on it); "pending" when an undecided one comes first.
   */
  private async firstOutcome(u: UnitState, outcomes: Outcome[], cwd: string): Promise<{ o: Outcome; scope: Scope } | "pending" | null> {
    for (const o of outcomes) {
      // Each outcome reads on its own scope: a `pr` set by an outcome that did not match never
      // reaches another outcome's signals, hooks or notice.
      const ctx: EvalCtx = {
        run: this.run, unit: u, scope: this.scope(u), cwd, forge: this.opts.forge, prViews: this.prViews,
      };
      let pending = false;
      let matched = true;
      for (const sig of o.when) {
        const v = await evaluate(sig, ctx);
        if (v === "false") { matched = false; break; }
        if (v === "pending") pending = true;
      }
      if (!matched) continue;
      return pending ? "pending" : { o, scope: ctx.scope };
    }
    return null;
  }

  private async takeOutcome(u: UnitState, m: { o: Outcome; scope: Scope }, hookCwd: string): Promise<void> {
    // Rendered before any side effect: a notice that cannot render parks the unit with no hook
    // run, its session still in place for the park to end, and no move.
    const note = m.o.notify === undefined ? undefined : render(m.o.notify, m.scope);
    if (!this.hooks(m.o.run, m.scope, hookCwd)) return this.park(u, "run failed");
    const thread = u.session?.thread_id; // endSession deletes the session; a park by outcome still records it
    await this.endSession(u);
    await this.move(u, m.o, note, thread);
  }

  /** Per-unit guard: a host error stops the tick; anything else parks only this unit. */
  private async guard(u: UnitState, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      if (isHostError(e)) throw e;
      if (e instanceof ForgeReadError) {
        // Transient until proven otherwise: wait, and park only at the third in a row.
        u.forge_failures = (u.forge_failures ?? 0) + 1;
        this.ev("forge read failed", { unit: u.id, what: e.what, failures: u.forge_failures, reason: e.message });
        this.save();
        if (u.forge_failures >= FORGE_FAILURES_TO_PARK) await this.park(u, e.what);
        return;
      }
      if (e instanceof PrUrlError) {
        this.ev("pr url", { unit: u.id, reason: e.message });
        await this.park(u, "pr url");
        return;
      }
      if (e instanceof Exit0Error) {
        this.ev("exit0 error", { unit: u.id, reason: e.message });
        await this.park(u, "exit0 error");
        return;
      }
      this.report.errors.push(`${this.run.id}/${u.id}: ${message(e)}`);
      await this.park(u, `error: ${message(e)}`);
    }
  }

  // ---- the tick ---------------------------------------------------------------------------

  async tick(): Promise<void> {
    try {
      await this.orphans();
      if (!(await this.sources())) return;
      await this.stops();
      await this.live();
      await this.waits();
      await this.merges();
      await this.launches();
      await this.drivers();
      await this.done();
    } finally {
      // Whatever ran stays recorded, including on a host error mid-tick.
      this.save();
    }
  }

  /** Step 0: a session with no thread id is live; find its thread by nonce. */
  private async orphans(): Promise<void> {
    for (const u of this.ordered()) {
      const s = u.session;
      if (!s || s.thread_id || u.parked) continue;
      await this.guard(u, async () => {
        const { stage, scope } = this.ctx(u);
        if (stage.kind !== "session") throw new Error(`session in non-session stage ${u.stage}`);
        const ids = await this.host.findByNonce(this.launchedWith(stage, scope, s).project, s.nonce);
        if (ids.length === 1) {
          s.thread_id = ids[0];
          this.counted(u, s);
          this.ev("adopted", { unit: u.id, nonce: s.nonce, thread: ids[0] });
          this.save();
        } else if (ids.length >= 2) {
          // Two threads may be live in the directory: remove the claim, keep the directory.
          this.ev("ambiguous nonce", { unit: u.id, nonce: s.nonce, threads: ids, dir: s.launch_dir });
          await this.park(u, "ambiguous nonce", { release: false });
        } else if (this.nowMs() - Date.parse(s.launched_at) > ORPHAN_MS) {
          // No thread for the nonce: the launch went nowhere. It counts one attempt, so a launch
          // whose outcome is always unknown reaches max_launches and parks `cap` with a notice.
          this.ev("orphan", { unit: u.id, nonce: s.nonce });
          u.launches[u.stage] = (own(u.launches, u.stage) ?? 0) + 1; // the dropped attempt counts
          this.ev("launch unknown", { unit: u.id, nonce: s.nonce, launches: own(u.launches, u.stage) });
          await this.endSession(u);
        }
      });
    }
    // A triage launch whose outcome was unknown, found the same way; none found, it has ended.
    for (const u of this.ordered()) {
      const t = u.triage;
      if (!t || t.session.thread_id || t.lost || u.parked) continue;
      await this.guard(u, async () => {
        const ts = t.session;
        const ids = await this.host.findByNonce(ts.project!, ts.nonce);
        if (ids.length === 1) {
          ts.thread_id = ids[0];
          this.ev("adopted", { unit: u.id, nonce: ts.nonce, thread: ids[0] });
          this.save();
        } else if (ids.length >= 2) {
          this.ev("ambiguous nonce", { unit: u.id, nonce: ts.nonce, threads: ids, dir: ts.launch_dir });
          await this.endTriage(u, { release: false });
          await this.park(u, "ambiguous nonce", { interrupt: "stop" });
        } else if (this.nowMs() - Date.parse(ts.launched_at) > ORPHAN_MS) {
          this.ev("orphan", { unit: u.id, nonce: ts.nonce });
          t.lost = true;
          this.save();
        }
      });
    }
    // A driver launch whose outcome was unknown, the same way; none found, it has ended (step 7).
    for (const u of this.ordered()) {
      const d = u.driver;
      if (!d || d.session.thread_id || d.lost || !u.parked) continue;
      await this.guard(u, async () => {
        const ds = d.session;
        const ids = await this.host.findByNonce(ds.project!, ds.nonce);
        if (ids.length === 1) {
          ds.thread_id = ids[0];
          this.ev("adopted", { unit: u.id, nonce: ds.nonce, thread: ids[0] });
          this.save();
        } else if (ids.length >= 2) {
          // Two threads may be live in the directory: remove the claim, keep the directory.
          this.ev("ambiguous nonce", { unit: u.id, nonce: ds.nonce, threads: ids, dir: ds.launch_dir });
          await this.endDriver(u, { release: false });
          await this.escalate(u, "driver could not launch: ambiguous nonce");
        } else if (this.nowMs() - Date.parse(ds.launched_at) > ORPHAN_MS) {
          this.ev("orphan", { unit: u.id, nonce: ds.nonce });
          d.lost = true;
          this.save();
        }
      });
    }
  }

  /**
   * A fresh nonce `<run>/<unit>/<stage>/<seq>`. The sequence advances on every nonce minted
   * and is never reset, so no relaunch reuses a nonce or the per-launch directory named after it.
   */
  private mint(u: UnitState): string {
    u.seq ??= {};
    const n = Math.max(own(u.seq, u.stage) ?? 0, own(u.launches, u.stage) ?? 0) + 1;
    u.seq[u.stage] = n;
    return launchNonce(this.run.id, u.id, u.stage, n);
  }

  /** A launch that now has its thread: a counted launch, or a successor (not counted). */
  private counted(u: UnitState, s: Session): void {
    if (s.successor_of) {
      this.ev("successor", { unit: u.id, nonce: s.nonce, of: s.successor_of, thread: s.thread_id });
      return;
    }
    u.launches[u.stage] = (own(u.launches, u.stage) ?? 0) + 1;
    this.ev("launched", { unit: u.id, nonce: s.nonce, thread: s.thread_id });
    this.report.launched.push(u.id);
  }

  /** Step 1: request records. Any bad record parks the run before a unit is touched. */
  private async sources(): Promise<boolean> {
    type Rec = { file: string; id: string; group: number; order: number; vars: Record<string, string>; digest: string; stage: string };
    const recs: Rec[] = [];
    const seen = new Set<string>();
    const base: Scope = {
      param: this.run.params, unit: { id: "", group: "", order: 0, vars: {} },
      run: { id: this.run.id, dir: this.run.dir, group: String(this.group()) }, attempt: 0,
    };
    for (const src of this.recipe.sources ?? []) {
      const dir = render(src.dir, base);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
        const bytes = readFileSync(join(dir, file));
        let raw: unknown;
        try {
          raw = JSON.parse(bytes.toString("utf8"));
        } catch {
          raw = undefined;
        }
        const r = raw as Record<string, unknown> | undefined;
        const ok = r !== null && typeof r === "object" && !Array.isArray(r)
          && typeof r[src.id_key] === "string" && UNIT_ID_RE.test(r[src.id_key] as string)
          && typeof r[src.group_key] === "number" && Number.isFinite(r[src.group_key])
          && typeof r[src.order_key] === "number" && Number.isFinite(r[src.order_key])
          && !isProtoName(r[src.id_key] as string) && !seen.has(r[src.id_key] as string);
        if (!ok) return this.parkRun(`invalid record ${file}`);
        const id = r![src.id_key] as string;
        seen.add(id);
        const vars: Record<string, string> = Object.create(null);
        for (const [name, key] of Object.entries(src.vars)) {
          const v = own(r!, key);
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") vars[name] = String(v);
        }
        recs.push({
          file, id, group: r![src.group_key] as number, order: r![src.order_key] as number, vars,
          digest: createHash("sha256").update(bytes).digest("hex"), stage: src.stage,
        });
      }
    }
    for (const rec of recs) {
      const known = own(this.run.units, rec.id);
      if (known) {
        known.record_seen = rec.digest;
        // vars follow the record on every read (a rewrite is how the planner answers a gap);
        // group and order stay as first seen, because merge order and group counts key on them.
        known.vars = rec.vars;
        continue;
      }
      this.run.units[rec.id] = {
        id: rec.id, group: rec.group, order: rec.order, vars: rec.vars, stage: rec.stage,
        record_seen: rec.digest, record_at_entry: rec.digest, launches: {}, stalls: 0,
      };
      this.ev("unit", { unit: rec.id, stage: rec.stage, file: rec.file });
    }
    this.save();
    return true;
  }

  private async parkRun(reason: string): Promise<false> {
    if (this.run.status === "parked" && this.run.parked?.reason === reason) return false;
    const at = this.nowIso();
    this.run.status = "parked";
    this.run.parked = { reason, at };
    this.save();
    this.ev("park", { reason });
    await this.notify(`${this.run.id}/run/park/${at}`, `baton ${this.run.id} parked: ${reason}`);
    return false;
  }

  /** Step 2: a stop file parks its unit, interrupting a thread still at work. */
  private async stops(): Promise<void> {
    for (const u of this.ordered()) {
      const { stage, scope } = this.ctx(u);
      if (u.parked || stage?.kind !== "session" || stage.stop_file === undefined) continue;
      await this.guard(u, async () => {
        if (!existsSync(render(stage.stop_file!, scope))) return;
        let interrupt: string | undefined;
        if (u.session?.thread_id) {
          const st = await this.host.status(u.session.thread_id);
          if (st.state === "active" || st.state === "waiting") interrupt = "stop";
        }
        await this.park(u, "stop", { interrupt });
      });
    }
  }

  /** The newest mtime over the stage's watch and done-file paths, plus the thread's activity. */
  private progressMark(stage: SessionStage, scope: Scope, activity: string): string {
    const paths: string[] = [];
    const add = (tpl: string) => {
      try {
        paths.push(render(tpl, scope));
      } catch { /* a path that cannot render yet has no mtime */ }
    };
    for (const w of stage.watch ?? []) add(w);
    for (const o of stage.outcomes) for (const s of o.when) if ("file" in s) add(s.file);
    let newest = 0;
    let budget = WALK_LIMIT;
    const walk = (p: string) => {
      if (budget-- <= 0) return;
      let st;
      try {
        st = statSync(p);
      } catch {
        return;
      }
      if (st.mtimeMs > newest) newest = st.mtimeMs;
      if (st.isDirectory()) {
        let names: string[] = [];
        try {
          names = readdirSync(p);
        } catch { /* unreadable: its own mtime is all we have */ }
        for (const n of names) walk(join(p, n));
      }
    };
    for (const p of paths) walk(p);
    return `${newest}|${activity}`;
  }

  /** Step 3: every session with a thread id. */
  private async live(): Promise<void> {
    for (const u of this.ordered()) {
      const s = u.session;
      if (!s?.thread_id || u.parked) continue;
      await this.guard(u, async () => {
        const { stage, scope } = this.ctx(u);
        if (stage.kind !== "session") throw new Error(`session in non-session stage ${u.stage}`);
        const st = await this.host.status(s.thread_id!);
        const mark = this.progressMark(stage, scope, st.activity);
        if (mark !== s.progress_mark) {
          s.progress_mark = mark;
          s.last_progress_at = this.nowIso();
        }
        if (await this.prompt(u, s, st)) return;
        const idle = this.nowMs() - Date.parse(s.last_progress_at);
        const max = stage.max_launches ?? DEFAULT_MAX_LAUNCHES;
        const launches = own(u.launches, u.stage) ?? 0;
        if (st.state === "active" || st.state === "waiting") {
          if (idle >= (stage.stall_minutes ?? DEFAULT_STALL_MINUTES) * MIN) await this.stall(u, s);
          return;
        }
        if (st.state === "failed" || st.state === "gone") {
          this.ev(`thread ${st.state}`, { unit: u.id, nonce: s.nonce });
          if (launches >= max) await this.park(u, `thread ${st.state}`);
          else await this.endSession(u);
          return;
        }
        // completed or interrupted: outcomes, then the quiet window; an interrupt never drops at once
        const launchedCwd = this.launchedWith(stage, scope, s).cwd;
        const o = await this.firstOutcome(u, stage.outcomes, this.existingDir(launchedCwd));
        if (o === "pending") return;
        if (o) return this.takeOutcome(u, o, this.existingDir(s.launch_dir, launchedCwd));
        const handoff = this.handoffPath(stage, scope, s);
        if (handoff !== null) return this.successor(u, stage, s, handoff);
        u.quiet_since ??= this.nowIso();
        if (idle >= (stage.settle_minutes ?? DEFAULT_SETTLE_MINUTES) * MIN) {
          this.ev("no-result", { unit: u.id, nonce: s.nonce });
          if (launches >= max) await this.park(u, "no result");
          else await this.endSession(u);
        }
      });
      this.save();
    }
  }

  /** `kind` names the event: a triage that asks for a relaunch logs `triage relaunch`. */
  private async stall(u: UnitState, s: Session, kind = "stall"): Promise<void> {
    await this.host.interrupt(s.thread_id!, "stalled");
    u.stalls += 1;
    this.ev(kind, { unit: u.id, nonce: s.nonce, stalls: u.stalls });
    if (u.stalls >= STALLS_TO_PARK) return this.park(u, "stalled");
    await this.endSession(u);
    this.held.add(u.id); // a stalled unit relaunches next tick
  }

  // ---- triage -----------------------------------------------------------------------------

  /** Hold the unit's stall clock: its idle time starts again from now. */
  private pause(s: Session): void {
    s.last_progress_at = this.nowIso();
    this.save();
  }

  /**
   * The decision procedure (A-D) for a session's pending request. True when it acted on the
   * unit; false sends the session on along the ordinary path, where its stall clock runs.
   */
  private async prompt(u: UnitState, s: Session, st: ThreadStatus): Promise<boolean> {
    // A request is live only while its thread is at work: one read on an ended thread is stale.
    const p = atWork(st) ? st.pending : undefined;
    const triage = this.recipe.triage;
    const seen = u.triaged ?? [];
    if (!triage) {
      // A: no triage stage. Each request is logged once; nothing else changes.
      if (p && !seen.includes(p.id)) {
        u.triaged = [...seen, p.id];
        this.save();
        this.ev("pending", { unit: u.id, nonce: s.nonce, request: p.id });
      }
      return false;
    }
    const t = u.triage;
    if (t) {
      // B: a triage is out for this unit.
      if (!(await this.triageEnded(t, triage))) {
        if (p?.id === t.request_id) {
          this.pause(s);
          return true;
        }
        if (p) {
          await this.park(u, "second prompt", { interrupt: "stop", questions: p.questions });
          return true;
        }
        return false; // the answer landed; the triage's end names the event
      }
      // Ended: acted on exactly once, then cleared.
      const noted = p?.id === t.request_id && existsSync(render(triage.note_file, this.scope(u)));
      await this.endTriage(u);
      if (p?.id === t.request_id) {
        if (noted) await this.stall(u, s, "triage relaunch");
        else await this.park(u, "triage gave no answer", { interrupt: "stop", questions: p.questions });
        return true;
      }
      if (!p) {
        this.ev("triage answered", { unit: u.id, nonce: t.session.nonce, request: t.request_id });
        return false;
      }
      await this.park(u, "second prompt", { interrupt: "stop", questions: p.questions });
      return true;
    }
    // C: a request and no triage out. D: no request.
    if (!p || seen.includes(p.id)) return false;
    if (seen.length > 0) {
      await this.park(u, "second prompt", { interrupt: "stop", questions: p.questions });
      return true;
    }
    await this.launchTriage(u, s, p, triage);
    if (!u.triage) return false; // refused: the stall clock runs
    this.pause(s);
    return true;
  }

  /** Has the triage ended? One past its time limit is interrupted and has. */
  private async triageEnded(t: NonNullable<UnitState["triage"]>, triage: TriageStage): Promise<boolean> {
    if (t.lost) return true;
    const id = t.session.thread_id;
    if (!id) return false; // step 0 is still looking for it by nonce
    if (!atWork(await this.host.status(id))) return true;
    const limit = (triage.stall_minutes ?? DEFAULT_TRIAGE_STALL_MINUTES) * MIN;
    if (this.nowMs() - Date.parse(t.session.launched_at) < limit) return false;
    await this.host.interrupt(id, "stalled");
    return true;
  }

  /**
   * Clear the unit's triage: remove its claim and release its directory. With `interrupt`, a
   * triage thread still at work is interrupted first (`triage dropped`).
   */
  private async endTriage(u: UnitState, o: { interrupt?: boolean; release?: boolean } = {}): Promise<void> {
    const t = u.triage;
    if (!t) return;
    const ts = t.session;
    if (o.interrupt && ts.thread_id && !t.lost && atWork(await this.host.status(ts.thread_id))) {
      await this.host.interrupt(ts.thread_id, "stop");
      this.ev("triage dropped", { unit: u.id, nonce: ts.nonce, request: t.request_id });
    }
    removeClaim(ts.claim_key, ts.claim_nonce);
    if (o.release !== false) await this.releaseDir(u, ts.launch_dir, () => ({ project: ts.project!, cwd: ts.cwd! }));
    delete u.triage;
    this.save();
  }

  /**
   * Launch the one triage of this stage visit for request `p`, stored in `u.triage`, never
   * `u.session`. The request id is recorded before anything is launched. The triage stage's
   * stop_file, watch, before and after_launch are not used.
   */
  private async launchTriage(u: UnitState, stuck: Session, p: PendingRequest, triage: TriageStage): Promise<void> {
    const scope = this.scope(u, {
      pending: { thread: stuck.thread_id!, request: p.id, questions: JSON.stringify(p.questions), stage: u.stage },
    });
    // Every field renders before any side effect.
    const project = render(triage.project, scope);
    const cwd = render(triage.cwd, scope);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(triage.env)) env[k] = render(v, scope);
    const title = render(triage.title, scope);
    const instance = render(triage.instance, scope);
    const model = render(triage.model, scope);
    const text = render(triage.message, scope);
    const note = render(triage.note_file, this.scope(u));

    u.triaged = [...(u.triaged ?? []), p.id];
    this.save();
    removeFile(note);
    const seqBefore = own(u.seq, TRIAGE);
    u.seq ??= {};
    const n = (seqBefore ?? 0) + 1;
    u.seq[TRIAGE] = n;
    const nn = launchNonce(this.run.id, u.id, TRIAGE, n);
    let dir: string;
    try {
      dir = await this.host.bind(project, cwd, nn, triage.launch_dir ?? DEFAULT_LAUNCH_DIR);
    } catch (e) {
      if (isHostError(e)) {
        // The host was not reached and made no directory: unmark, so a later tick triages.
        u.triaged = u.triaged.filter((id) => id !== p.id);
        if (u.triaged.length === 0) delete u.triaged;
        if (seqBefore === undefined) delete u.seq[TRIAGE];
        else u.seq[TRIAGE] = seqBefore;
        if (Object.keys(u.seq).length === 0) delete u.seq;
        throw e;
      }
      return this.triageRefused(u, nn, `bind: ${message(e)}`);
    }
    let key: string;
    try {
      key = writeClaim(dir, env, nn);
    } catch (e) {
      if (dir !== cwd) await this.releaseDir(u, dir, () => ({ project, cwd }));
      return this.triageRefused(u, nn, `claim: ${message(e)}`);
    }
    const now = this.nowIso();
    const ts: Session = {
      nonce: nn, claim_nonce: nn, launch_dir: dir, claim_key: key, project, cwd,
      launched_at: now, last_progress_at: now, progress_mark: "",
    };
    u.triage = { request_id: p.id, session: ts };
    this.save();
    this.ev("triage", { unit: u.id, nonce: nn, request: p.id });
    const req: LaunchRequest = { nonce: nn, title: threadTitle(title, nn), project, instance, model, cwd: dir, message: text };
    try {
      ts.thread_id = (await this.host.launch(req)).threadId;
    } catch (e) {
      if (isHostError(e)) throw e;
      if (e instanceof LaunchError) {
        await this.endTriage(u);
        return this.triageRefused(u, nn, e.message);
      }
      // Unknown: the launch may have reached the host. Step 0 looks for it by nonce.
      this.report.errors.push(`${this.run.id}/${u.id}: triage launch outcome unknown: ${message(e)}`);
      this.ev("launch unknown", { unit: u.id, nonce: nn, reason: message(e) });
      return;
    }
    this.save();
  }

  /** A triage the host refused: the request stays recorded, and the session's stall clock runs. */
  private triageRefused(u: UnitState, nonce: string, reason: string): void {
    this.ev("launch failed", { unit: u.id, nonce, reason });
    this.save();
  }

  /** The handoff path when the stage's handoff file ends in a `<stamp> <token> <path>` line newer than this launch. */
  private handoffPath(stage: SessionStage, scope: Scope, s: Session): string | null {
    if (!stage.handoff) return null;
    let text: string;
    try {
      text = readFileSync(render(stage.handoff.file, scope), "utf8");
    } catch {
      return null;
    }
    const last = text.split("\n").filter((l) => l.trim() !== "").pop();
    const m = last === undefined ? null : /^(\S+) (\S+) (.+)$/.exec(last);
    if (!m || m[2] !== render(stage.handoff.token, scope)) return null;
    const stamp = Date.parse(m[1]);
    if (Number.isNaN(stamp)) return null;
    return stamp > Date.parse(s.launched_at) ? m[3].trim() : null;
  }

  private async successor(u: UnitState, stage: SessionStage, old: Session, path: string): Promise<void> {
    await this.endTriage(u, { interrupt: true });
    const n = this.mint(u);
    const scope = this.scope(u, { handoff_path: path });
    const req: LaunchRequest = {
      nonce: n,
      title: threadTitle(render(stage.title, scope), n),
      project: this.launchedWith(stage, scope, old).project,
      instance: render(stage.instance, scope),
      model: render(stage.model, scope),
      cwd: old.launch_dir,
      message: render(stage.handoff!.message, scope),
    };
    const now = this.nowIso();
    const s: Session = {
      nonce: n, claim_nonce: old.claim_nonce, launch_dir: old.launch_dir, claim_key: old.claim_key,
      ...this.launchedWith(stage, scope, old), vars: old.vars,
      launched_at: now, last_progress_at: now, progress_mark: this.progressMark(stage, scope, ""), successor_of: old.nonce,
    };
    delete u.quiet_since;
    await this.start(u, s, req);
  }

  /**
   * Record the session, then launch. The session is written, with no thread id, before the
   * host is called: a lost response is found again by nonce in step 0.
   */
  private async start(u: UnitState, s: Session, req: LaunchRequest): Promise<boolean> {
    let threadId: string;
    try {
      this.begin(u, s); threadId = (await this.host.launch(req)).threadId;
    } catch (e) {
      if (isHostError(e)) throw e;
      if (e instanceof LaunchError) {
        await this.launchFailed(u, e.message, { key: s.claim_key, nonce: s.claim_nonce, dir: s.launch_dir, session: s });
        return false;
      }
      // Unknown: the launch may have reached the host. Keep the session for step 0.
      this.report.errors.push(`${this.run.id}/${u.id}: launch outcome unknown: ${message(e)}`);
      this.ev("launch unknown", { unit: u.id, nonce: s.nonce, reason: message(e) });
      return false;
    }
    u.session!.thread_id = threadId;
    this.counted(u, u.session!);
    this.save();
    return true;
  }

  private begin(u: UnitState, s: Session): void {
    u.session = s;
    this.ev("launching", { unit: u.id, nonce: s.nonce, dir: s.launch_dir });
    this.save();
  }

  /** A launch the host refused: claim and directory go, the attempt counts. */
  private async launchFailed(u: UnitState, reason: string, c: { key?: string; nonce?: string; dir?: string; session?: Session }): Promise<void> {
    const { stage, scope } = this.ctx(u);
    if (c.key && c.nonce) removeClaim(c.key, c.nonce);
    if (c.dir !== undefined && stage.kind === "session") await this.release(u, stage, scope, c.dir, c.session);
    delete u.session;
    u.launches[u.stage] = (own(u.launches, u.stage) ?? 0) + 1; // the refused attempt counts
    this.ev("launch failed", { unit: u.id, reason });
    this.save();
    if ((own(u.launches, u.stage) ?? 0) >= ((stage as SessionStage).max_launches ?? DEFAULT_MAX_LAUNCHES)) {
      await this.park(u, "launch failed");
    } else {
      this.held.add(u.id); // a refused launch relaunches next tick
    }
  }

  /** Step 4: wait stages move on their first matching outcome. */
  private async waits(): Promise<void> {
    for (const u of this.ordered()) {
      const stage = own(this.recipe.stages, u.stage);
      if (u.parked || stage?.kind !== "wait" || this.entered.has(u.id)) continue;
      await this.guard(u, async () => {
        const o = await this.firstOutcome(u, (stage as WaitStage).outcomes, this.run.dir);
        if (o && o !== "pending") await this.takeOutcome(u, o, this.run.dir);
      });
    }
  }

  /** Step 5: merge stages, decided by the recipe's rule in merge.ts. */
  private async merges(): Promise<void> {
    for (const u of this.ordered()) {
      const stage = own(this.recipe.stages, u.stage);
      if (u.parked || stage?.kind !== "merge" || this.entered.has(u.id)) continue;
      await this.guard(u, () => mergeUnit({
        run: this.run, forge: this.opts.forge, prViews: this.prViews,
        scope: (x, extra) => this.scope(x, extra),
        ev: (k, o) => this.ev(k, o),
        park: (x, reason) => this.park(x, reason),
        move: (x, to, pr) => this.move(x, { when: [], to }, undefined, undefined, pr),
        hooks: (list, scope, cwd) => this.hooks(list, scope, cwd),
        save: () => this.save(),
        merged: (x) => { this.report.merged.push(x.id); },
      }, u, stage));
    }
  }

  /** The nonce of a live claim on `cwd`, or null; a directory that does not exist yet holds none. */
  private cwdHolder(cwd: string): string | null {
    let key: string;
    try {
      key = claimKey(cwd);
    } catch {
      return null;
    }
    return liveClaim(key);
  }

  private slotsFree(stage: SessionStage): boolean {
    const caps: Record<string, number> = { ...DEFAULT_SLOTS, ...(this.recipe.slots ?? {}), ...(this.config.slots ?? {}) };
    for (const slot of stage.slots ?? DEFAULT_STAGE_SLOTS) {
      const cap = caps[slot];
      if (cap === undefined) continue;
      const live = this.all.reduce((n, rt) => n + rt.liveIn(slot), 0);
      if (live >= cap) return false;
    }
    return true;
  }

  /** Step 6: launches due, in unit order. */
  private async launches(): Promise<void> {
    if (this.run.status !== "armed") return;
    for (const u of this.ordered()) {
      const stage = own(this.recipe.stages, u.stage);
      if (u.session || u.parked || this.held.has(u.id) || stage?.kind !== "session") continue;
      await this.guard(u, () => this.launch(u, stage));
    }
  }

  private async launch(u: UnitState, stage: SessionStage): Promise<void> {
    const attempt = (own(u.launches, u.stage) ?? 0) + 1;
    const scope = this.scope(u, { attempt });
    const cwd = render(stage.cwd, scope);
    const project = render(stage.project, scope);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(stage.env)) env[k] = render(v, scope);
    // Every request field renders before any side effect: a render failure parks with nothing
    // bound and no claim written.
    const title = render(stage.title, scope);
    const instance = render(stage.instance, scope);
    const model = render(stage.model, scope);
    const text = render(stage.message, scope);

    const holder = this.cwdHolder(cwd);
    if (holder !== null) {
      if (u.cwd_busy !== holder) {
        u.cwd_busy = holder;
        this.ev("cwd busy", { unit: u.id, cwd, holder });
        this.save();
      }
      return;
    }
    if (!this.slotsFree(stage)) return;
    delete u.cwd_busy;
    if ((own(u.launches, u.stage) ?? 0) >= (stage.max_launches ?? DEFAULT_MAX_LAUNCHES)) return this.park(u, "cap");
    if (!this.hooks(stage.before, scope, this.existingDir(cwd))) return this.park(u, "before failed");

    const seqBefore = own(u.seq, u.stage);
    const nn = this.mint(u);
    let dir: string;
    try {
      dir = await this.host.bind(project, cwd, nn, stage.launch_dir ?? DEFAULT_LAUNCH_DIR);
    } catch (e) {
      if (isHostError(e)) {
        // The host was not reached for this nonce and made no directory: nothing is marked.
        if (seqBefore === undefined) delete u.seq![u.stage];
        else u.seq![u.stage] = seqBefore;
        if (Object.keys(u.seq!).length === 0) delete u.seq;
        throw e;
      }
      return this.launchFailed(u, `bind: ${message(e)}`, {});
    }
    let key: string;
    try {
      key = writeClaim(dir, env, nn);
    } catch (e) {
      if (e instanceof ClaimBusy) {
        if (dir !== cwd) await this.release(u, stage, scope, dir);
        this.ev("cwd busy", { unit: u.id, cwd: dir, holder: message(e) });
        return;
      }
      return this.launchFailed(u, `claim: ${message(e)}`, { dir: dir !== cwd ? dir : undefined });
    }
    const now = this.nowIso();
    const s: Session = {
      nonce: nn, claim_nonce: nn, launch_dir: dir, claim_key: key, project, cwd,
      vars: Object.assign(Object.create(null), u.vars),
      launched_at: now, last_progress_at: now, progress_mark: this.progressMark(stage, scope, ""),
    };
    const req: LaunchRequest = {
      nonce: nn,
      title: threadTitle(title, nn),
      project,
      instance,
      model,
      cwd: dir,
      message: text,
    };
    if (!(await this.start(u, s, req))) return;
    if (!this.hooks(stage.after_launch, scope, this.existingDir(dir))) {
      await this.park(u, "after_launch failed", { interrupt: "after_launch failed" });
    }
  }

  // ---- drivers ----------------------------------------------------------------------------

  /** Step 7: each parked unit not yet sent to the operator gets one driver, then its result. */
  private async drivers(): Promise<void> {
    const drv = this.recipe.driver;
    if (!drv) return;
    for (const u of this.ordered()) {
      // Checked per unit: a driver's stop parks the run partway through this loop.
      if (this.run.status !== "armed" || !u.parked || u.parked.escalated) continue;
      await this.guard(u, async () => {
        try {
          if (u.driver) await this.driverResult(u, drv);
          else await this.driverFor(u, drv);
        } catch (e) {
          // A refusal of any kind goes to the operator; a guard park here would relaunch forever.
          if (isHostError(e) || !u.parked) throw e;
          this.report.errors.push(`${this.run.id}/${u.id}: driver: ${message(e)}`);
          await this.endDriver(u);
          await this.escalate(u, `driver failed: ${message(e)}`);
        }
      });
    }
  }

  /** A park with no driver yet: launch one, unless a driver already resumed this same park once. */
  private async driverFor(u: UnitState, drv: DriverStage): Promise<void> {
    const key = `${u.stage}/${u.parked!.reason}`;
    if ((u.drivers ?? []).includes(key)) return this.escalate(u, "parked again after a driver resumed it once");
    await this.launchDriver(u, drv, key);
  }

  /** A driver is out: wait until it ends, then act on its result exactly once. */
  private async driverResult(u: UnitState, drv: DriverStage): Promise<void> {
    const d = u.driver!;
    if (!(await this.driverEnded(u, d, drv))) return;
    const scope = this.scope(u);
    const res = readDriverResult(render(drv.result_file, scope), drv, u.stage);
    await this.endDriver(u);
    if ("invalid" in res) return this.escalate(u, `driver gave no valid result (${res.invalid})`);
    const path = render(drv.ledger, scope);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, ledgerLine(this.nowIso(), u.id, res.ledger));
    if (res.result === "escalate") return this.escalate(u, res.action);
    if (res.result === "stop") {
      u.parked!.escalated = true;
      this.save();
      this.ev("driver stop", { unit: u.id, reason: res.reason });
      await this.parkRun(`driver stop: ${res.reason}`);
      return;
    }
    const from = u.stage;
    const { stage } = unparkUnit(this.run, this.recipe, u, res.to, this.nowIso());
    u.drivers = [...(u.drivers ?? []), d.key];
    if (res.to !== undefined) {
      this.entered.add(u.id);
      this.report.transitioned.push(u.id);
    }
    this.save();
    this.ev("driver resume", { unit: u.id, from, to: stage, cleared: res.cleared });
  }

  /** Has the driver ended? One past its time limit is interrupted (`driver dropped`) and has. */
  private async driverEnded(u: UnitState, d: NonNullable<UnitState["driver"]>, drv: DriverStage): Promise<boolean> {
    if (d.lost) return true;
    const id = d.session.thread_id;
    if (!id) return false; // step 0 is still looking for it by nonce
    if (!atWork(await this.host.status(id))) return true;
    const limit = (drv.stall_minutes ?? DEFAULT_DRIVER_STALL_MINUTES) * MIN;
    if (this.nowMs() - Date.parse(d.session.launched_at) < limit) return false;
    await this.host.interrupt(id, "stalled");
    this.ev("driver dropped", { unit: u.id, nonce: d.session.nonce });
    return true;
  }

  /** Clear the unit's driver: remove its claim and release its directory. */
  private async endDriver(u: UnitState, o: { release?: boolean } = {}): Promise<void> {
    const d = u.driver;
    if (!d) return;
    const ds = d.session;
    removeClaim(ds.claim_key, ds.claim_nonce);
    delete u.driver;
    this.save();
    if (o.release !== false) await this.releaseDir(u, ds.launch_dir, () => ({ project: ds.project!, cwd: ds.cwd! }));
  }

  /** Send the park to the operator with one action; no driver runs for it after this. */
  private async escalate(u: UnitState, action: string): Promise<void> {
    const p = u.parked!;
    p.escalated = true;
    this.save();
    this.ev("driver escalate", { unit: u.id, stage: u.stage, reason: p.reason, action });
    await this.notify(`${this.run.id}/${u.id}/park/${p.at}`,
      `baton ${this.run.id}/${u.id} parked in ${u.stage}: ${p.reason} — ${action}${prSuffix(this.parkPr(u))}`);
  }

  /** The PR detail the unit's latest park event recorded, as park() was given it; undefined without one. */
  private parkPr(u: UnitState): ParkPr | undefined {
    let text = "";
    try {
      text = readFileSync(join(this.run.dir, "events.jsonl"), "utf8");
    } catch {
      return undefined;
    }
    let last: Record<string, unknown> | undefined;
    for (const line of text.split("\n")) {
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        if (e !== null && typeof e === "object" && e.kind === "park" && e.unit === u.id) last = e;
      } catch { /* a blank or torn line is not an event */ }
    }
    if (!last || typeof last.pr !== "string" || (last.pr_state !== "red" && last.pr_state !== "conflict")) return undefined;
    const failing = Array.isArray(last.failing) && last.failing.every((f) => typeof f === "string") ? last.failing as string[] : undefined;
    return { url: last.pr, why: last.pr_state, ...(failing ? { failing } : {}) };
  }

  /**
   * Launch the park's driver, stored in `u.driver`, never `u.session`: it takes no slot. The state
   * file is written and any old result file removed before anything is launched.
   */
  private async launchDriver(u: UnitState, drv: DriverStage, key: string): Promise<void> {
    const plain = this.scope(u);
    const scope = this.scope(u, { driver: { reason: u.parked!.reason, stage: u.stage } });
    let f: { project: string; cwd: string; env: Record<string, string>; title: string; instance: string; model: string;
      text: string; stateFile: string; resultFile: string; ledger: string; stopFile?: string };
    try {
      // Every field renders before any side effect.
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(drv.env)) env[k] = render(v, scope);
      f = {
        project: render(drv.project, scope), cwd: render(drv.cwd, scope), env,
        title: render(drv.title, scope), instance: render(drv.instance, scope), model: render(drv.model, scope),
        text: render(drv.message, scope), stateFile: render(drv.state_file, plain),
        resultFile: render(drv.result_file, plain), ledger: render(drv.ledger, plain),
      };
    } catch (e) {
      return this.escalate(u, `driver could not launch: ${message(e)}`);
    }
    const parkStage = own(this.recipe.stages, u.stage);
    if (parkStage?.kind === "session" && parkStage.stop_file !== undefined) {
      try {
        f.stopFile = render(parkStage.stop_file, plain);
      } catch { /* the state file goes without it */ }
    }
    let eventsText = "";
    try {
      eventsText = readFileSync(join(this.run.dir, "events.jsonl"), "utf8");
    } catch { /* no events yet */ }
    mkdirSync(dirname(f.stateFile), { recursive: true });
    writeFileSync(f.stateFile, renderDriverState(this.run, u, eventsText,
      { result_file: f.resultFile, ledger: f.ledger, ...(f.stopFile !== undefined ? { stop_file: f.stopFile } : {}) }));
    removeFile(f.resultFile);

    const seqBefore = own(u.seq, DRIVER);
    u.seq ??= {};
    const n = (seqBefore ?? 0) + 1;
    u.seq[DRIVER] = n;
    const nn = launchNonce(this.run.id, u.id, DRIVER, n);
    let dir: string;
    try {
      dir = await this.host.bind(f.project, f.cwd, nn, drv.launch_dir ?? DEFAULT_LAUNCH_DIR);
    } catch (e) {
      if (isHostError(e)) {
        // The host was not reached and made no directory: nothing is marked, a later tick retries.
        if (seqBefore === undefined) delete u.seq[DRIVER];
        else u.seq[DRIVER] = seqBefore;
        if (Object.keys(u.seq).length === 0) delete u.seq;
        throw e;
      }
      return this.driverRefused(u, nn, `bind: ${message(e)}`);
    }
    let claim: string;
    try {
      claim = writeClaim(dir, f.env, nn);
    } catch (e) {
      if (dir !== f.cwd) await this.releaseDir(u, dir, () => ({ project: f.project, cwd: f.cwd }));
      return this.driverRefused(u, nn, `claim: ${message(e)}`);
    }
    const now = this.nowIso();
    const ds: Session = {
      nonce: nn, claim_nonce: nn, launch_dir: dir, claim_key: claim, project: f.project, cwd: f.cwd,
      launched_at: now, last_progress_at: now, progress_mark: "",
    };
    u.driver = { key, session: ds };
    this.save();
    this.ev("driver", { unit: u.id, nonce: nn, key });
    const req: LaunchRequest = {
      nonce: nn, title: threadTitle(f.title, nn), project: f.project, instance: f.instance, model: f.model, cwd: dir, message: f.text,
    };
    try {
      ds.thread_id = (await this.host.launch(req)).threadId;
    } catch (e) {
      if (isHostError(e)) throw e;
      if (e instanceof LaunchError) {
        await this.endDriver(u);
        return this.driverRefused(u, nn, e.message);
      }
      // Unknown: the launch may have reached the host. Step 0 looks for it by nonce.
      this.report.errors.push(`${this.run.id}/${u.id}: driver launch outcome unknown: ${message(e)}`);
      this.ev("launch unknown", { unit: u.id, nonce: nn, reason: message(e) });
      return;
    }
    this.save();
  }

  /** A driver launch the host refused: the park goes to the operator. */
  private async driverRefused(u: UnitState, nonce: string, reason: string): Promise<void> {
    this.ev("launch failed", { unit: u.id, nonce, reason });
    await this.escalate(u, `driver could not launch: ${reason}`);
  }

  /** Step 8: every unit done marks the run done, once. */
  private async done(): Promise<void> {
    const units = Object.values(this.run.units);
    if (units.length === 0 || !units.every((u) => u.stage === "done")) return;
    this.run.status = "done";
    this.save();
    this.ev("done");
    let eventsText = "";
    try {
      eventsText = readFileSync(join(this.run.dir, "events.jsonl"), "utf8");
    } catch { /* no events */ }
    let ledger: string | undefined;
    if (this.recipe.driver) {
      // The run's base scope has no unit: a ledger path that needs one is left out.
      const base = { ...this.scope(units[0]), get unit(): never { throw new Error("no unit in scope"); } } as Scope;
      try {
        ledger = render(this.recipe.driver.ledger, base);
      } catch { /* the summary goes without it */ }
    }
    await this.notify(`${this.run.id}/done`, runSummary(this.run, eventsText, this.nowIso(), ledger));
  }
}
