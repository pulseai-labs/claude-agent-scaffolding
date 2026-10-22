// Shared by the merge and end-to-end tests: git over temp repos, and a scripted Forge.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Forge, PrView } from "../src/forge.ts";

export function git(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
  return p.stdout.toString().trim();
}
export function commit(dir: string, name: string): string {
  writeFileSync(join(dir, name), name);
  git(dir, "add", name);
  git(dir, "commit", "-m", name);
  return git(dir, "rev-parse", "HEAD");
}

export class FakeForge implements Forge {
  views = new Map<string, PrView>();
  viewCalls: string[] = [];
  merges: { url: string; head: string }[] = [];
  mergeFails = 0;
  /** When set, every view returns a fresh head `<prefix><n>`. */
  rotateHead: string | null = null;
  private n = 0;
  async view(url: string): Promise<PrView> {
    this.viewCalls.push(url);
    const v = this.views.get(url);
    if (!v) throw new Error(`no fake PR ${url}`);
    return this.rotateHead === null ? { ...v } : { ...v, head: `${this.rotateHead}${++this.n}` };
  }
  async merge(url: string, head: string): Promise<void> {
    if (this.mergeFails > 0) {
      this.mergeFails--;
      throw new Error("gh refused");
    }
    this.merges.push({ url, head });
  }
}
