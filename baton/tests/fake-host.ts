// A scripted in-memory Host for engine tests. Nothing here talks to a real service.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { claimKey, claimPath } from "../src/claims.ts";
import {
  HostAuthError, HostDownError, type Host, type LaunchRequest, type PendingRequest, type ThreadStatus,
} from "../src/host.ts";

export type Behaviour = {
  ticks: number;
  writes?: { path: string; content: string }[];
  end: "completed" | "failed" | "waiting" | "interrupted";
  handoffLine?: string;
  loseResponse?: boolean;
  /** From step `atStep` the thread is `active` with `request` pending, and does not advance, until `answer`. */
  pending?: { atStep: number; request: PendingRequest };
};

export type SeenClaim = { nonce: string; env: Record<string, string> } | null;
export type Launch = { request: LaunchRequest; claim: SeenClaim; behaviour: Behaviour };

type Thread = {
  id: string;
  launch: Launch;
  step: number;
  /** The behaviour's pending request was answered. */
  answered?: boolean;
  /** A request raised by the test, replacing any other. */
  raised?: PendingRequest;
  /** Ended by the test (`finish`) or gone (`drop`). */
  forced?: ThreadStatus["state"];
  /** Set by `block`: `waiting` with no request the host can read, and no steps, until `unblock`. */
  blocked?: boolean;
};

/** The claim the launcher would read for `cwd`, or null when there is none. */
function readClaim(cwd: string): SeenClaim {
  let text: string;
  try {
    text = readFileSync(claimPath(claimKey(cwd)), "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n");
  if (!lines[0].startsWith("# baton ")) return null;
  const env: Record<string, string> = {};
  for (const l of lines.slice(1)) {
    const i = l.indexOf("=");
    if (i > 0) env[l.slice(0, i)] = l.slice(i + 1);
  }
  return { nonce: lines[0].slice("# baton ".length), env };
}

/** The nonce segment `i` inside the title's `[baton …]` tag (1 = unit, 2 = stage). */
function segment(title: string, i: number): string {
  const m = /\[baton ([^\]]*)\]\s*$/.exec(title);
  if (!m) throw new Error(`fake host: no [baton <nonce>] tag in title: ${title}`);
  return m[1].split("/")[i] ?? "";
}
const stageOf = (title: string) => segment(title, 2);

export class FakeHost implements Host {
  launches: Launch[] = [];
  interrupts: { threadId: string; reason: string }[] = [];
  releases: { project: string; cwd: string; dir: string }[] = [];
  down: "auth" | "unreachable" | null = null;
  /** Override to make `bind` return a directory other than `cwd`. */
  bindDir: ((project: string, cwd: string, nonce: string, mode: "worktree" | "root") => string) | null = null;
  /** Threads `close` was called for, in order. */
  closes: string[] = [];
  /** What `screen` returns per thread; a thread with no entry reads `""`. */
  screens: Record<string, string> = {};
  answers: { threadId: string; requestId: string; answers: Record<string, string> }[] = [];
  /** What `keys` sent, in order. */
  sent: { thread: string; text: string }[] = [];
  /** With it, the instance has `close`, `screen`, `respond` and `keys`; without, none of them, as a 0.4.0 host. */
  withOptional: boolean;
  declare close?: (threadId: string) => Promise<void>;
  declare screen?: (threadId: string) => Promise<string>;
  declare respond?: (threadId: string, requestId: string, answers: Record<string, string>) => Promise<void>;
  declare keys?: (threadId: string, text: string) => Promise<void>;
  /** Not set by the constructor: a test that needs them assigns them. */
  declare endRun?: (runId: string) => Promise<void>;
  declare goneNote?: () => string;
  private threads: Thread[] = [];

  constructor(public script: Record<string, Behaviour>, opts: { withOptional?: boolean } = {}) {
    this.withOptional = opts.withOptional ?? false;
    if (!this.withOptional) return;
    this.close = async (threadId) => {
      this.check();
      this.closes.push(threadId);
      const t = this.threads.find((x) => x.id === threadId);
      if (t) t.forced = "gone"; // a thread already gone is not an error
    };
    this.screen = async (threadId) => {
      this.check();
      return this.screens[threadId] ?? "";
    };
    this.respond = async (threadId, requestId, answers) => {
      this.check();
      this.answers.push({ threadId, requestId, answers });
    };
    this.keys = async (threadId, text) => {
      this.check();
      this.sent.push({ thread: threadId, text });
    };
  }

