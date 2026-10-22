// The tick: one pass, under the store lock, over every armed run. Per run, in order:
// 0 orphan recovery, 1 sources, 2 stop files, 3 live sessions, 4 wait stages,
// 5 merge stages, 6 launches due, 8 done. A host that refuses the credentials or cannot be
// reached stops the tick with nothing marked.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ClaimBusy, claimKey, liveClaim, removeClaim, writeClaim } from "./claims.ts";
import { PrUrlError, type Forge, type PrView } from "./forge.ts";
import { HostAuthError, HostDownError, LaunchError, type Host, type LaunchRequest } from "./host.ts";
import { readConfig, type Config } from "./notify.ts";
import {
  DEFAULT_SLOTS, DEFAULT_STAGE_SLOTS, nonce as launchNonce, render, threadTitle, UNIT_ID_RE,
  type Outcome, type Recipe, type Scope, type SessionStage, type Stage, type WaitStage,
} from "./recipe.ts";
import { mergeUnit } from "./merge.ts";
import { evaluate, Exit0Error, runArgv, type EvalCtx } from "./signals.ts";
import type { RunState, Session, Store, UnitState } from "./state.ts";

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
const ORPHAN_MS = 2 * MIN;
const STALLS_TO_PARK = 2;
const DOWN_NOTIFY_MS = 30 * MIN;
const HOOK_TIMEOUT_MS = 10 * MIN;
const WALK_LIMIT = 5000;

