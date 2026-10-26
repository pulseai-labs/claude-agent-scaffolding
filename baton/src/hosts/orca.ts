// The Orca host: baton's Host interface over the `orca` CLI. A thread is a terminal; its id is the
// terminal handle (`term_...`). Reply shapes come from Orca 1.4.238 (tests/fixtures/orca/).

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HostDownError, LaunchError, type Host, type LaunchRequest, type ThreadStatus } from "../host.ts";
import { configPath } from "../notify.ts";
import { stateDir } from "../state.ts";
import { bindLaunchDir, releaseLaunchDir } from "./launch-dir.ts";
import { runOrca, type OrcaReply } from "./orca-cli.ts";

export type OrcaConfig = { cli: string; launcher: string };

const expandHome = (p: string) => (p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v !== "";

/** The config file's optional `orca` block over the defaults. */
export function loadOrcaConfig(): OrcaConfig {
  const path = configPath();
  let orca: Partial<OrcaConfig> = {};
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { orca?: Partial<OrcaConfig> } | null;
    orca = raw?.orca ?? {};
  }
  // `orca` is not on the PATH of baton's timer unit; Orca installs the binary under ~/.config.
  const cli = nonEmpty(orca.cli) ? orca.cli : Bun.which("orca") ? "orca" : join(homedir(), ".config", "orca", "cli", "bin", "orca");
  const launcher = nonEmpty(orca.launcher) ? orca.launcher : join(import.meta.dir, "..", "..", "bin", "baton-seat");
  return { cli: expandHome(cli), launcher: expandHome(launcher) };
}

