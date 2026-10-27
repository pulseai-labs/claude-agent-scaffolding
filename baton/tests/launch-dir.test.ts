import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LaunchError } from "../src/host.ts";
import { bindLaunchDir, git, isLaunchDir, real, releaseLaunchDir } from "../src/hosts/launch-dir.ts";

let root: string;
let state: string;
let savedState: string | undefined;

beforeEach(() => {
  savedState = process.env.BATON_STATE_DIR;
  const base = realpathSync(mkdtempSync(join(tmpdir(), "baton-launchdir-")));
  root = join(base, "repo");
  state = join(base, "state");
  mkdirSync(root);
  mkdirSync(state);
  process.env.BATON_STATE_DIR = state;
  for (const args of [["init", "-q", "-b", "main"], ["config", "user.email", "t@example.com"], ["config", "user.name", "t"], ["commit", "-q", "--allow-empty", "-m", "init"]]) {
    const r = git(root, ...args);
    if (!r.ok) throw new Error(`git ${args.join(" ")}: ${r.err}`);
  }
});

afterEach(() => {
  if (savedState === undefined) delete process.env.BATON_STATE_DIR;
  else process.env.BATON_STATE_DIR = savedState;
});

const listed = () => git(root, "worktree", "list", "--porcelain").out.split("\n");

function refusal(fn: () => unknown): LaunchError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(LaunchError);
    return e as LaunchError;
  }
  throw new Error("expected a LaunchError");
}

describe("bindLaunchDir", () => {
  test("a cwd other than the root is returned as given, with no worktree made", () => {
    const other = join(root, "..", "elsewhere");
    mkdirSync(other);
    expect(bindLaunchDir(root, other, "r1/u1/plan/1", "worktree")).toBe(other);
    expect(existsSync(join(state, "launch"))).toBe(false);
  });

  test("root mode returns cwd", () => {
    expect(bindLaunchDir(root, root, "r1/u1/plan/1", "root")).toBe(root);
    expect(existsSync(join(state, "launch"))).toBe(false);
  });

  test("worktree mode makes <state>/launch/<encoded nonce>, listed by git", () => {
    const dir = bindLaunchDir(root, root, "r/u/s/1", "worktree");
    expect(dir).toBe(join(state, "launch", "r%2Fu%2Fs%2F1"));
    expect(existsSync(dir)).toBe(true);
    expect(listed()).toContain(`worktree ${real(dir)}`);
  });

  test("an existing listed dir is reused", () => {
    const a = bindLaunchDir(root, root, "r/u/s/2", "worktree");
    const b = bindLaunchDir(root, root, "r/u/s/2", "worktree");
    expect(b).toBe(a);
    expect(listed().filter((l) => l.startsWith("worktree ")).length).toBe(2); // the root and one launch dir
  });

  test("an existing unlisted dir is refused", () => {
    const dir = join(state, "launch", "r%2Fu%2Fs%2F3");
    mkdirSync(dir, { recursive: true });
    const e = refusal(() => bindLaunchDir(root, root, "r/u/s/3", "worktree"));
    expect(e.message).toBe(`launch directory exists but is not a worktree of ${root}: ${dir}`);
  });
});

describe("releaseLaunchDir", () => {
  test("a dir bind did not make is refused", () => {
    const foreign = join(root, "..", "foreign");
    mkdirSync(foreign);
    const e = refusal(() => releaseLaunchDir(root, foreign));
    expect(e.message.startsWith("refusing to remove a directory bind did not make")).toBe(true);
    expect(existsSync(foreign)).toBe(true);
  });

  test("a launch dir is removed", () => {
    const dir = bindLaunchDir(root, root, "r/u/s/4", "worktree");
    expect(isLaunchDir(dir)).toBe(true);
    releaseLaunchDir(root, dir);
    expect(existsSync(dir)).toBe(false);
    expect(listed()).not.toContain(`worktree ${real(dir)}`);
  });

  test("releasing cwd itself is a no-op", () => {
    releaseLaunchDir(root, root);
    expect(existsSync(root)).toBe(true);
  });
});

describe("isLaunchDir", () => {
  test("true under <state>/launch, false for the root and for the launch parent itself", () => {
    expect(isLaunchDir(join(state, "launch", "x"))).toBe(true);
    expect(isLaunchDir(root)).toBe(false);
    expect(isLaunchDir(join(state, "launch"))).toBe(false);
  });
});