const emptyReport = (): TickReport => ({ launched: [], transitioned: [], parked: [], merged: [], errors: [] });
const isHostError = (e: unknown) => e instanceof HostAuthError || e instanceof HostDownError;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const day = (d: Date) => d.toISOString().slice(0, 10);

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
    let g = 0;
    for (const u of Object.values(this.run.units)) if (u.group > g) g = u.group;
    return g;
  }

  private ordered(): UnitState[] {
    return Object.values(this.run.units).sort((a, b) =>
      a.group - b.group || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private scope(u: UnitState, extra: Partial<Scope> = {}): Scope {
    return {
      param: this.run.params,
      unit: { id: u.id, group: String(u.group), order: u.order, vars: u.vars },
      run: { id: this.run.id, dir: this.run.dir, group: String(this.group()) },
      attempt: u.launches[u.stage] ?? 0,
      ...extra,
    };
  }

  private ctx(u: UnitState): Ctx {
    return { stage: this.recipe.stages[u.stage], scope: this.scope(u) };
  }

  stageSlots(stageName: string): string[] {
    const st = this.recipe.stages[stageName];
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

  /** End the unit's session: interrupt (if asked), remove its claim, release its directory. */
  private async endSession(u: UnitState, o: { interrupt?: string; release?: boolean } = {}): Promise<void> {
    const s = u.session;
    if (!s) return;
    const { stage, scope } = this.ctx(u);
    if (o.interrupt && s.thread_id) await this.host.interrupt(s.thread_id, o.interrupt);
    removeClaim(s.claim_key, s.claim_nonce);
    if (o.release !== false && stage.kind === "session") await this.release(u, stage, scope, s.launch_dir);
    delete u.session;
    delete u.quiet_since;
    this.save();
  }

  private async release(u: UnitState, stage: SessionStage, scope: Scope, dir: string): Promise<void> {
    try {
      await this.host.release(render(stage.project, scope), render(stage.cwd, scope), dir);
    } catch (e) {
      if (isHostError(e)) throw e;
      this.report.errors.push(`${this.run.id}/${u.id}: release failed: ${message(e)}`);
      this.ev("release failed", { unit: u.id, dir, reason: message(e) });
    }
  }

  private async park(u: UnitState, reason: string, o: { interrupt?: string; release?: boolean } = {}): Promise<void> {
    await this.endSession(u, o);
    const at = this.nowIso();
    u.parked = { reason, at };
    this.save();
    this.ev("park", { unit: u.id, stage: u.stage, reason });
    this.report.parked.push(u.id);
    await this.notify(`${this.run.id}/${u.id}/park/${at}`, `baton ${this.run.id}/${u.id} parked in ${u.stage}: ${reason}`);
  }

  private async move(u: UnitState, o: Outcome): Promise<void> {
    if (o.to === "park") return this.park(u, "outcome");
    const from = u.stage;
    u.stage = o.to;
    u.record_at_entry = u.record_seen;
    delete u.cwd_busy;
    delete u.merge_failures;
    this.save();
    this.ev("transition", { unit: u.id, from, to: o.to });
    this.report.transitioned.push(u.id);
    if (o.notify !== undefined) {
      await this.notify(`${this.run.id}/${u.id}/${o.to}/${this.nowIso()}`, render(o.notify, this.scope(u)));
    }
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

  /** The first outcome whose signals all read true; "pending" when an undecided one comes first. */
  private async firstOutcome(u: UnitState, outcomes: Outcome[], cwd: string): Promise<Outcome | "pending" | null> {
    const ctx: EvalCtx = {
      run: this.run, unit: u, scope: this.scope(u), cwd, forge: this.opts.forge, prViews: this.prViews,
    };
    for (const o of outcomes) {
      let pending = false;
      let matched = true;
      for (const sig of o.when) {
        const v = await evaluate(sig, ctx);
        if (v === "false") { matched = false; break; }
        if (v === "pending") pending = true;
      }
      if (!matched) continue;
      return pending ? "pending" : o;
    }
    return null;
  }

  private async takeOutcome(u: UnitState, o: Outcome, hookCwd: string): Promise<void> {
    if (!this.hooks(o.run, this.scope(u), hookCwd)) return this.park(u, "run failed");
    await this.endSession(u);
    await this.move(u, o);
  }

  /** Per-unit guard: a host error stops the tick; anything else parks only this unit. */
  private async guard(u: UnitState, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      if (isHostError(e)) throw e;
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
        const ids = await this.host.findByNonce(render(stage.project, scope), s.nonce);
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
          this.ev("orphan", { unit: u.id, nonce: s.nonce });
          await this.endSession(u);
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
    const n = Math.max(u.seq[u.stage] ?? 0, u.launches[u.stage] ?? 0) + 1;
    u.seq[u.stage] = n;
    return launchNonce(this.run.id, u.id, u.stage, n);
  }

  /** A launch that now has its thread: a counted launch, or a successor (not counted). */
  private counted(u: UnitState, s: Session): void {
    if (s.successor_of) {
      this.ev("successor", { unit: u.id, nonce: s.nonce, of: s.successor_of, thread: s.thread_id });
      return;
    }
    u.launches[u.stage] = (u.launches[u.stage] ?? 0) + 1;
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
          && !seen.has(r[src.id_key] as string);
        if (!ok) return this.parkRun(`invalid record ${file}`);
        const id = r![src.id_key] as string;
        seen.add(id);
        const vars: Record<string, string> = {};
        for (const [name, key] of Object.entries(src.vars)) {
          const v = r![key];
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") vars[name] = String(v);
        }
        recs.push({
          file, id, group: r![src.group_key] as number, order: r![src.order_key] as number, vars,
          digest: createHash("sha256").update(bytes).digest("hex"), stage: src.stage,
        });
      }
    }
    for (const rec of recs) {
      const known = this.run.units[rec.id];
      if (known) {
        known.record_seen = rec.digest;
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
        const idle = this.nowMs() - Date.parse(s.last_progress_at);
        const max = stage.max_launches ?? DEFAULT_MAX_LAUNCHES;
        const launches = u.launches[u.stage] ?? 0;
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
        // completed
        const o = await this.firstOutcome(u, stage.outcomes, this.existingDir(render(stage.cwd, scope)));
        if (o === "pending") return;
        if (o) return this.takeOutcome(u, o, this.existingDir(s.launch_dir, render(stage.cwd, scope)));
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

  private async stall(u: UnitState, s: Session): Promise<void> {
    await this.host.interrupt(s.thread_id!, "stalled");
    u.stalls += 1;
    this.ev("stall", { unit: u.id, nonce: s.nonce, stalls: u.stalls });
    if (u.stalls >= STALLS_TO_PARK) return this.park(u, "stalled");
    await this.endSession(u);
    this.held.add(u.id); // a stalled unit relaunches next tick
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
    const n = this.mint(u);
    const scope = this.scope(u, { handoff_path: path });
    const req: LaunchRequest = {
      nonce: n,
      title: threadTitle(render(stage.title, scope), n),
      project: render(stage.project, scope),
      instance: render(stage.instance, scope),
      model: render(stage.model, scope),
      cwd: old.launch_dir,
      message: render(stage.handoff!.message, scope),
    };
    const now = this.nowIso();
    const s: Session = {
      nonce: n, claim_nonce: old.claim_nonce, launch_dir: old.launch_dir, claim_key: old.claim_key,
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
        await this.launchFailed(u, e.message, { key: s.claim_key, nonce: s.claim_nonce, dir: s.launch_dir });
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
  private async launchFailed(u: UnitState, reason: string, c: { key?: string; nonce?: string; dir?: string }): Promise<void> {
    const { stage, scope } = this.ctx(u);
    if (c.key && c.nonce) removeClaim(c.key, c.nonce);
    if (c.dir !== undefined && stage.kind === "session") await this.release(u, stage, scope, c.dir);
    delete u.session;
    u.launches[u.stage] = (u.launches[u.stage] ?? 0) + 1; // the refused attempt counts
    this.ev("launch failed", { unit: u.id, reason });
    this.save();
    if (u.launches[u.stage] >= ((stage as SessionStage).max_launches ?? DEFAULT_MAX_LAUNCHES)) {
      await this.park(u, "launch failed");
    } else {
      this.held.add(u.id); // a refused launch relaunches next tick
    }
  }

  /** Step 4: wait stages move on their first matching outcome. */
  private async waits(): Promise<void> {
    for (const u of this.ordered()) {
      const stage = this.recipe.stages[u.stage];
      if (u.parked || stage?.kind !== "wait") continue;
      await this.guard(u, async () => {
        const o = await this.firstOutcome(u, (stage as WaitStage).outcomes, this.run.dir);
        if (o && o !== "pending") await this.takeOutcome(u, o, this.run.dir);
      });
    }
  }

  /** Step 5: merge stages, decided by the recipe's rule in merge.ts. */
  private async merges(): Promise<void> {
    for (const u of this.ordered()) {
      const stage = this.recipe.stages[u.stage];
      if (u.parked || stage?.kind !== "merge") continue;
      await this.guard(u, () => mergeUnit({
        run: this.run, forge: this.opts.forge, prViews: this.prViews,
        scope: (x, extra) => this.scope(x, extra),
        ev: (k, o) => this.ev(k, o),
        park: (x, reason) => this.park(x, reason),
        move: (x, to) => this.move(x, { when: [], to }),
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
      const stage = this.recipe.stages[u.stage];
      if (u.session || u.parked || this.held.has(u.id) || stage?.kind !== "session") continue;
      await this.guard(u, () => this.launch(u, stage));
    }
  }

  private async launch(u: UnitState, stage: SessionStage): Promise<void> {
    const attempt = (u.launches[u.stage] ?? 0) + 1;
    const scope = this.scope(u, { attempt });
    const cwd = render(stage.cwd, scope);
    const project = render(stage.project, scope);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(stage.env)) env[k] = render(v, scope);

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
    if ((u.launches[u.stage] ?? 0) >= (stage.max_launches ?? DEFAULT_MAX_LAUNCHES)) return this.park(u, "cap");
    if (!this.hooks(stage.before, scope, this.existingDir(cwd))) return this.park(u, "before failed");

    const seqBefore = u.seq?.[u.stage];
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
      nonce: nn, claim_nonce: nn, launch_dir: dir, claim_key: key,
      launched_at: now, last_progress_at: now, progress_mark: this.progressMark(stage, scope, ""),
    };
    const req: LaunchRequest = {
      nonce: nn,
      title: threadTitle(render(stage.title, scope), nn),
      project,
      instance: render(stage.instance, scope),
      model: render(stage.model, scope),
      cwd: dir,
      message: render(stage.message, scope),
    };
    if (!(await this.start(u, s, req))) return;
    if (!this.hooks(stage.after_launch, scope, this.existingDir(dir))) {
      await this.park(u, "after_launch failed", { interrupt: "after_launch failed" });
    }
  }

  /** Step 8: every unit done marks the run done, once. */
  private async done(): Promise<void> {
    const units = Object.values(this.run.units);
    if (units.length === 0 || !units.every((u) => u.stage === "done")) return;
    this.run.status = "done";
    this.save();
    this.ev("done");
    await this.notify(`${this.run.id}/done`, `baton ${this.run.id} done`);
  }
}
