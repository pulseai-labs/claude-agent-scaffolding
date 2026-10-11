import { describe, expect, test, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load, moduleCandidates, LOADER_VERSION } from "./plugin-bin-path";

const M = "claude-agent-scaffolding";
function home() { return mkdtempSync(join(tmpdir(), "pbl-")); }
function stub(h: string, name: string, version: number, minLoader = 1, body = "") {
  const p = join(h, "cache", `${name}-${version}`);
  mkdirSync(join(p, "omp"), { recursive: true });
  writeFileSync(join(p, "omp", "bin-path.ts"), body ||
    `export const VERSION = ${version}; export const MIN_LOADER_VERSION = ${minLoader};
     export default function (pi: any) { pi.ran = "${name}@${version}"; }`);
  return p;
}
function record(h: string, which: ".omp" | ".claude", plugins: Record<string, string>) {
  const f = join(h, which, "plugins", "installed_plugins.json");
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, JSON.stringify({ version: 2, plugins: Object.fromEntries(
    Object.entries(plugins).map(([n, p]) => [`${n}@${M}`, [{ scope: "user", installPath: p }]])) }));
}

describe("loader", () => {
  test("runs the highest-VERSION installed module", async () => {
    const h = home();
    record(h, ".omp", { ossify: stub(h, "ossify", 1), "workspace-init": stub(h, "workspace-init", 2) });
    const pi: any = {};
    await load(pi, h);
    expect(pi.ran).toBe("workspace-init@2");
  });
  test("finds modules through the Claude record too", async () => {
    const h = home();
    record(h, ".claude", { "architect-critic": stub(h, "architect-critic", 1) });
    const pi: any = {};
    await load(pi, h);
    expect(pi.ran).toBe("architect-critic@1");
  });
  test("ignores plugins that are not module hosts", () => {
    const h = home();
    record(h, ".omp", { "merge-bar": stub(h, "merge-bar", 9) });
    expect(moduleCandidates(h)).toEqual([]);
  });
  test("no installed module: one warning, nothing runs", async () => {
    const h = home();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const pi: any = {};
    await load(pi, h);
    expect(pi.ran).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("no installed plugin ships omp/bin-path.ts");
    warn.mockRestore();
  });
  test("an out-of-date loader warns with the download command and still runs the module", async () => {
    const h = home();
    record(h, ".omp", { ossify: stub(h, "ossify", 3, LOADER_VERSION + 1) });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const pi: any = {};
    await load(pi, h);
    expect(pi.ran).toBe("ossify@3");
    expect(String(warn.mock.calls[0][0])).toContain("curl -fsSL");
    warn.mockRestore();
  });
  test("a module that fails to import is skipped with a warning; another runs", async () => {
    const h = home();
    record(h, ".omp", { ossify: stub(h, "ossify", 5, 1, "this is not typescript {{{"),
                        "workspace-init": stub(h, "workspace-init", 1) });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const pi: any = {};
    await load(pi, h);
    expect(pi.ran).toBe("workspace-init@1");
    expect(String(warn.mock.calls[0][0])).toContain("cannot load");
    warn.mockRestore();
  });
});
