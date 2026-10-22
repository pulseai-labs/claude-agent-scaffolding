// A scripted in-memory Host for engine tests. Nothing here talks to a real service.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { claimKey, claimPath } from "../src/claims.ts";
import { HostAuthError, HostDownError, type Host, type LaunchRequest, type ThreadStatus } from "../src/host.ts";

export type Behaviour = {
  ticks: number;
  writes?: { path: string; content: string }[];
  end: "completed" | "failed" | "waiting" | "interrupted";
  handoffLine?: string;
  loseResponse?: boolean;
};

export type SeenClaim = { nonce: string; env: Record<string, string> } | null;
export type Launch = { request: LaunchRequest; claim: SeenClaim; behaviour: Behaviour };

type Thread = { id: string; launch: Launch; step: number };

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
  private threads: Thread[] = [];

  constructor(public script: Record<string, Behaviour>) {}

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
    const done = t.step >= t.launch.behaviour.ticks;
    return { state: done ? t.launch.behaviour.end : "active", activity: `${t.id}:${t.step}` };
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
      if (t.step >= b.ticks) continue;
      t.step++;
      if (t.step === b.ticks) {
        // `{unit}` in a write's path or content is the launching unit's id, so one stage
        // script can serve several units.
        const unit = segment(t.launch.request.title, 1);
        for (const w of b.writes ?? []) {
          const path = w.path.replaceAll("{unit}", unit);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, w.content.replaceAll("{unit}", unit));
        }
      }
    }
  }
}