  private check(): void {
    if (this.down === "auth") throw new HostAuthError();
    if (this.down === "unreachable") throw new HostDownError();
  }

  async bind(project: string, cwd: string, nonce: string, mode: "worktree" | "root"): Promise<string> {
    this.check();
    return this.bindDir ? this.bindDir(project, cwd, nonce, mode) : cwd;
  }

  async release(project: string, cwd: string, dir: string): Promise<void> {
    this.check();
    this.releases.push({ project, cwd, dir });
  }

  async launch(r: LaunchRequest): Promise<{ threadId: string }> {
    this.check();
    const stage = stageOf(r.title);
    const behaviour = this.script[stage];
    if (!behaviour) throw new Error(`fake host: no behaviour scripted for stage "${stage}"`);
    const launch: Launch = { request: r, claim: readClaim(r.cwd), behaviour };
    this.launches.push(launch);
    const id = `thread-${this.threads.length + 1}`;
    this.threads.push({ id, launch, step: 0 });
    if (behaviour.loseResponse) throw new Error("fake host: response lost");
    return { threadId: id };
  }

  async status(threadId: string): Promise<ThreadStatus> {
    this.check();
    const t = this.threads.find((x) => x.id === threadId);
    if (!t) return { state: "gone", activity: "" };
    if (t.forced === "gone") return { state: "gone", activity: "" };
    const activity = `${t.id}:${t.step}`;
    if (t.forced) return { state: t.forced, activity };
    const pending = this.pendingOf(t);
    if (t.blocked) return pending ? { state: "waiting", activity, pending } : { state: "waiting", activity };
    if (pending) return { state: "active", activity, pending };
    const done = t.step >= t.launch.behaviour.ticks;
    return { state: done ? t.launch.behaviour.end : "active", activity };
  }

  private pendingOf(t: Thread): PendingRequest | undefined {
    if (t.raised) return t.raised;
    const p = t.launch.behaviour.pending;
    return p && !t.answered && t.step >= p.atStep ? p.request : undefined;
  }

  private thread(threadId: string): Thread {
    const t = this.threads.find((x) => x.id === threadId);
    if (!t) throw new Error(`fake host: no thread ${threadId}`);
    return t;
  }

  /** Answer the thread's pending request: it clears, and the thread goes on with its steps. */
  answer(threadId: string): void {
    const t = this.thread(threadId);
    t.answered = true;
    delete t.raised;
  }

  /** Make `request` the thread's pending request, replacing any other. */
  raise(threadId: string, request: PendingRequest): void {
    this.thread(threadId).raised = request;
  }

  /** The thread waits on a question the host cannot read: status `waiting`, no `pending`, no steps. */
  block(threadId: string): void {
    this.thread(threadId).blocked = true;
  }

  /** The question was answered in the terminal: the thread goes back to stepping. */
  unblock(threadId: string): void {
    delete this.thread(threadId).blocked;
  }

  /** End the thread now with `end`. */
  finish(threadId: string, end: "completed" | "failed" | "interrupted"): void {
    this.thread(threadId).forced = end;
  }

  /** The thread is gone. */
  drop(threadId: string): void {
    this.thread(threadId).forced = "gone";
  }

  async interrupt(threadId: string, reason: string): Promise<void> {
    this.check();
    this.interrupts.push({ threadId, reason });
  }

  async findByNonce(project: string, nonce: string): Promise<string[]> {
    this.check();
    return this.threads
      .filter((t) => t.launch.request.project === project && t.launch.request.title.includes(`[baton ${nonce}]`))
      .map((t) => t.id);
  }

  /** One engine tick: move every thread one step, writing its files on the last step. */
  advance(): void {
    for (const t of this.threads) {
      const b = t.launch.behaviour;
      if (t.step >= b.ticks || t.forced || t.blocked || this.pendingOf(t)) continue;
      t.step++;
      if (t.step === b.ticks) {
        // `{unit}` in a write's path or content is the launching unit's id, so one stage
        // script can serve several units; `{launch}` in a path is the nonce's launch number.
        const unit = segment(t.launch.request.title, 1);
        const launch = segment(t.launch.request.title, 3);
        for (const w of b.writes ?? []) {
          const path = w.path.replaceAll("{unit}", unit).replaceAll("{launch}", launch);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, w.content.replaceAll("{unit}", unit));
        }
      }
    }
  }
}