/** One shell word: single-quoted, each `'` as `'\''`. The only escape the launch command uses. */
export function shellQuote(p: string): string {
  return `'${p.replaceAll("'", `'\\''`)}'`;
}

/**
 * The codes that say a terminal is gone, from the pinned Orca 1.4.238 runtime (orcad-server.js):
 * its own classifier groups the first four as one class, and `terminal send` refuses a PTY that is
 * no longer connected with the fifth.
 */
const GONE = new Set(["terminal_handle_stale", "terminal_exited", "terminal_gone", "no_connected_pty", "terminal_not_writable"]);

/** A list reply covers this machine only when its hostScope names `local` and does not omit it. */
function coversLocal(reply: any, what: string): void {
  const ids = reply?.hostScope?.hostIds;
  const omitted = reply?.hostScope?.omittedHostIds;
  if (!Array.isArray(ids) || !ids.includes("local") || (Array.isArray(omitted) && omitted.includes("local"))) {
    throw new HostDownError(`${what} does not cover the local host`);
  }
}

/**
 * The Host state of one terminal, from its `terminal list` row and the agent row joined to it
 * (design 4.5). Only the listed values map to a finished or parked state; a missing row or any
 * other value is `active`, so a worker that cannot be read never passes as completed. There is no
 * `failed`: Orca 1.4.238 has no failure state, and a dead process leaves the list (`gone`, once
 * `status` has confirmed it with `terminal read`).
 */
export function mapOrcaState(terminal: object | undefined, agent: object | undefined): ThreadStatus["state"] {
  if (terminal === undefined) return "gone";
  const a = agent as { state?: unknown; interrupted?: unknown } | undefined;
  switch (a?.state) {
    case "working":
      return "active";
    case "waiting":
    case "blocked":
      return "waiting";
    case "done":
      return a?.interrupted === true ? "interrupted" : "completed";
    default:
      return "active";
  }
}

type Repo = { id: string; displayName: string; path: string };

export class OrcaHost implements Host {
  private cli: string;
  private launcher: string;
  private timeoutMs?: number;
  /** The two lists `status` reads, kept until the next mutating call. */
  private lists?: { terminals: any[]; worktrees: any[] };

  constructor({ cli, launcher }: OrcaConfig, opts: { timeoutMs?: number } = {}) {
    this.cli = cli;
    this.launcher = launcher;
    this.timeoutMs = opts.timeoutMs;
  }

  private run(args: string[]): OrcaReply {
    return runOrca(this.cli, args, this.timeoutMs);
  }

  /** The result of a call that must succeed; any error reply means the host is not answering. */
  private must(args: string[]): any {
    const r = this.run(args);
    if (!r.ok) throw new HostDownError(`orca ${args.slice(0, 2).join(" ")}: ${r.code}: ${r.message}`);
    return r.result;
  }

  /** The one Orca repo whose display name is `project`; else LaunchError. */
  private repo(project: string): Repo {
    const repos: Repo[] = this.must(["repo", "list"])?.repos ?? [];
    const found = repos.filter((r) => r.displayName === project);
    if (found.length !== 1) {
      throw new LaunchError(found.length ? `${found.length} Orca repos are named "${project}"` : `no Orca repo named "${project}"`);
    }
    return found[0];
  }

  async bind(project: string, cwd: string, nonce: string, mode: "worktree" | "root"): Promise<string> {
    return bindLaunchDir(this.repo(project).path, cwd, nonce, mode);
  }

  async release(_project: string, cwd: string, dir: string): Promise<void> {
    releaseLaunchDir(cwd, dir);
  }

  async launch(r: LaunchRequest): Promise<{ threadId: string }> {
    this.lists = undefined;
    const repo = this.repo(r.project);
    // The message goes through a file; only paths reach the shell. baton-seat deletes the file.
    const dir = join(stateDir(), "orca", "messages");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const file = join(dir, `${encodeURIComponent(r.nonce)}.txt`);
    writeFileSync(file, r.message, { mode: 0o600 });
    chmodSync(file, 0o600);
    // An Orca terminal inherits orca-serve's environment, not the timer's, so the state dir goes with it.
    const command = `cd ${shellQuote(r.cwd)} && BATON_STATE_DIR=${shellQuote(stateDir())} exec ${shellQuote(this.launcher)} ${shellQuote(file)}`;
    const res = this.run(["terminal", "create", "--worktree", `path:${repo.path}`, "--title", r.title, "--command", command]);
    if (!res.ok) {
      // Only a selector Orca does not know is a refusal; any other code leaves the outcome unknown,
      // so the message file stays and step 0 finds the terminal by nonce.
      if (res.code === "selector_not_found") {
        rmSync(file, { force: true });
        throw new LaunchError(`terminal create: ${res.code}: ${res.message}`);
      }
      throw new HostDownError(`terminal create outcome unknown: ${res.code}: ${res.message}`);
    }
    const handle = res.result?.terminal?.handle;
    if (typeof handle !== "string" || !handle) throw new HostDownError("terminal create outcome unknown: reply has no handle");
    return { threadId: handle };
  }

  /**
   * One `terminal list` and one `worktree ps` per instance. A truncated reply, or one that does not
   * cover the local host, may hide the row, so it is host down.
   */
  private readLists(): { terminals: any[]; worktrees: any[] } {
    if (this.lists) return this.lists;
    const t = this.must(["terminal", "list", "--limit", "1000"]);
    if (t?.truncated === true) throw new HostDownError("terminal list is truncated");
    coversLocal(t, "terminal list");
    const w = this.must(["worktree", "ps", "--limit", "1000"]);
    if (w?.truncated === true) throw new HostDownError("worktree ps is truncated");
    coversLocal(w, "worktree ps");
    this.lists = { terminals: Array.isArray(t?.terminals) ? t.terminals : [], worktrees: Array.isArray(w?.worktrees) ? w.worktrees : [] };
    return this.lists;
  }

  async status(threadId: string): Promise<ThreadStatus> {
    const { terminals, worktrees } = this.readLists();
    const terminal = terminals.find((t) => t?.handle === threadId);
    if (terminal === undefined) return { state: this.confirmGone(threadId), activity: "|" };
    // The agent row of a terminal is the one whose paneKey is `${tabId}:${leafId}` (spike 1c).
    const paneKey = typeof terminal?.tabId === "string" && typeof terminal?.leafId === "string" ? `${terminal.tabId}:${terminal.leafId}` : undefined;
    const agent =
      paneKey === undefined
        ? undefined
        : worktrees.flatMap((w) => (Array.isArray(w?.agents) ? w.agents : [])).find((a: { paneKey?: unknown }) => a?.paneKey === paneKey);
    // updatedAt and stateStartedAt move with the agent; lastOutputAt moves every ~5 s with no input (spike 8).
    return { state: mapOrcaState(terminal, agent), activity: `${agent?.updatedAt ?? ""}|${agent?.stateStartedAt ?? ""}` };
  }

  /**
   * A terminal missing from a whole list is gone only on positive evidence: `terminal read` answers
   * with a gone code, or with status `exited` (spike 6). Anything else, a running terminal included,
   * is host down, so a live worker is never closed on a list that missed it.
   */
  private confirmGone(threadId: string): "gone" {
    const r = this.run(["terminal", "read", "--terminal", threadId]);
    if (r.ok ? r.result?.terminal?.status === "exited" : GONE.has(r.code)) return "gone";
    const why = r.ok ? `status ${String(r.result?.terminal?.status)}` : `${r.code}: ${r.message}`;
    throw new HostDownError(`terminal ${threadId} is not in the list, but terminal read says ${why}`);
  }

  /** Run a call on one terminal; a gone terminal is `undefined`, any other refusal is host down. */
  private onTerminal(args: string[]): any {
    const r = this.run(args);
    if (r.ok) return r.result;
    if (GONE.has(r.code)) return undefined;
    throw new HostDownError(`orca ${args.slice(0, 2).join(" ")}: ${r.code}: ${r.message}`);
  }

  async interrupt(threadId: string, _reason: string): Promise<void> {
    this.lists = undefined;
    // Escape aborts an omp turn; `--interrupt` sends Ctrl-C, which omp ignores (spike 5).
    this.onTerminal(["terminal", "send", "--terminal", threadId, "--text", "\x1b"]);
  }

  async findByNonce(project: string, nonce: string): Promise<string[]> {
    const repo = this.repo(project);
    const res = this.must(["terminal", "list", "--worktree", `path:${repo.path}`, "--limit", "1000"]);
    // A truncated list may hide the very terminal being looked for.
    if (res?.truncated === true) throw new HostDownError("terminal list is truncated");
    // An empty answer for an uncovered host is not "no such terminal": step 0 would release a live launch.
    coversLocal(res, "terminal list");
    const tag = `[baton ${nonce}]`;
    return ((res?.terminals ?? []) as { handle: string; title?: string }[])
      .filter((t) => typeof t.title === "string" && t.title.includes(tag))
      .map((t) => t.handle);
  }

  async close(threadId: string): Promise<void> {
    this.lists = undefined;
    this.onTerminal(["terminal", "close", "--terminal", threadId]);
  }

  async screen(threadId: string): Promise<string> {
    const res = this.onTerminal(["terminal", "read", "--terminal", threadId, "--screen"]);
    if (res === undefined) return "";
    return ((res.terminal?.tail ?? []) as string[]).join("\n");
  }
}
