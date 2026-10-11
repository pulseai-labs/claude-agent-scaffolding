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
    // the higher version comes first, so "take the last module" would fail this test
    record(h, ".omp", { ossify: stub(h, "ossify", 2), "workspace-init": stub(h, "workspace-init", 1) });
    const pi: any = {};
    await load(pi, h);
    expect(pi.ran).toBe("ossify@2");
  });
  test("finds modules through the Claude record too", async () => {
    const h = home();
    record(h, ".claude", { "architect-critic": stub(h, "architect-critic", 1) });
    const pi: any = {};
    await load(pi, h);
    expect(pi.ran).toBe("architect-critic@1");
  });
  test("a plugin of our marketplace without omp/bin-path.ts yields no candidate", () => {
    const h = home();
    const bare = join(h, "cache", "merge-bar-9");
    mkdirSync(bare, { recursive: true });
    record(h, ".omp", { "merge-bar": bare });
    expect(moduleCandidates(h)).toEqual([]);
  });
  test("any plugin of our marketplace that ships omp/bin-path.ts is a candidate, not only a fixed list", () => {
    const h = home();
    const p = stub(h, "brand-new-plugin", 1);
    record(h, ".omp", { "brand-new-plugin": p });
    expect(moduleCandidates(h)).toEqual([join(p, "omp", "bin-path.ts")]);
  });
  test("a plugin of another marketplace that ships omp/bin-path.ts yields no candidate", () => {
    const h = home();
    const p = stub(h, "ossify", 1);
    const f = join(h, ".omp", "plugins", "installed_plugins.json");
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, JSON.stringify({ version: 2, plugins: { "ossify@someone-else": [{ scope: "user", installPath: p }] } }));
    expect(moduleCandidates(h)).toEqual([]);
  });
  test("an entry whose installPath is not a string is skipped, not thrown on", () => {
    const h = home();
    const good = stub(h, "ossify", 1);
    const f = join(h, ".omp", "plugins", "installed_plugins.json");
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, JSON.stringify({ version: 2, plugins: {
      [`workspace-init@${M}`]: [{ scope: "user", installPath: 42 }],
      [`ossify@${M}`]: [{ scope: "user", installPath: good }] } }));
    expect(moduleCandidates(h)).toEqual([join(good, "omp", "bin-path.ts")]);
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
  test("a module whose default factory throws: one warning, load resolves", async () => {
    const h = home();
    record(h, ".omp", { ossify: stub(h, "ossify", 1, 1, `export const VERSION = 1; export default function () { throw new Error("boom"); }`) });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    await load({}, h);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("boom");
    warn.mockRestore();
  });
  test("a module with no default function: one warning, load resolves", async () => {
    const h = home();
    record(h, ".omp", { ossify: stub(h, "ossify", 1, 1, `export const VERSION = 1; export default 7;`) });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    await load({}, h);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("no default factory");
    warn.mockRestore();
  });
});
