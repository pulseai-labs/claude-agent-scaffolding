// User-level loader for claude-agent-scaffolding's OMP bin-path module.
// Copy this file once into ~/.omp/agent/extensions/ (spec B §4.2). It holds no
// logic that should change: it finds the module the installed plugins ship
// (<plugin>/omp/bin-path.ts), imports the newest, and runs it — so updating
// the plugins updates the behaviour. Bump LOADER_VERSION only when this file
// itself changes, and raise the module's MIN_LOADER_VERSION with it.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LOADER_VERSION = 1;
const MARKETPLACE = "claude-agent-scaffolding";
const DOWNLOAD = "curl -fsSL https://raw.githubusercontent.com/pulseai-labs/claude-agent-scaffolding/main/omp/extensions/plugin-bin-path.ts --create-dirs -o ~/.omp/agent/extensions/plugin-bin-path.ts";

function installPaths(record: string): string[] {
  try {
    const plugins = JSON.parse(readFileSync(record, "utf8"))?.plugins ?? {};
    return Object.entries(plugins).flatMap(([id, e]) => {
      if (!id.endsWith(`@${MARKETPLACE}`)) return [];
      const pick = Array.isArray(e) ? (e.find((x: any) => x?.scope === "user") ?? e[0]) : undefined;
      return typeof pick?.installPath === "string" && pick.installPath ? [pick.installPath as string] : [];
    });
  } catch { return []; }
}

export function moduleCandidates(home: string): string[] {
  const paths = [
    ...installPaths(join(home, ".omp", "plugins", "installed_plugins.json")),
    ...installPaths(join(home, ".claude", "plugins", "installed_plugins.json")),
  ];
  return [...new Set(paths.map((p) => join(p, "omp", "bin-path.ts")))].filter((f) => existsSync(f));
}

export async function load(pi: any, home: string = homedir()): Promise<void> {
  const mods: any[] = [];
  for (const f of moduleCandidates(home)) {
    try { mods.push(await import(f)); }
    catch (e) { console.warn(`plugin bin paths: cannot load ${f} (${(e as Error).message})`); }
  }
  if (!mods.length) { console.warn("plugin bin paths not added: no installed plugin ships omp/bin-path.ts"); return; }
  const mod = mods.reduce((a, b) => ((b.VERSION ?? 0) > (a.VERSION ?? 0) ? b : a));
  if ((mod.MIN_LOADER_VERSION ?? 0) > LOADER_VERSION)
    console.warn(`plugin-bin-path.ts loader is out of date (loader ${LOADER_VERSION}, module needs ${mod.MIN_LOADER_VERSION}); update it: ${DOWNLOAD}`);
  if (typeof mod.default !== "function") { console.warn("plugin bin paths not added: the newest module has no default factory"); return; }
  try { await mod.default(pi); }
  catch (e) { console.warn(`plugin bin paths not added: the module failed (${(e as Error).message})`); }
}

// A loader error must never reject the extension factory: users cannot patch this file once copied.
export default async function (pi: any) {
  try { await load(pi); }
  catch (e) { console.warn(`plugin bin paths not added: ${(e as Error).message}`); }
}
