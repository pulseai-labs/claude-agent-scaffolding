import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import factory, { apply, resolveBinDirs, ompRecordPath, prependPath, MARKETPLACE } from "./bin-path";

let root: string, ompRecord: string, claudeRecord: string;

function install(name: string, version: string, withBin = true): string {
  const p = join(root, "cache", `${name}-${version}`);
  mkdirSync(withBin ? join(p, "bin") : p, { recursive: true });
  return p;
}
function record(path: string, plugins: Record<string, unknown[]>) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 2, plugins }));
}
const id = (n: string, m = MARKETPLACE) => `${n}@${m}`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pbp-"));
  ompRecord = join(root, "omp", "plugins", "installed_plugins.json");
  claudeRecord = join(root, "claude", "plugins", "installed_plugins.json");
});
const run = () => resolveBinDirs({ ompRecord, claudeRecord });

describe("resolveBinDirs", () => {
  test("an OMP entry adds its bin/", () => {
    const p = install("ossify", "1.15.0");
    record(ompRecord, { [id("ossify")]: [{ scope: "user", installPath: p }] });
    expect(run()).toEqual({ dirs: [join(p, "bin")], warnings: [] });
  });
  test("both records missing warns once and adds nothing", () => {
    const r = run();
    expect(r.dirs).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toStartWith("plugin bin paths not added: ");
  });
  test("a corrupt OMP record warns once and adds nothing, even with a Claude record", () => {
    mkdirSync(join(ompRecord, ".."), { recursive: true });
    writeFileSync(ompRecord, "{not json");
    record(claudeRecord, { [id("ossify")]: [{ scope: "user", installPath: install("ossify", "1.14.5") }] });
    const r = run();
    expect(r.dirs).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });
  test("a missing bin/ skips that plugin with one warning; others apply", () => {
    const a = install("ossify", "1.15.0");
    const b = install("merge-bar", "0.2.0", false);
    record(ompRecord, { [id("ossify")]: [{ scope: "user", installPath: a }], [id("merge-bar")]: [{ scope: "user", installPath: b }] });
    const r = run();
    expect(r.dirs).toEqual([join(a, "bin")]);
    expect(r.warnings).toEqual([`plugin bin path skipped: merge-bar has no bin/ at ${b}`]);
  });
  test("missing OMP record uses the Claude record", () => {
    const p = install("ossify", "1.14.5");
    record(claudeRecord, { [id("ossify")]: [{ scope: "user", installPath: p }] });
    expect(run()).toEqual({ dirs: [join(p, "bin")], warnings: [] });
  });
  test("OMP entry wins over a newer Claude entry", () => {
    const o = install("ossify", "1.15.0");
    const c = install("ossify", "1.16.0");
    record(ompRecord, { [id("ossify")]: [{ scope: "user", installPath: o }] });
    record(claudeRecord, { [id("ossify")]: [{ scope: "user", installPath: c }] });
    expect(run().dirs).toEqual([join(o, "bin")]);
  });
  test("Claude fallback applies only to plugins OMP has no entry for", () => {
    const o = install("ossify", "1.15.0");
    const w = install("workspace-init", "0.7.3");
    record(ompRecord, { [id("ossify")]: [{ scope: "user", installPath: o }] });
    record(claudeRecord, { [id("workspace-init")]: [{ scope: "user", installPath: w }] });
    expect(run().dirs.sort()).toEqual([join(o, "bin"), join(w, "bin")].sort());
  });
  test("entries from other marketplaces are ignored", () => {
    const p = install("ossify", "9.9.9");
    record(ompRecord, { [id("ossify", "someone-else")]: [{ scope: "user", installPath: p }] });
    record(claudeRecord, {});
    expect(run()).toEqual({ dirs: [], warnings: [] });
  });
  test("an entry whose installPath is not a string is skipped, not thrown on", () => {
    const ok = install("ossify", "1.15.0");
    record(ompRecord, { [id("ossify")]: [{ scope: "user", installPath: ok }], [id("workspace-init")]: [{ scope: "user", installPath: 42 }] });
    expect(run()).toEqual({ dirs: [join(ok, "bin")], warnings: [] });
  });
  test("the user-scope entry is preferred over a project-scope one", () => {
    const proj = install("ossify", "1.0.0");
    const user = install("ossify", "1.15.0");
    record(ompRecord, { [id("ossify")]: [{ scope: "project", installPath: proj }, { scope: "user", installPath: user }] });
    expect(run().dirs).toEqual([join(user, "bin")]);
  });
});

describe("ompRecordPath / prependPath", () => {
  test("the OMP record is under $HOME/.omp, whatever PI_CODING_AGENT_DIR says (report 12)", () => {
    expect(ompRecordPath("/h")).toBe("/h/.omp/plugins/installed_plugins.json");
  });
  test("prependPath puts dirs first and drops duplicates", () => {
    expect(prependPath("/a:/b", ["/b", "/c"])).toBe("/b:/c:/a");
  });
});

describe("apply / the default factory", () => {
  test("apply prepends the resolved bin/ dirs to env.PATH", () => {
    const p = install("ossify", "1.15.0");
    record(join(root, "home", ".omp", "plugins", "installed_plugins.json"), { [id("ossify")]: [{ scope: "user", installPath: p }] });
    const env = { PATH: "/usr/bin:/bin" };
    apply(join(root, "home"), env);
    expect(env.PATH).toBe(`${join(p, "bin")}:/usr/bin:/bin`);
  });
  test("apply warns through console.warn and leaves PATH alone when no record exists", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const env = { PATH: "/usr/bin" };
    apply(join(root, "empty-home"), env);
    expect(env.PATH).toBe("/usr/bin");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toStartWith("plugin bin paths not added: ");
    warn.mockRestore();
  });
  test("the default factory uses the process home and writes process.env.PATH (run in a child process)", () => {
    const p = install("ossify", "1.15.0");
    const home = join(root, "home2");
    record(join(home, ".omp", "plugins", "installed_plugins.json"), { [id("ossify")]: [{ scope: "user", installPath: p }] });
    const r = Bun.spawnSync([process.execPath, "-e", `import f from ${JSON.stringify(join(import.meta.dir, "bin-path.ts"))}; f({}); console.log(process.env.PATH)`],
      { env: { HOME: home, PATH: "/usr/bin" }, stdout: "pipe", stderr: "pipe" });
    expect(r.stderr.toString()).toBe("");
    expect(r.stdout.toString().trim()).toBe(`${join(p, "bin")}:/usr/bin`);
  });
});
