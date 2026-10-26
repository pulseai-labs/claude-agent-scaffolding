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

const STALE = "terminal_handle_stale";

type Repo = { id: string; displayName: string; path: string };

export class OrcaHost implements Host {
  private cli: string;
  private launcher: string;
  private timeoutMs?: number;

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
    const repo = this.repo(r.project);
    // The message goes through a file; only paths reach the shell. baton-seat deletes the file.
    const dir = join(stateDir(), "orca", "messages");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const file = join(dir, `${encodeURIComponent(r.nonce)}.txt`);
    writeFileSync(file, r.message, { mode: 0o600 });
    chmodSync(file, 0o600);
    const command = `cd ${shellQuote(r.cwd)} && exec ${shellQuote(this.launcher)} ${shellQuote(file)}`;
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

  async status(_threadId: string): Promise<ThreadStatus> {
    throw new Error("status: Task 7");
  }

  /** Run a call on one terminal; a stale handle is `undefined`, any other refusal is host down. */
  private onTerminal(args: string[]): any {
    const r = this.run(args);
    if (r.ok) return r.result;
    if (r.code === STALE) return undefined;
    throw new HostDownError(`orca ${args.slice(0, 2).join(" ")}: ${r.code}: ${r.message}`);
  }

  async interrupt(threadId: string, _reason: string): Promise<void> {
    // Escape aborts an omp turn; `--interrupt` sends Ctrl-C, which omp ignores (spike 5).
    this.onTerminal(["terminal", "send", "--terminal", threadId, "--text", "\x1b"]);
  }

  async findByNonce(project: string, nonce: string): Promise<string[]> {
    const repo = this.repo(project);
    const res = this.must(["terminal", "list", "--worktree", `path:${repo.path}`, "--limit", "1000"]);
    // A truncated list may hide the very terminal being looked for.
    if (res?.truncated === true) throw new HostDownError("terminal list is truncated");
    const tag = `[baton ${nonce}]`;
    return ((res?.terminals ?? []) as { handle: string; title?: string }[])
      .filter((t) => typeof t.title === "string" && t.title.includes(tag))
      .map((t) => t.handle);
  }

  async close(threadId: string): Promise<void> {
    this.onTerminal(["terminal", "close", "--terminal", threadId]);
  }

  async screen(threadId: string): Promise<string> {
    const res = this.onTerminal(["terminal", "read", "--terminal", threadId, "--screen"]);
    if (res === undefined) return "";
    return ((res.terminal?.tail ?? []) as string[]).join("\n");
  }
}
