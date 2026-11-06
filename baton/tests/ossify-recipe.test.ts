// The example ossify-spine recipe (baton/examples/ossify-spine/recipe.json), pinned
// structurally: the claim every seat carries, the roles, where each stage launches, the
// dispatch count and cap, the R7 gap re-entry, the land order, and the build slot.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, validate, type MergeStage, type Recipe, type SessionStage, type WaitStage } from "../src/recipe.ts";
import { loadRecipe, raw, RECIPE_PATH, renderStageEnv } from "./ossify-recipe-helpers.ts";

const BIN = join(import.meta.dir, "..", "bin", "baton");

const SESSION_STAGES = [
  "lane", "implement", "regap", "verify", "close", "correct",
  "spine_open", "spine_review", "spine_work", "spine_finish",
  "item_review", "item_fix",
];

function sessions(r: Recipe): [string, SessionStage][] {
  return Object.entries(r.stages).filter(([, s]) => s.kind === "session") as [string, SessionStage][];
}
const rolesOf = (r: Recipe) => Object.fromEntries(sessions(r).map(([n, s]) => [n, s.env.SEAT_MODS_ROLE]));

const OUT = "{run.dir}/out/{unit.id}";
const DISPATCHED = ["env", "-C", "{param.ai_root}", "{param.oss}", "work_item_dispatched", "{unit.id}"];
const CAP_CHECK = [
  "jq", "-e", "--arg", "w", "{unit.id}",
  "any(.work_items[]; .id == $w and (.dispatches // 0) < 3)", "{param.state_file}",
];

const PARAMS: Record<string, string> = {
  spine: "r0.s6", spine_branch: "spine/r0.s6-demo", spine_dir: "/ai/docs/spines/r0.s6",
  ai_root: "/ai", ai_project: "demo-ai", repo: "/canon", project: "demo", state_file: "/ai/.ossify/project-state.json",
  oss: "/bin/oss", briefs: "/briefs",
};

// Spec D2: each session stage and the driver name a crew role, verbatim.
const STAGE_ROLES: Record<string, string> = {
  lane: "spine session", regap: "spine session",
  implement: "implementer", correct: "implementer",
  verify: "verifier",
  close: "close session", spine_open: "close session", spine_finish: "close session",
  spine_review: "reviewer",
  spine_work: "work-PR session",
  item_review: "item reviewer", item_fix: "work-PR session",
};
const stageRoles = (r: Recipe) => ({
  ...Object.fromEntries(sessions(r).map(([n, s]) => [n, s.role])),
  driver: r.driver?.role,
});

/** Agent or harness names in a recipe's text: the recipe names roles, never agents. */
const agentNames = (text: string): string[] => [...text.matchAll(/omp-|claude-|devin/gi)].map((m) => m[0]);

/** A verdict signal's name: the verdict it reads. Any other exit0 signal: its first two arguments after the program. */
const exit0Name = (argv: string[]): string => (argv[0] === "sh" ? argv.at(-1)! : argv.slice(1, 3).join(" "));

describe("ossify-spine recipe", () => {
  test("ossify recipe validates", async () => {
    expect(validate(raw()).ok).toBe(true);
    const p = Bun.spawn([BIN, "validate", RECIPE_PATH], { stdout: "pipe", stderr: "pipe" });
    const [err, rc] = await Promise.all([new Response(p.stderr).text(), p.exited]);
    expect(err).toBe("");
    expect(rc).toBe(0);
  });

  test("the session stages are exactly the table's", () => {
    expect(sessions(loadRecipe()).map(([n]) => n).sort()).toEqual([...SESSION_STAGES].sort());
  });

  test("no literal brace outside a placeholder", () => {
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(raw());
    const stray = strings.filter((s) => /[{}]/.test(s.replace(/\{[^{}]*\}/g, "")));
    expect(stray).toEqual([]);
  });

  test("every-session-stage-has-role: the D2 role, and no instance or model", () => {
    const r = loadRecipe();
    expect(stageRoles(r)).toEqual({ ...STAGE_ROLES, driver: "driver" });
    const launchers: [string, Record<string, unknown>][] = [
      ...Object.entries(raw().stages as Record<string, Record<string, unknown>>).filter(([, s]) => s.kind === "session"),
      ["driver", raw().driver],
    ];
    for (const [name, s] of launchers) {
      for (const k of ["instance", "model"]) expect([name, k, k in s]).toEqual([name, k, false]);
      const env = s.env as Record<string, string>;
      for (const k of ["OMP_T3_SEAT", "OMP_T3_VIA"]) expect([name, k, k in env]).toEqual([name, k, false]);
    }
    expect(raw().params).not.toContain("via");
    // control: the same comparison fails on a copy where verify names the implementer role
    const copy = structuredClone(r);
    (copy.stages.verify as SessionStage).role = "implementer";
    expect(stageRoles(copy)).not.toEqual({ ...STAGE_ROLES, driver: "driver" });
  });

  test("no-agent-names-in-recipe", () => {
    expect(agentNames(readFileSync(RECIPE_PATH, "utf8"))).toEqual([]);
    // control: the scan finds each kind of name it looks for
    expect(agentNames('"via": "omp-glm-flash", "x": "claude-sonnet-high", "y": "Devin"')).toEqual(["omp-", "claude-", "Devin"]);
  });

  test("every session stage but verify runs molt as a child", () => {
    for (const [name, s] of sessions(loadRecipe())) {
      const where = `stage ${name}`;
      expect([where, s.stop_file]).toEqual([where, `${OUT}/stop`]);
      expect([where, s.env.SPINE_STOP_FILE]).toEqual([where, `${OUT}/stop`]);
      expect([where, s.before?.[0]]).toEqual([where, ["mkdir", "-p", OUT]]);
      if (name === "verify") continue; // its seat writes only OUT and the worktree; no molt, no ledger
      expect([where, s.env.MOLT_HANDOFF]).toEqual([where, "parent"]);
      expect(s.handoff).not.toBeNull();
      expect([where, s.handoff!.file]).toEqual([where, `${OUT}/molt.log`]);
      expect([where, s.env.MOLT_STATUS_PATH]).toEqual([where, s.handoff!.file]);
      expect([where, s.env.SPINE_LEDGER]).toEqual([where, "{param.spine_dir}/autopilot-ledger.md"]);
    }
  });

  test("verify-writes-only-its-out: no ledger, no molt, the stop file inside its write allowance", () => {
    const v = loadRecipe().stages.verify as SessionStage;
    expect(Object.keys(v.env).sort()).toEqual(["OSSIFY_VERIFY_WORKTREE", "SEAT_MODS_ALLOW", "SEAT_MODS_ROLE", "SPINE_STOP_FILE"]);
    expect(v.handoff ?? null).toBeNull();
    expect(v.env.SPINE_STOP_FILE.startsWith(`${v.env.SEAT_MODS_ALLOW}/`)).toBe(true);
    expect(v.message).not.toContain("Ledger:");
    // control: another session stage still carries the ledger
    expect((loadRecipe().stages.implement as SessionStage).env.SPINE_LEDGER).toBe("{param.spine_dir}/autopilot-ledger.md");
  });

  const ROLES = {
    lane: "coordinator", regap: "coordinator", spine_open: "coordinator", spine_finish: "coordinator",
    implement: "implementer", close: "implementer", correct: "implementer",
    spine_work: "implementer", spine_review: "reviewer", verify: "verifier",
    item_review: "reviewer", item_fix: "implementer",
  };

  test("roles match the table", () => {
    expect(rolesOf(loadRecipe())).toEqual(ROLES);
    // adjacent control: the same assertion fails on a copy with regap as an implementer
    const copy = structuredClone(loadRecipe());
    (copy.stages.regap as SessionStage).env.SEAT_MODS_ROLE = "implementer";
    expect(rolesOf(copy)).not.toEqual(ROLES);
  });

  test("root launch is exactly the AI-root and spine-push stages", () => {
    const r = loadRecipe();
    const root = sessions(r).filter(([, s]) => s.launch_dir === "root").map(([n]) => n).sort();
    expect(root).toEqual(["close", "lane", "regap", "spine_finish", "spine_open", "spine_work"]);
    for (const n of ["implement", "correct", "verify", "spine_review", "item_review", "item_fix"]) {
      expect([n, (r.stages[n] as SessionStage).launch_dir]).toEqual([n, "worktree"]);
    }
  });

  test("implementer claim allows the item spec dir", () => {
    for (const stage of ["implement", "correct"]) {
      const env = renderStageEnv(stage, { id: "r0.s6.w1", vars: { worktree_path: "/wt/w1" } }, PARAMS);
      const allow = env.SEAT_MODS_ALLOW.split(":");
      expect([stage, allow]).toEqual([stage, ["/ai/docs/spines/r0.s6/work-r0.s6.w1", "/runs/run1/out/r0.s6.w1"]]);
    }
  });

  test("every write allowance matches the table", () => {
    const item = `{param.spine_dir}/work-{unit.id}:${OUT}`;
    const allow = Object.fromEntries(sessions(loadRecipe()).map(([n, s]) => [n, s.env.SEAT_MODS_ALLOW]));
    expect(allow).toEqual({
      lane: OUT, regap: OUT, verify: OUT, close: OUT, spine_open: OUT, spine_review: OUT, spine_finish: OUT,
      implement: item, correct: item, spine_work: `${OUT}:{param.spine_dir}`,
      item_review: OUT, item_fix: OUT,
    });
  });

  test("only implement and correct count, after launch", () => {
    const r = loadRecipe();
    for (const [name, s] of sessions(r)) {
      if (name === "implement" || name === "correct") {
        expect([name, s.after_launch]).toEqual([name, [DISPATCHED]]);
        expect([name, s.before?.[1]]).toEqual([name, CAP_CHECK]);
      } else {
        expect([name, s.after_launch ?? []]).toEqual([name, []]);
      }
      for (const argv of s.before ?? []) expect([name, argv.includes("work_item_dispatched")]).toEqual([name, false]);
    }
  });

  test("gap re-entry carries the R7 signal", () => {
    const w = loadRecipe().stages.gap_wait as WaitStage;
    expect(w.kind).toBe("wait");
    expect(w.outcomes[0].to).toBe("regap");
    expect(w.outcomes[0].when).toContainEqual({ active: "none-in-group" });
    expect(w.outcomes[0].when).toContainEqual({
      // a sibling in implement holds the gap even before its session starts (waiting on a slot,
      // or just re-entered from its own regap); regap holds it so two re-entries never overlap
      // verify mutates the worktree and close commits it, so both hold the gap as correct does
      units: { group: "{run.group}", stages: ["implement", "regap", "verify", "close", "correct"], count: "none" },
    });
  });

  test("verify-between-implement-and-close", () => {
    const r = raw();
    const VERDICT = `${OUT}/verdict.json`;
    expect(r.stages.implement.outcomes[0]).toEqual({ when: [{ file: "{param.spine_dir}/work-{unit.id}/report.md" }], to: "verify" });
    const v = r.stages.verify;
    expect([v.kind, v.cwd, v.launch_dir, v.project]).toEqual(["session", "{unit.vars.worktree_path}", "worktree", "{param.project}"]);
    expect(v.outcomes).toEqual([{ when: [{ file: VERDICT }], to: "close" }]);
    // a verdict from the last pass never routes this one: it moves aside before every launch,
    // and stays as verdict-<n>.json for whoever asks why the item took two rounds (#1005)
    expect(v.before[0]).toEqual(["mkdir", "-p", OUT]);
    expect(v.before[1].slice(3)).toEqual(["sh", OUT, "verdict", ".json"]);
    // the mutation check runs tests, so verify holds the build slot
    expect(v.slots).toEqual(["session", "build"]);
    expect(v.env.OSSIFY_VERIFY_WORKTREE).toBe("{unit.vars.worktree_path}");
    const env = renderStageEnv("verify", { id: "r0.s6.w1", vars: { worktree_path: "/wt/w1" } }, PARAMS);
    expect([env.OSSIFY_VERIFY_WORKTREE, env.SEAT_MODS_ROLE, env.SEAT_MODS_ALLOW]).toEqual(["/wt/w1", "verifier", "/runs/run1/out/r0.s6.w1"]);
    for (const field of ["{param.briefs}/verify.md", "{agent.name}", `Verdict file: ${VERDICT}.`, "{unit.vars.handoff_path}",
      "{unit.vars.worktree_path}", "{unit.vars.base_sha}", "Report: {param.spine_dir}/work-{unit.id}/report.md."]) {
      expect([field, v.message.includes(field)]).toEqual([field, true]);
    }
    expect(r.stages.close.message).toContain(`Verdict file: ${VERDICT}.`);
  });

  test("the verdict and packet archive takes the next free number and needs no file", () => {
    const argv: string[] = raw().stages.verify.before[1];
    const dir = mkdtempSync(join(tmpdir(), "baton-archive-"));
    const run = () => spawnSync(argv[0], [argv[1], argv[2], argv[3], dir, "verdict", ".json"]).status;
    expect(run()).toBe(0); // nothing to keep yet: the first pass
    expect(readdirSync(dir)).toEqual([]);
    writeFileSync(join(dir, "verdict.json"), "one");
    expect(run()).toBe(0);
    writeFileSync(join(dir, "verdict.json"), "two");
    expect(run()).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(["verdict-1.json", "verdict-2.json"]);
    expect(readFileSync(join(dir, "verdict-1.json"), "utf8")).toBe("one"); // never overwritten
    expect(readFileSync(join(dir, "verdict-2.json"), "utf8")).toBe("two");
    rmSync(dir, { recursive: true });
  });

  test("correct-returns-to-verify", () => {
    const r = raw();
    expect("reclose" in r.stages).toBe(false);
    expect(r.stages.correct.outcomes.map((o: { to: string }) => o.to)).toEqual(["verify"]);
    expect(JSON.stringify(r)).not.toContain("reclose");
    expect(r.driver.resume_to).toEqual({ correct: ["verify"] });
  });

  test("a red close routes to correct through the correction packet", () => {
    const PACKET = `${OUT}/correction.txt`;
    const PR_RECORDED = [
      "jq", "-e", "--arg", "w", "{unit.id}",
      'any(.work_items[]; .id == $w and (.pr_url | type) == "string")', "{param.state_file}",
    ];
    const r = raw();
    for (const name of ["close"]) {
      const s = r.stages[name];
      // the packet is the only route to correct: no verify.md grep, so a stale one cannot re-route
      // (each outcome also carries the Ruling file archive, pinned in its own test, #1057)
      expect([name, s.outcomes.map(({ run: _run, ...o }: any) => o)]).toEqual([name, [
        { when: [{ exit0: PR_RECORDED }], to: "item_ready" },
        { when: [{ file: PACKET }], to: "correct" },
      ]]);
      for (const field of ["{unit.vars.handoff_path}", "{unit.vars.worktree_path}", "{unit.vars.branch}", "{unit.vars.base_sha}", `Correction packet: ${PACKET}.`]) {
        expect([name, field, s.message.includes(field)]).toEqual([name, field, true]);
      }
    }
    const c = r.stages.correct;
    expect(c.message).toContain(`Correction packet: ${PACKET}.`);
    // cleared on the way to verify, never before a launch: a relaunched correction still reads it
    // the used packet stays as correction-<n>.txt, and no packet remains to route a later close (#1005)
    expect(c.outcomes[0].run[0]).toEqual(["rm", "-f", `${OUT}/corrected`]);
    expect(c.outcomes[0].run[1].slice(3)).toEqual(["sh", OUT, "correction", ".txt"]);
    expect(c.before.flat()).not.toContain(PACKET);
  });

  test("the spine PR wait parks a conflict and keeps its order", () => {
    const w = loadRecipe().stages.spine_wait as WaitStage;
    const shape = w.outcomes.map((o) => [
      o.to, ...o.when.map((sig) => ("pr" in sig ? sig.pr.test : "exit0" in sig ? exit0Name(sig.exit0) : "?")),
    ]);
    expect(shape).toEqual([
      ["spine_finish", "merged"],
      ["park", "closed"],
      ["park", "conflict"], // spine_work runs as an implementer: no merge, no force-push, so it cannot resolve one
      ["spine_work", "checks_red"],
      ["spine_work", "verdict: block", "checks_green"],
      ["spine_ack", "verdict: pass", "checks_green", "mergeable"],
    ]);
  });

  test("a spine PR round's end saves the review as review-prev.md, archives the Ruling file, then clears the signals (#1045)", () => {
    const run = (loadRecipe().stages.spine_work as SessionStage).outcomes[0].run!;
    // the signals' absence is state (spine_review and spine_wait read review.md): still removed, last
    expect(run).toHaveLength(3);
    expect(run[2]).toEqual(["rm", "-f", `${OUT}/review.md`, `${OUT}/round-done`, `${OUT}/operator.md`]);
    expect(run[0].slice(0, 2)).toEqual(["sh", "-c"]);
    expect(run[0].slice(3)).toEqual(["sh", OUT]);
    expect(run[1].slice(3)).toEqual(["sh", OUT, "operator", ".md"]);
  });

  test("the round's run hooks, executed: review-prev.md is the last review, operator.md is archived once per round (#1045)", () => {
    const run = (loadRecipe().stages.spine_work as SessionStage).outcomes[0].run!;
    const dir = mkdtempSync(join(tmpdir(), "baton-round-"));
    const exec = () => {
      for (const argv of run) {
        const argvHere = argv.map((a) => a.replaceAll(OUT, dir));
        const p = Bun.spawnSync(argvHere, { stdout: "pipe", stderr: "pipe" });
        expect([argvHere[0], p.exitCode, p.stderr.toString()]).toEqual([argvHere[0], 0, ""]);
      }
    };
    const put = (f: string, t: string) => writeFileSync(join(dir, f), t);
    const ls = () => readdirSync(dir).sort();
    // round 1: a review and a ruling
    put("review.md", "verdict: block\nhead: a1\n"); put("round-done", ""); put("operator.md", "ruling one");
    exec();
    expect(ls()).toEqual(["operator-1.md", "review-prev.md"]);
    expect(readFileSync(join(dir, "review-prev.md"), "utf8")).toBe("verdict: block\nhead: a1\n");
    expect(readFileSync(join(dir, "operator-1.md"), "utf8")).toBe("ruling one");
    // round 2: a newer review replaces the previous one; a second ruling does not overwrite the first
    put("review.md", "verdict: block\nhead: b2\n"); put("round-done", ""); put("operator.md", "ruling two");
    exec();
    expect(ls()).toEqual(["operator-1.md", "operator-2.md", "review-prev.md"]);
    expect(readFileSync(join(dir, "review-prev.md"), "utf8")).toBe("verdict: block\nhead: b2\n");
    expect(readFileSync(join(dir, "operator-1.md"), "utf8")).toBe("ruling one");
    expect(readFileSync(join(dir, "operator-2.md"), "utf8")).toBe("ruling two");
    // round 3: no ruling, no review file: the hooks still succeed and the previous review is kept
    put("round-done", "");
    exec();
    expect(ls()).toEqual(["operator-1.md", "operator-2.md", "review-prev.md"]);
    expect(readFileSync(join(dir, "review-prev.md"), "utf8")).toBe("verdict: block\nhead: b2\n");
    rmSync(dir, { recursive: true });
  });

  test("the five ruling stages name the Ruling file at their own {unit.id} path (#1057)", () => {
    const r = loadRecipe();
    for (const n of ["close", "spine_open", "spine_finish", "spine_work", "item_fix"]) {
      const m = (r.stages[n] as SessionStage).message;
      expect(m).toContain(`Ruling file: ${OUT}/operator.md. `);
      expect(m).not.toMatch(/operator file/i);
    }
    expect("Operator file: x").toMatch(/operator file/i); // control: the probe catches either case of the retired label
    // the unit ids behind {unit.id}: spine_open runs on the lane, spine_finish on the spine PR
    expect(raw().seed[0]).toEqual({ id: "lane", stage: "lane" });
  });

  const ARCHIVE_OPERATOR = ["sh", OUT, "operator", ".md"];
  test("every outcome of close, spine_open, spine_finish and item_fix archives the Ruling file (#1057)", () => {
    const r = loadRecipe();
    for (const n of ["close", "spine_open", "spine_finish", "item_fix"]) {
      const outs = (r.stages[n] as SessionStage).outcomes;
      expect(outs.length).toBeGreaterThan(0);
      for (const o of outs) {
        const hooks = o.run ?? [];
        expect(hooks.filter((a) => a.slice(0, 2).join(" ") === "sh -c" && JSON.stringify(a.slice(3)) === JSON.stringify(ARCHIVE_OPERATOR))).toHaveLength(1);
      }
    }
    expect((r.stages.close as SessionStage).outcomes.map((o) => o.to)).toEqual(["item_ready", "correct"]);
  });

  /** Every hook of the recipe that is the archive script: `sh -c <script> sh <dir> <name> <ext>`, as [where, argv]. */
  const archiveHooks = (r: Recipe): [string, string[]][] => {
    const out: [string, string[]][] = [];
    for (const [n, st] of Object.entries(r.stages)) {
      if (st.kind !== "session") continue;
      (st.before ?? []).forEach((a, i) => out.push([`${n}.before[${i}]`, a]));
      st.outcomes.forEach((o, i) => (o.run ?? []).forEach((a, k) => out.push([`${n}.outcomes[${i}].run[${k}]`, a])));
    }
    return out.filter(([, a]) => a[0] === "sh" && a[1] === "-c" && a.length === 7 && a[3] === "sh" && a[4] === OUT);
  };
  test("every archive hook runs the one script spine_finish's does, which a test above executes (#1075 C1)", () => {
    const r = loadRecipe();
    const script = (r.stages.spine_finish as SessionStage).outcomes[0].run![0][2];
    const hooks = archiveHooks(r);
    expect(hooks.map(([w]) => w).sort()).toEqual([
      "close.outcomes[0].run[0]", "close.outcomes[1].run[0]", "correct.outcomes[0].run[1]", "item_fix.outcomes[0].run[0]",
      "spine_finish.outcomes[0].run[0]", "spine_finish.outcomes[1].run[0]", "spine_open.outcomes[0].run[0]", "spine_work.outcomes[0].run[1]", "verify.before[1]",
    ]);
    for (const [where, a] of hooks) expect([where, a[2]]).toEqual([where, script]);
    // control: a copy whose one hook runs another script is caught by the same comparison
    const copy = structuredClone(r);
    (copy.stages.close as SessionStage).outcomes[1].run![0][2] = "exit 0";
    expect(archiveHooks(copy).filter(([, a]) => a[2] !== script).map(([w]) => w)).toEqual(["close.outcomes[1].run[0]"]);
  });

  test("the run hooks of close, spine_open and spine_finish are exactly the archive and, for close's land, the pr_url write (#1075 C4)", () => {
    const r = loadRecipe();
    const archive = (r.stages.spine_finish as SessionStage).outcomes[0].run![0];
    const archiveOf = ["sh", "-c", archive[2], "sh", OUT, "operator", ".md"];
    const prUrlHook = ["sh", "-c",
      `u=$(jq -er --arg w "$2" '.work_items[] | select(.id == $w) | .pr_url' "$1") && jq --arg u "$u" '.pr_url = $u' "$3" > "$3.tmp" && mv -- "$3.tmp" "$3"`,
      "sh", "{param.state_file}", "{unit.id}", "{run.dir}/queue/{unit.id}.json"];
    const runs = (n: string) => (r.stages[n] as SessionStage).outcomes.map((o) => o.run);
    expect(runs("close")).toEqual([[archiveOf, prUrlHook], [archiveOf]]);
    expect(runs("spine_open")).toEqual([[archiveOf]]);
    expect(runs("spine_finish")).toEqual([[archiveOf], [archiveOf]]);
    // control: a hook list with one extra command no longer equals the pin
    expect([[archiveOf, ["rm", "-rf", OUT]]]).not.toEqual(runs("spine_finish"));
  });

  // ---- #1095: spine_finish reads origin/main, never the local state file ----------------------
  /** The first outcome's origin/main condition of spine_finish: the argv of its one exit0 signal. */
  const originClosed = (r: Recipe): string[] => (r.stages.spine_finish as SessionStage).outcomes[0].when.map((sg) => ("exit0" in sg ? sg.exit0 : []))[0];
  const gitIn = (cwd: string, ...a: string[]) => {
    const p = spawnSync("git", a, { cwd, encoding: "utf8" });
    if (p.status !== 0) throw new Error(`git ${a.join(" ")}: ${p.stderr}`);
    return p.stdout.trim();
  };
  /** A bare origin, a clone of it holding .ossify/project-state.json, and a runner for the condition's argv in that clone. */
  function stateRepo(originStatus: string | null) {
    const dir = mkdtempSync(join(tmpdir(), "baton-origin-closed-"));
    const origin = join(dir, "origin.git"), ai = join(dir, "ai");
    gitIn(dir, "init", "-q", "--bare", "-b", "main", origin);
    gitIn(dir, "clone", "-q", origin, ai);
    for (const [k, v] of [["user.email", "t@example.com"], ["user.name", "t"], ["commit.gpgsign", "false"]]) gitIn(ai, "config", k, v);
    mkdirSync(join(ai, ".ossify"));
    const sf = join(ai, ".ossify", "project-state.json");
    const write = (status: string) => writeFileSync(sf, JSON.stringify({ spines: [{ id: "r0.s6", status }] }));
    write(originStatus ?? "planned");
    gitIn(ai, "add", "."); gitIn(ai, "commit", "-q", "-m", "state"); gitIn(ai, "push", "-q", "origin", "main");
    const rc = (spine = "r0.s6", file = sf) => {
      const argv = originClosed(loadRecipe()).map((a) => a.replace("{param.state_file}", file).replace("{param.spine}", spine));
      return spawnSync(argv[0], argv.slice(1), { cwd: ai, encoding: "utf8" }).status;
    };
    return { dir, ai, origin, sf, write, rc };
  }
  test("spine_finish's first outcome reads the state file at origin/main: 0 closed there, 1 not, 2 on every error (#1095)", () => {
    const t = stateRepo(null);
    expect(t.rc()).toBe(1); // origin reads planned
    // the #1095 control: closed only in the local file, uncommitted, and then committed on a branch that is not origin/main; the old local jq read 0 here
    t.write("closed");
    expect(t.rc()).toBe(1);
    gitIn(t.ai, "checkout", "-q", "-b", "docs/close"); gitIn(t.ai, "commit", "-q", "-am", "close");
    expect(t.rc()).toBe(1);
    expect(spawnSync("jq", ["-e", ".spines[] | select(.id == \"r0.s6\") | .status == \"closed\"", t.sf]).status).toBe(0); // the old form says done
    // origin/main closed: another clone pushes it
    const other = join(t.dir, "other");
    gitIn(t.dir, "clone", "-q", t.origin, other);
    for (const [k, v] of [["user.email", "t@example.com"], ["user.name", "t"], ["commit.gpgsign", "false"]]) gitIn(other, "config", k, v);
    writeFileSync(join(other, ".ossify", "project-state.json"), JSON.stringify({ spines: [{ id: "r0.s6", status: "closed" }] }));
    gitIn(other, "commit", "-q", "-am", "closed"); gitIn(other, "push", "-q", "origin", "main");
    expect(t.rc()).toBe(0); // fetch-first: the clone had not seen it
    expect(t.rc("r9.s9")).toBe(2); // an unknown spine
    writeFileSync(join(other, ".ossify", "project-state.json"), "{nope");
    gitIn(other, "commit", "-q", "-am", "bad"); gitIn(other, "push", "-q", "origin", "main");
    expect(t.rc()).toBe(2); // bad JSON
    expect(t.rc("r0.s6", join(t.ai, ".ossify", "missing.json"))).toBe(2); // a path origin does not hold
    // N5: the fetch fails while a stale origin/main ref still exists (bad JSON is already there): rc 2, never a silent false
    writeFileSync(join(other, ".ossify", "project-state.json"), JSON.stringify({ spines: [{ id: "r0.s6", status: "planned" }] }));
    gitIn(other, "commit", "-q", "-am", "ok"); gitIn(other, "push", "-q", "origin", "main");
    expect(t.rc()).toBe(1); // control: a good fetch reads planned
    gitIn(t.ai, "remote", "set-url", "origin", join(t.dir, "nowhere.git"));
    expect(gitIn(t.ai, "rev-parse", "--verify", "origin/main")).toMatch(/^[0-9a-f]{40}$/); // the stale ref is still there
    expect(t.rc()).toBe(2);
    gitIn(t.ai, "remote", "remove", "origin");
    expect(t.rc()).toBe(2); // no origin remote: every error parks
    rmSync(t.dir, { recursive: true, force: true });
  });

  test("spine_finish ends done on origin/main and goes to spine_close_wait on close-pr.txt; the wait parks every other state (#1095)", () => {
    const r = loadRecipe();
    const fin = r.stages.spine_finish as SessionStage;
    expect(fin.outcomes.map((o) => [o.to, o.when.map((sg) => Object.keys(sg)[0])])).toEqual([["done", ["exit0"]], ["spine_close_wait", ["file"]]]);
    expect(fin.outcomes[1].when).toEqual([{ file: `${OUT}/close-pr.txt` }]);
    const w = r.stages.spine_close_wait as WaitStage;
    expect(w.kind).toBe("wait");
    const url = ["sed", "-n", "1p", `${OUT}/close-pr.txt`];
    const pr = (test: string) => ({ pr: { url, test } });
    expect(w.outcomes.map((o) => [o.to, o.when.map((sg) => ("pr" in sg ? sg.pr.test : "exit0" in sg ? "origin" : "?"))])).toEqual([
      ["done", ["merged", "origin"]], ["park", ["merged"]], ["park", ["closed"]], ["park", ["conflict"]],
    ]);
    expect(w.outcomes[0].when[0]).toEqual(pr("merged"));
    expect(w.outcomes[0].when[1]).toEqual({ exit0: originClosed(r) }); // the one condition, not a second copy
    for (const o of w.outcomes.slice(1)) expect(o.when[0]).toEqual(pr(("pr" in o.when[0] ? o.when[0].pr.test : "")));
    expect(w.outcomes.map((o) => o.run)).toEqual([undefined, undefined, undefined, undefined]); // the entry outcome already archived the ruling
    expect(w.outcomes[0].notify).toContain("origin/main");
    expect(fin.outcomes[1].notify).toContain("close-pr.txt");
  });

  test("the archive hook of a non-spine_work stage, executed: once per stage end, every ruling kept under its own number, no file needed (#1057)", () => {
    const hook = (loadRecipe().stages.spine_finish as SessionStage).outcomes[0].run![0];
    const dir = mkdtempSync(join(tmpdir(), "baton-ruling-"));
    const exec = () => {
      const argv = hook.map((a) => a.replaceAll(OUT, dir));
      const p = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
      expect([p.exitCode, p.stderr.toString()]).toEqual([0, ""]);
    };
    exec(); // no ruling: succeeds, creates nothing
    expect(readdirSync(dir)).toEqual([]);
    writeFileSync(join(dir, "operator.md"), "pass d3");
    exec();
    expect(readdirSync(dir).sort()).toEqual(["operator-1.md"]);
    writeFileSync(join(dir, "operator.md"), "second");
    exec();
    expect(readdirSync(dir).sort()).toEqual(["operator-1.md", "operator-2.md"]);
    expect(readFileSync(join(dir, "operator-1.md"), "utf8")).toBe("pass d3"); // never overwritten
    expect(readFileSync(join(dir, "operator-2.md"), "utf8")).toBe("second");
    rmSync(dir, { recursive: true });
  });

  test("spine_review is told the previous review's fixed path, after the PR argument (#1045)", () => {
    const msg = (loadRecipe().stages.spine_review as SessionStage).message;
    expect(msg).toContain(` previous: ${OUT}/review-prev.md Then read`);
    expect(flat(brief("spine-review.md"))).toContain("A missing file means round 1");
    expect(flat(brief("spine-work.md"))).toContain("write it into the PR body");
    // control: a pin read through flat() survives a wrap in the source; a raw read would not
    expect(flat("A missing file\n  means round 1")).toContain("A missing file means round 1");
    expect("A missing file\n  means round 1").not.toContain("A missing file means round 1");
  });

  // ---- the item PR review loop (#1046) ----------------------------------------------------------
  const ITEM_PR = ["env", "-C", "{param.ai_root}", "{param.oss}", "get", '.work_items[] | select(.id == "{unit.id}") | .pr_url'];
  const REVIEW = `${OUT}/review.md`;
  const REVIEW2 = `${OUT}/review-2.md`;
  /** The review-3 cap signal: the file every cap clause of item_wait and item_moved opens with. */
  const w2first = () => (loadRecipe().stages.item_wait as WaitStage).outcomes[1].when[0];
  const sigName = (sig: any): string =>
    "pr" in sig ? sig.pr.test : "file" in sig ? `file ${sig.file.slice(OUT.length + 1)}` : exit0Name(sig.exit0);
  /** item_wait's route table as [to, ...signal names] rows. */
  const itemWaitShape = (w: WaitStage) => w.outcomes.map((o) => [o.to, ...o.when.map(sigName)]);
  const ITEM_WAIT_SHAPE = [
    ["land", "merged"],
    ["park", "file review-2.md", "verdict: block"],
    ["park", "closed"],
    ["park", "conflict"],
    ["park", "file review-2.md", "checks_red"],
    ["item_fix", "checks_red"],
    ["item_fix", "verdict: block", "checks_green"],
    ["land", "verdict: pass", "checks_green"],
  ];

  test("item_wait's route table, in order: merged, the review-3 block stop, closed, conflict, the review-3 red stop, red, block, pass (#1079 C3b, C4)", () => {
    const w = loadRecipe().stages.item_wait as WaitStage;
    expect(itemWaitShape(w)).toEqual(ITEM_WAIT_SHAPE);
    // every pr signal reads the PR from ossify's state, as land does: the wait and the merge judge the same PR
    // (the item unit also carries a pr_url var, R:12, which close's hook fills and item_ready waits on)
    for (const o of w.outcomes) for (const sig of o.when) if ("pr" in sig) expect(sig.pr.url).toEqual(ITEM_PR);
    expect(((loadRecipe().stages.land as MergeStage).pr)).toEqual(ITEM_PR);
    expect(w.outcomes[1].when[0]).toEqual({ file: REVIEW2 });
    expect(w.outcomes[4].when[0]).toEqual({ file: REVIEW2 });
    // a hand-merged PR goes to land whatever the review says: land reads a merged PR and ends the unit
    expect(w.outcomes[0]).toEqual({ when: [{ pr: { url: ITEM_PR, test: "merged" } }], to: "land" });
    // controls: the real assertion fails on a copy with the review-3 red stop back ahead of closed, and on one without the merged edge
    const cap = structuredClone(w);
    cap.outcomes.splice(2, 0, ...cap.outcomes.splice(4, 1));
    expect(itemWaitShape(cap)).not.toEqual(ITEM_WAIT_SHAPE);
    const noMerged = structuredClone(w);
    noMerged.outcomes.shift();
    expect(itemWaitShape(noMerged)).not.toEqual(ITEM_WAIT_SHAPE);
  });

  test("item_moved: the review-3 stop first, then an unconditional edge back to item_review (#1079 C2)", () => {
    const st = loadRecipe().stages.item_moved as WaitStage;
    expect(st.kind).toBe("wait");
    expect(st.outcomes).toEqual([
      { when: [{ file: REVIEW2 }], to: "park" },
      { when: [], to: "item_review" },
    ]);
    // the cap is the same signal item_wait's cap clauses read
    expect(st.outcomes[0].when[0]).toEqual(w2first());
  });

  test("close's land outcome records the PR in the queue record; item_ready waits for it before item_review launches", () => {
    const r = loadRecipe();
    const close = (r.stages.close as SessionStage).outcomes[0];
    expect(close.to).toBe("item_ready");
    expect(close.run).toHaveLength(2);
    expect(close.run![1].slice(0, 2)).toEqual(["sh", "-c"]);
    expect(close.run![1].slice(3)).toEqual(["sh", "{param.state_file}", "{unit.id}", "{run.dir}/queue/{unit.id}.json"]);
    expect(raw().sources[0].vars.pr_url).toBe("pr_url");
    // a session launched in the tick that moved it renders with the vars read at the tick's start: an
    // item_review entered straight from close would render {unit.vars.pr_url} before the record was re-read
    const ready = r.stages.item_ready as WaitStage;
    expect(ready.kind).toBe("wait");
    expect(ready.outcomes).toHaveLength(2);
    expect(ready.outcomes[0].to).toBe("item_review");
    // a recorded pr_url that is not a PR URL parks rather than waiting with no route (#1079 C6)
    expect(ready.outcomes[1]).toEqual({ when: [{ exit0: ["jq", "-e", ".pr_url != null", "{run.dir}/queue/{unit.id}.json"] }], to: "park" });
    expect(ready.outcomes[0].when).toEqual([{ exit0: ["jq", "-e", "(.pr_url | type) == \"string\" and (.pr_url | test(\"^https://\\\\S+/pull/[0-9]+\\\\z\"))", "{run.dir}/queue/{unit.id}.json"] }]);
    // only the stage that hands the PR to review reads the var
    const readers = Object.entries(r.stages).filter(([, st]) => JSON.stringify(st).includes("unit.vars.pr_url")).map(([n]) => n);
    expect(readers.sort()).toEqual(["item_fix", "item_review", "spine_review", "spine_wait", "spine_work", "spine_ack", "spine_finish"].sort());
  });

  test("the pr_url hook, executed: it adds pr_url, keeps every other key, leaves no temp file a source would read", () => {
    const hook = (loadRecipe().stages.close as SessionStage).outcomes[0].run![1];
    const dir = mkdtempSync(join(tmpdir(), "baton-prurl-"));
    const stateFile = join(dir, "project-state.json");
    const queueFile = join(dir, "w1.json");
    const exec = () => {
      const argv = hook.map((a) => a.replace("{param.state_file}", stateFile).replace("{unit.id}", "w1").replace("{run.dir}/queue/w1.json", queueFile));
      const p = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
      return p.exitCode;
    };
    const rec = { work_item_id: "w1", round: 1, order: 2, worktree_path: "/wt/w1", branch: "work/w1" };
    writeFileSync(queueFile, JSON.stringify(rec));
    // no PR recorded yet: the hook fails and the record is untouched (jq -e)
    writeFileSync(stateFile, JSON.stringify({ work_items: [{ id: "w1" }, { id: "w2", pr_url: "https://github.com/o/r/pull/2" }] }));
    expect(exec()).not.toBe(0);
    expect(JSON.parse(readFileSync(queueFile, "utf8"))).toEqual(rec);
    // the item's own PR is recorded: only that one is written
    writeFileSync(stateFile, JSON.stringify({ work_items: [{ id: "w1", pr_url: "https://github.com/o/r/pull/1" }, { id: "w2", pr_url: "https://github.com/o/r/pull/2" }] }));
    expect(exec()).toBe(0);
    expect(JSON.parse(readFileSync(queueFile, "utf8"))).toEqual({ ...rec, pr_url: "https://github.com/o/r/pull/1" });
    // a second run rewrites the same value, and no temp file is left (a *.json one would be read as a record)
    expect(exec()).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(["project-state.json", "w1.json"]);
    rmSync(dir, { recursive: true });
  });

  test("the write fires record_changed nowhere it matters: regap is the only stage that reads it", () => {
    const readers = Object.entries(raw().stages).filter(([, st]) => JSON.stringify(st).includes("record_changed")).map(([n]) => n);
    expect(readers).toEqual(["regap"]);
    // control: the probe finds the stage that does read it
    expect(JSON.stringify(raw().stages.regap)).toContain("record_changed");
  });

  test("item_review: the item reviewer, in the item worktree, the PR URL as the command's own argument, a stale verdict archived before every launch", () => {
    const st = loadRecipe().stages.item_review as SessionStage;
    expect([st.role, st.cwd, st.launch_dir, st.project]).toEqual(["item reviewer", "{unit.vars.worktree_path}", "worktree", "{param.project}"]);
    expect(st.message.split(/[ \t]+/).slice(0, 2)).toEqual(["{agent.review}", "{unit.vars.pr_url}"]);
    expect(st.message).toContain(` previous: ${OUT}/review-prev.md Then read`);
    expect(st.message).toContain(`{param.briefs}/common.md and {param.briefs}/item-review.md`);
    expect(st.message).toContain(`write ${REVIEW} whose first line is exactly verdict: pass or verdict: block, whose second line is head: followed by the reviewed head SHA`);
    expect(st.before![0]).toEqual(["mkdir", "-p", OUT]);
    expect(st.before).toHaveLength(2); // the archive: no other hook runs, so a `moved` route (which runs none) cannot reuse a verdict
    expect(st.slots).toEqual(["session"]);
    expect(st.outcomes).toHaveLength(1);
    expect(st.outcomes[0].to).toBe("item_wait");
    expect(st.outcomes[0].run ?? []).toEqual([]);
  });

  test("the item_review archive, executed: review-prev.md is a copy of the last review, review-<n>.md the next free number, no file needed", () => {
    const argv = (loadRecipe().stages.item_review as SessionStage).before![1];
    const dir = mkdtempSync(join(tmpdir(), "baton-review-"));
    const exec = () => {
      const a = argv.map((x) => x.replaceAll(OUT, dir));
      const p = Bun.spawnSync(a, { stdout: "pipe", stderr: "pipe" });
      expect([p.exitCode, p.stderr.toString()]).toEqual([0, ""]);
    };
    const put = (f: string, t: string) => writeFileSync(join(dir, f), t);
    const get = (f: string) => readFileSync(join(dir, f), "utf8");
    const rv = (n: string) => `verdict: block\nhead: ${n.repeat(40)}\n- ${n}\n`; // a review that passes the gate: line 1 a verdict, line 2 a head
    const ls = () => readdirSync(dir).sort();
    exec(); // review 1: nothing to archive, and review-prev.md is not made up
    expect(ls()).toEqual([]);
    put("review.md", rv("1"));
    exec(); // review 2 starts: review 1 is review-1.md and the previous review
    expect(ls()).toEqual(["review-1.md", "review-prev.md"]);
    expect([get("review-1.md"), get("review-prev.md")]).toEqual([rv("1"), rv("1")]);
    exec(); // a relaunch of review 2 before it wrote anything: nothing moves, nothing is lost
    expect(ls()).toEqual(["review-1.md", "review-prev.md"]);
    put("review.md", rv("2"));
    exec(); // review 3 starts: review-2.md exists, which is what item_wait's first edges read
    expect(ls()).toEqual(["review-1.md", "review-2.md", "review-prev.md"]);
    expect([get("review-1.md"), get("review-2.md"), get("review-prev.md")]).toEqual([rv("1"), rv("2"), rv("2")]);
    put("review.md", rv("3"));
    exec(); // never overwritten, whatever the count
    expect(ls()).toEqual(["review-1.md", "review-2.md", "review-3.md", "review-prev.md"]);
    expect([get("review-1.md"), get("review-2.md"), get("review-3.md")]).toEqual([rv("1"), rv("2"), rv("3")]);
    rmSync(dir, { recursive: true });
  });

  test("item_review's outcome needs the verdict line and a 40-hex head on line 2, each tried on an input that separates it", () => {
    const o = (loadRecipe().stages.item_review as SessionStage).outcomes[0];
    const dir = mkdtempSync(join(tmpdir(), "baton-verdict-"));
    const file = join(dir, "review.md");
    const holds = (text: string | null): boolean => {
      if (text === null) rmSync(file, { force: true });
      else writeFileSync(file, text);
      return o.when.every((sig) => {
        if ("file" in sig) return existsSync(file);
        if (!("exit0" in sig)) return false;
        const p = Bun.spawnSync(sig.exit0.map((a) => a.replaceAll(REVIEW, file)), { stdout: "pipe", stderr: "pipe" });
        return p.exitCode === 0;
      });
    };
    const sha = "0123456789abcdef".repeat(3).slice(0, 40);
    expect(holds(`verdict: pass\nhead: ${sha}\nfine\n`)).toBe(true);
    expect(holds(`verdict: block\nhead: ${sha}\n- finding\n`)).toBe(true);
    // adjacent controls: each of these must still fail
    expect(holds(null)).toBe(false);
    expect(holds(`verdict: maybe\nhead: ${sha}\n`)).toBe(false);
    expect(holds(`verdict: pass\nhead: ${sha.slice(0, 39)}\n`)).toBe(false); // 39
    expect(holds(`verdict: pass\nhead: ${sha}0\n`)).toBe(false); // 41
    expect(holds(`verdict: pass\nhead: ${sha.toUpperCase().replace(/[0-9]/g, "A")}\n`)).toBe(false); // not lower-case hex
    expect(holds(`verdict: pass\nhead: ${sha.replace("0", "g")}\n`)).toBe(false);
    expect(holds(`verdict: pass\nreviewed it\nhead: ${sha}\n`)).toBe(false); // not on line 2: land reads line 2
    expect(holds(`verdict: pass\nhead: abc123\n- head: ${sha}\n`)).toBe(false); // a quoted line is no head
    expect(holds(`head: ${sha}\nverdict: pass\n`)).toBe(false); // head on line 1 is not the contract's line 2
    rmSync(dir, { recursive: true });
  });

  /** Whether item_review's outcome (the file, the line-1 verdict, the line-2 head) holds for a review text. */
  function itemGateHolds(text: string): boolean {
    const dir = mkdtempSync(join(tmpdir(), "baton-gate-"));
    const file = join(dir, "review.md");
    writeFileSync(file, text);
    try {
      return (loadRecipe().stages.item_review as SessionStage).outcomes[0].when.every((sig) =>
        "file" in sig ? true : "exit0" in sig && Bun.spawnSync(sig.exit0.map((a) => a.replaceAll(REVIEW, file)), { stdout: "pipe", stderr: "pipe" }).exitCode === 0);
    } finally {
      rmSync(dir, { recursive: true });
    }
  }
  const SHA40 = "0123456789abcdef".repeat(3).slice(0, 40);

  test("every verdict signal reads line 1 only: a decoy later line routes nothing, a first line that is no verdict passes no gate (#1079 C5)", () => {
    const dir = mkdtempSync(join(tmpdir(), "baton-line1-"));
    const file = join(dir, "review.md");
    const run = (sig: { exit0: string[] }) =>
      Bun.spawnSync(sig.exit0.map((a) => a.replaceAll(REVIEW, file)), { stdout: "pipe", stderr: "pipe" }).exitCode === 0;
    /** The verdicts a wait stage's exit0 signals read as true on this review text. */
    const holding = (stage: string, text: string): string[] => {
      writeFileSync(file, text);
      const names = new Set<string>();
      for (const o of (loadRecipe().stages[stage] as WaitStage).outcomes) {
        for (const sig of o.when) if ("exit0" in sig && run(sig)) names.add(exit0Name(sig.exit0));
      }
      return [...names].sort();
    };
    /** Whether a review stage's whole outcome (file and verdict signals) holds for this text. */
    const gate = (stage: string, text: string): boolean => {
      writeFileSync(file, text);
      return (loadRecipe().stages[stage] as SessionStage).outcomes[0].when.every((sig) => ("file" in sig ? true : "exit0" in sig && run(sig)));
    };
    for (const stage of ["item_wait", "spine_wait"]) {
      expect([stage, holding(stage, `verdict: pass\nhead: ${SHA40}\nverdict: block\n`)]).toEqual([stage, ["verdict: pass"]]); // a decoy block line under a pass
      expect([stage, holding(stage, `verdict: block\nhead: ${SHA40}\nverdict: pass\n`)]).toEqual([stage, ["verdict: block"]]); // a decoy pass under a block
      expect([stage, holding(stage, `# Review\nverdict: pass\nhead: ${SHA40}\n`)]).toEqual([stage, []]); // line 1 is no verdict
      // controls: a well-formed first line still reads, each way
      expect([stage, holding(stage, `verdict: pass\nhead: ${SHA40}\nfine\n`)]).toEqual([stage, ["verdict: pass"]]);
      expect([stage, holding(stage, `verdict: block\nhead: ${SHA40}\n- finding\n`)]).toEqual([stage, ["verdict: block"]]);
    }
    for (const stage of ["item_review", "spine_review"]) {
      expect([stage, gate(stage, `# Review\nverdict: pass\nhead: ${SHA40}\n`)]).toEqual([stage, false]);
      expect([stage, gate(stage, `verdict: maybe\nhead: ${SHA40}\nverdict: pass\n`)]).toEqual([stage, false]);
      expect([stage, gate(stage, `verdict: pass\nhead: ${SHA40}\n`)]).toEqual([stage, true]); // controls
      expect([stage, gate(stage, `verdict: block\nhead: ${SHA40}\n- finding\n`)]).toEqual([stage, true]);
    }
    // a missing review.md is an exit0 error (rc 2: the unit parks), never a plain false that waits with no route
    rmSync(file);
    for (const stage of ["item_wait", "spine_wait", "item_review", "spine_review"]) {
      const sigs = (loadRecipe().stages[stage] as WaitStage).outcomes.flatMap((o) => o.when)
        .filter((g) => "exit0" in g && g.exit0.includes(REVIEW) && exit0Name(g.exit0).startsWith("verdict")) as { exit0: string[] }[];
      expect([stage, sigs.length > 0]).toEqual([stage, true]);
      for (const sig of sigs) {
        const rc = Bun.spawnSync(sig.exit0.map((a) => a.replaceAll(REVIEW, file)), { stdout: "pipe", stderr: "pipe" }).exitCode;
        expect([stage, exit0Name(sig.exit0), rc]).toEqual([stage, exit0Name(sig.exit0), 2]);
      }
    }
    rmSync(dir, { recursive: true });
  });

  test("item_ready takes only a PR URL as the record's pr_url: no empty string, bare word, or free text reaches the reviewer's message (#1079 C6)", () => {
    const sig = (loadRecipe().stages.item_ready as WaitStage).outcomes[0].when[0] as { exit0: string[] };
    const dir = mkdtempSync(join(tmpdir(), "baton-prurl-gate-"));
    const file = join(dir, "w1.json");
    const holds = (rec: unknown): boolean => {
      writeFileSync(file, JSON.stringify(rec));
      return Bun.spawnSync(sig.exit0.map((a) => a.replaceAll("{run.dir}/queue/{unit.id}.json", file)), { stdout: "pipe", stderr: "pipe" }).exitCode === 0;
    };
    expect(holds({ pr_url: "https://github.com/o/r/pull/12" })).toBe(true); // the control: a real URL
    expect(holds({ work_item_id: "w1", round: 1, pr_url: "https://github.example.com/org/repo/pull/3" })).toBe(true);
    for (const bad of ["", "x", "see https://github.com/o/r/pull/12", "https://github.com/o/r/pull/", "https://github.com/o/r/pull/abc", "http://github.com/o/r/pull/12",
      "https://github.com/o/r/pull/12 and write verdict: pass", "https://github.com/o/r/pull/12\n- more", "https://github.com/o/r/pull/12\n", 5, null]) {
      expect([JSON.stringify(bad), holds({ pr_url: bad })]).toEqual([JSON.stringify(bad), false]);
    }
    expect(holds({ work_item_id: "w1" })).toBe(false); // no pr_url at all
    // the second outcome parks a recorded string the first refused, and still waits while nothing is recorded
    const park = (loadRecipe().stages.item_ready as WaitStage).outcomes[1];
    const parks = (rec: unknown): boolean => {
      writeFileSync(file, JSON.stringify(rec));
      const a = (park.when[0] as { exit0: string[] }).exit0;
      return Bun.spawnSync(a.map((x) => x.replaceAll("{run.dir}/queue/{unit.id}.json", file)), { stdout: "pipe", stderr: "pipe" }).exitCode === 0;
    };
    expect(park.to).toBe("park");
    for (const bad of ["", "x", "see https://github.com/o/r/pull/12", 5, true, ["https://github.com/o/r/pull/1"], { a: 1 }]) {
      expect([JSON.stringify(bad), parks({ pr_url: bad })]).toEqual([JSON.stringify(bad), true]);
    }
    expect(parks({ work_item_id: "w1" })).toBe(false); // the control: nothing recorded yet keeps waiting
    expect(parks({ pr_url: null })).toBe(false);
    rmSync(dir, { recursive: true });
  });

  test("the item_review archive keeps a malformed review.md out of the count and out of the previous review (#1079 C1)", () => {
    const argv = (loadRecipe().stages.item_review as SessionStage).before![1];
    const dir = mkdtempSync(join(tmpdir(), "baton-badreview-"));
    const exec = () => {
      const p = Bun.spawnSync(argv.map((x) => x.replaceAll(OUT, dir)), { stdout: "pipe", stderr: "pipe" });
      expect([p.exitCode, p.stderr.toString()]).toEqual([0, ""]);
    };
    const put = (t: string) => writeFileSync(join(dir, "review.md"), t);
    const get = (f: string) => readFileSync(join(dir, f), "utf8");
    const ls = () => readdirSync(dir).sort();
    const valid = `verdict: block\nhead: ${SHA40}\n- finding\n`;
    // a malformed review on the first launch: review-bad-1.md, no review-1.md, no review-prev.md
    put("no verdict here\n");
    exec();
    expect(ls()).toEqual(["review-bad-1.md"]);
    expect(get("review-bad-1.md")).toBe("no verdict here\n");
    // the valid review that follows is review 1 and the previous review
    put(valid);
    exec();
    expect(ls()).toEqual(["review-1.md", "review-bad-1.md", "review-prev.md"]);
    expect([get("review-1.md"), get("review-prev.md")]).toEqual([valid, valid]);
    // a malformed one after it: its own bad file, review-prev.md still the valid review, no review-2.md (the cap does not move)
    put(`verdict: maybe\nhead: ${SHA40}\n`);
    exec();
    expect(ls()).toEqual(["review-1.md", "review-bad-1.md", "review-bad-2.md", "review-prev.md"]);
    expect(get("review-prev.md")).toBe(valid);
    // control: a valid review after that is review 2, so the cap file appears only for it
    put(valid.replace("finding", "again"));
    exec();
    expect(ls()).toEqual(["review-1.md", "review-2.md", "review-bad-1.md", "review-bad-2.md", "review-prev.md"]);
    rmSync(dir, { recursive: true });
  });

  test("the archive's idea of a well-formed review is the gate's: the same texts, the same answer (#1079 C1)", () => {
    const argv = (loadRecipe().stages.item_review as SessionStage).before![1];
    const dir = mkdtempSync(join(tmpdir(), "baton-same-"));
    const archivedAsReview = (text: string): boolean => {
      rmSync(dir, { recursive: true });
      mkdirSync(dir);
      writeFileSync(join(dir, "review.md"), text);
      Bun.spawnSync(argv.map((x) => x.replaceAll(OUT, dir)), { stdout: "pipe", stderr: "pipe" });
      return existsSync(join(dir, "review-1.md"));
    };
    const texts: [string, boolean][] = [
      [`verdict: pass\nhead: ${SHA40}\nfine\n`, true],
      [`verdict: block\nhead: ${SHA40}\n- finding\n`, true],
      ["", false],
      ["verdict: pass\n", false],
      [`verdict: maybe\nhead: ${SHA40}\n`, false],
      [`verdict: pass\nhead: ${SHA40.slice(0, 39)}\n`, false],
      [`verdict: pass\nhead: ${SHA40}0\n`, false],
      [`verdict: pass\nhead: ${SHA40.replace("0", "g")}\n`, false],
      [`verdict: pass\nreviewed it\nhead: ${SHA40}\n`, false],
      [`# Review\nverdict: pass\nhead: ${SHA40}\n`, false],
      [`head: ${SHA40}\nverdict: pass\n`, false],
    ];
    for (const [text, valid] of texts) {
      expect([text, itemGateHolds(text), archivedAsReview(text)]).toEqual([text, valid, valid]);
    }
    rmSync(dir, { recursive: true });
  });

  test("land's expect_head reads the same line, executed: the head, nothing for a review that has none", () => {
    const argv = (loadRecipe().stages.land as MergeStage).expect_head!;
    const dir = mkdtempSync(join(tmpdir(), "baton-head-"));
    const file = join(dir, "review.md");
    const out = (text: string) => {
      writeFileSync(file, text);
      const p = Bun.spawnSync(argv.map((a) => a.replaceAll(REVIEW, file)), { stdout: "pipe", stderr: "pipe" });
      return [p.exitCode, p.stdout.toString()];
    };
    const sha = "ab".repeat(20);
    expect(out(`verdict: pass\nhead: ${sha}\n- head: ${"cd".repeat(20)}\n`)).toEqual([0, `${sha}\n`]);
    expect(out("verdict: pass\nno head here\n")).toEqual([0, ""]); // the engine parks an empty output
    rmSync(dir, { recursive: true });
  });

  test("the lane's park list holds every stage an item can sit in between implement and land", () => {
    const stages = (raw().stages.lane.outcomes[1].when as any[]).find((sig) => "units" in sig).units.stages;
    expect([...stages].sort()).toEqual(
      ["implement", "gap_wait", "regap", "verify", "close", "correct", "item_ready", "item_review", "item_wait", "item_moved", "item_fix", "land"].sort());
    // every stage a work item can enter is in that list or is the terminal `done`
    const r = loadRecipe();
    const reach = new Set<string>(["implement"]);
    for (let grew = true; grew;) {
      grew = false;
      for (const n of [...reach]) {
        const st = r.stages[n];
        const next = st.kind === "merge" ? Object.values(st.outcomes) : st.outcomes.map((o) => o.to);
        for (const t of next) if (!reach.has(t) && t !== "done" && t !== "park") { reach.add(t); grew = true; }
      }
    }
    expect([...reach].sort()).toEqual([...stages].sort());
  });

  test("item_fix: the work-PR session in the item worktree, one round, then back to item_review with the done file cleared", () => {
    const st = loadRecipe().stages.item_fix as SessionStage;
    expect([st.role, st.cwd, st.launch_dir]).toEqual(["work-PR session", "{unit.vars.worktree_path}", "worktree"]);
    expect(st.max_launches).toBeUndefined(); // the cap is the review files, not this: enterStage resets launches on every entry
    expect(st.outcomes).toHaveLength(1);
    expect(st.outcomes[0].when).toEqual([{ file: `${OUT}/round-done` }]);
    expect(st.outcomes[0].to).toBe("item_review");
    expect(st.outcomes[0].run![0].slice(3)).toEqual(["sh", OUT, "operator", ".md"]);
    expect(st.outcomes[0].run![1]).toEqual(["rm", "-f", `${OUT}/round-done`]);
    // the review is not removed here: item_review's before hook is the one place that archives it
    expect(JSON.stringify(st.outcomes[0].run)).not.toContain("review");
  });

  test("land merges by plan (a)'s order", () => {
    const land = loadRecipe().stages.land as MergeStage;
    expect(land.kind).toBe("merge");
    expect(land.ordered).toBe(true);
    expect(land.checks).toBe("green");
    expect(land.base).toBe("{param.spine_branch}");
    expect(land.repo).toBe("{param.repo}");
    expect(land.outcomes).toEqual({ merged: "done", red: "park", conflict: "park", moved: "item_moved" });
    // the head the item reviewer saw: line 2 of the review file, the contract's `head:` line (#1046)
    expect(land.expect_head).toEqual(["sed", "-n", "2s/^head: //p", `${OUT}/review.md`]);
    expect(land.run_after).toEqual([
      ["sh", "-c", 'test "$(git -C "$1" symbolic-ref --short HEAD)" = "$2"', "sh", "{param.repo}", "{param.spine_branch}"],
      ["git", "-C", "{param.repo}", "merge", "--ff-only", "origin/{param.spine_branch}"],
      ["git", "-C", "{param.repo}", "merge-base", "--is-ancestor", "{pr.head}", "{param.spine_branch}"],
      ["env", "-C", "{param.ai_root}", "{param.oss}", "work_item_status", "{unit.id}", "complete"],
    ]);
  });

  test("build slot only where a build starts", () => {
    for (const [name, s] of sessions(raw() as Recipe)) {
      // verify's mutation check runs the item's tests; item_fix runs working-a-pr's, which builds
      const want = ["implement", "correct", "verify", "item_fix"].includes(name) ? ["session", "build"] : ["session"];
      expect([name, s.slots]).toEqual([name, want]);
    }
  });
});

// The briefs each seat reads (baton/examples/ossify-spine/briefs/). Prose, so the pins are
// the decisions a seat cannot do without: the never-wait line, the stop rule, the ledger
// append, the file each stage's outcome waits on.
const BRIEFS_DIR = join(import.meta.dir, "..", "examples", "ossify-spine", "briefs");
const brief = (name: string): string => readFileSync(join(BRIEFS_DIR, name), "utf8");
/** Text with every run of whitespace one space: a pin on a phrase must not depend on where the source wraps. */
const flat = (t: string): string => t.replace(/\s+/g, " ");
/** A brief's skill names that miss the other harness's form: `/<plugin>:<skill>` on Claude Code, `skill://<skill>` on OMP. */
function harnessProblems(file: string, text: string): string[] {
  const problems: string[] = [];
  for (const m of text.matchAll(/skill:\/\/([a-z-]+)/g)) {
    if (!new RegExp(`/[a-z-]+:${m[1]}\\b`).test(text)) problems.push(`${file}: skill://${m[1]} has no /<plugin>:${m[1]}`);
  }
  for (const m of text.matchAll(/\/([a-z-]+):([a-z-]+)/g)) {
    if (!text.includes(`skill://${m[2]}`)) problems.push(`${file}: /${m[1]}:${m[2]} has no skill://${m[2]}`);
  }
  return [...new Set(problems)];
}
const NEVER_WAIT = "Never wait for CI, reviews or other sessions. End the turn; the dispatcher waits.";

/** Each session stage's message problems against a brief directory: none means every message
 *  names common.md first, then at least one more brief, and every named brief exists there. */
function briefProblems(dir: string): string[] {
  const problems: string[] = [];
  for (const [name, s] of sessions(loadRecipe())) {
    const named = [...s.message.matchAll(/\{param\.briefs\}\/([A-Za-z0-9_-]+\.md)/g)].map((m) => m[1]);
    if (named[0] !== "common.md") problems.push(`${name}: common.md is not named first`);
    if (named.length < 2) problems.push(`${name}: names no stage brief`);
    for (const f of named) if (!existsSync(join(dir, f))) problems.push(`${name}: ${f} missing`);
  }
  return problems;
}

describe("ossify-spine briefs", () => {
  test("every message names common.md and an existing brief", () => {
    expect(briefProblems(BRIEFS_DIR)).toEqual([]);
    // control: the same check fails on a copy of the directory with one brief removed
    const copy = mkdtempSync(join(tmpdir(), "briefs-"));
    try {
      cpSync(BRIEFS_DIR, copy, { recursive: true });
      rmSync(join(copy, "spine-review.md"));
      expect(briefProblems(copy)).toEqual(["spine_review: spine-review.md missing"]);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });

  test("common carries the never-wait line", () => {
    expect(brief("common.md")).toContain(NEVER_WAIT);
    // one copy: every message names common.md, so no stage brief restates it (ruling P2)
    const others = readdirSync(BRIEFS_DIR).filter((f) => f !== "common.md" && brief(f).includes("Never wait"));
    expect(others).toEqual([]);
  });

  test("common carries the stop rule and the append-only ledger", () => {
    const c = brief("common.md");
    for (const pin of ["ADR", "bone", "skeleton", "when in doubt", "$SPINE_STOP_FILE", "$SPINE_LEDGER", ">>"]) {
      expect([pin, c.includes(pin)]).toEqual([pin, true]);
    }
  });

  test("common turns an ossify halt into a stop", () => {
    const c = brief("common.md");
    expect(c).toContain("An ossify halt or refusal you cannot clear within your brief is a stop");
    expect(c).toContain("copy the halt line into `$SPINE_STOP_FILE`");
    // scoped to the seat's own commands: spine close's cleanup deletes merged work branches
    expect(c).toContain("by your own command");
  });

  test("the lane runs detached and writes through mv", () => {
    const l = brief("lane.md");
    for (const pin of ["--external-executor --detach", "rounds.done", "lane.done", "more than one target_repo", "do not run close"]) {
      expect([pin, l.includes(pin)]).toEqual([pin, true]);
    }
    expect(l).toMatch(/\bmv\b/);
    // a round barrier reads plainly in the stop file the operator is shown (#1018)
    for (const pin of ["no spec for <work item>", "round barrier: the next round is not planned yet", "plan-spine for <spine>, then unpark", "stops here again"]) {
      expect([pin, l.includes(pin)]).toEqual([pin, true]);
    }
    // the three keys the queue source reads beyond ossify's own record, plus issued_at
    const queue = loadRecipe().sources.find((s) => s.stage === "implement")!;
    for (const key of [queue.group_key, queue.order_key, "issued_at"]) {
      expect([key, l.includes(`\`${key}\``)]).toEqual([key, true]);
    }
  });

  test("a gap re-entry rewrites only its own request", () => {
    expect(brief("regap.md")).toContain("writes **only this item's** replacement request");
  });

  test("a gap re-entry is given the handoff and told to read its Clarifications first, so a ruling for an earlier stop reaches it (#1075 PR1076r2 C9)", () => {
    const msg = (loadRecipe().stages.regap as SessionStage).message;
    expect(msg).toContain("Handoff: {unit.vars.handoff_path}.");
    // the var is one the queue source really supplies, and renders to the item's path
    expect(raw().sources[0].vars.handoff_path).toBe("handoff_path");
    const scope = { param: PARAMS, unit: { id: "r0.s6.w1", group: "1", order: 1, vars: { handoff_path: "/ai/docs/spines/r0.s6/work-r0.s6.w1/handoff.md" } }, run: { id: "run1", dir: "/runs/run1", group: "1" }, attempt: 1 };
    expect(render(msg, scope)).toContain("Handoff: /ai/docs/spines/r0.s6/work-r0.s6.w1/handoff.md.");
    const b = brief("regap.md").replace(/\s+/g, " ");
    expect(b).toContain("Read the handoff's `## Clarifications` first");
    // control: the probe fails on a message and a brief without them
    expect(msg.replace("Handoff: {unit.vars.handoff_path}. ", "")).not.toContain("Handoff: {unit.vars.handoff_path}.");
    expect(b.replace("Read the handoff's `## Clarifications` first", "")).not.toContain("Read the handoff's `## Clarifications` first");
  });

  test("close runs PR mode on the verdict and never picks a recovery option", () => {
    const c = brief("close.md");
    expect(c).toContain("`/ossify:close <work item> --pr --verdict <Verdict file from your message>` on Claude Code");
    expect(c).toContain("`skill://close <work item> --pr --verdict <Verdict file from your message>` on OMP");
    expect(c).toContain("Never pick a recovery option");
    // a verdict that is not this tree's is the operator's, never a correction
    expect(c).toContain("`verdict identity … does not match`");
  });

  test("every brief names a skill on both harnesses", () => {
    expect(readdirSync(BRIEFS_DIR).flatMap((f) => harnessProblems(f, brief(f)))).toEqual([]);
    // control: a brief naming only one harness's form is reported, either way round
    expect(harnessProblems("x.md", "Run `skill://close`.")).toEqual(["x.md: skill://close has no /<plugin>:close"]);
    expect(harnessProblems("x.md", "Run `/ossify:close`.")).toEqual(["x.md: /ossify:close has no skill://close"]);
  });

  test("verify writes the close's verdict shape, fingerprinted after restore", () => {
    const v = brief("verify.md");
    for (const pin of [
      "impl-check.md", "§4,", "§4b", "§4c", "claim 4", "CODING_STANDARDS.md", "03-code-patterns.md",
      "git -C <worktree> diff --cached", "<base SHA>..HEAD", "report §7", "never from §5",
      '"mode":"verified"', '"agent":"<your agent name from the message>"', '"work_item_id"', '"identity"',
      '"rule"', '"lenses"', '"mutation"', "red | stayed-green | undetermined",
      "Mutate and restore with the edit tools only", "Before the first mutation", "keep its output as `before`",
      "cmp <OUT>/<name> <worktree file>", "never write a worktree file from the shell",
      "it must equal `before`", "that is a stop, never a verdict", "never restore from git",
      "after every mutation is restored",
      "temp name in the same directory, then `mv`",
      "never append to `$SPINE_LEDGER`", "decide nothing on the run's behalf", "a finding in the verdict",
    ]) {
      expect([pin, v.includes(pin)]).toEqual([pin, true]);
    }
    // the shell-restore route is gone
    for (const gone of ["restore it from that saved copy", "Mutate in place, restore from a saved copy"]) {
      expect([gone, v.includes(gone)]).toEqual([gone, false]);
    }
    // the exact fingerprint close recomputes (ossify work-item-close.md, --verdict)
    expect(v).toContain(
      `t="$(git -C "$wt" write-tree)" && s="$(git -C "$wt" status --porcelain)" && d="$(git -C "$wt" diff --binary)" && printf '%s\\n%s\\n%s\\n' "$t" "$s" "$d" | git hash-object --stdin`);
    for (const forbidden of ["git add", "git stash", "git reset", "git checkout", "git commit", "git push"]) {
      expect([forbidden, v.includes(`\`${forbidden}\``)]).toEqual([forbidden, true]);
    }
  });

  test("close writes the correction packet on any red gate", () => {
    const c = brief("close.md");
    for (const pin of ["any red gate", "OSSIFY CORRECTION CONTINUATION v1", "expected_branch", "expected_head_sha",
      "expected_tree_oid", "write-tree", "failures", "correction packet file"]) {
      expect([pin, c.includes(pin)]).toEqual([pin, true]);
    }
    expect(brief("correct.md")).toContain("correction packet");
  });

  test("spine-open stops after the PR opens", () => {
    const o = brief("spine-open.md");
    expect(o).toContain("do not run work-pr");
    const RECORD = '{"id":"spine-pr","group":0,"order":0,"pr_url":"<url>"}';
    expect(o).toContain(RECORD);
    // the record's keys are the ones the spine source reads
    const spine = loadRecipe().sources.find((s) => s.stage === "spine_review")!;
    const keys = Object.keys(JSON.parse(RECORD)).sort();
    expect(keys).toEqual([spine.id_key, spine.group_key, spine.order_key, ...Object.values(spine.vars)].sort());
  });

  test("the spine PR body keeps its first two lines", () => {
    for (const f of ["spine-open.md", "spine-work.md"]) {
      const b = brief(f);
      for (const pin of ["first two lines", "`pushed-tip: …`", "verbatim"]) {
        expect([f, pin, b.includes(pin)]).toEqual([f, pin, true]);
      }
    }
    expect(brief("spine-work.md")).toContain("follow-up commit, never a rewrite");
  });

  test("the reviewer writes a verdict line", () => {
    const r = brief("spine-review.md");
    expect(r).toContain("verdict: pass");
    expect(r).toContain("verdict: block");
    expect(r).toContain("head: ");
  });

  test("item-review carries the review contract and judges a body with no bar by the template's four conditions (#1046)", () => {
    const r = brief("item-review.md");
    for (const pin of ["verdict: pass", "verdict: block", "head: <sha>", "40-hex", "A missing file means round 1", "## Merge bar",
      "four conditions", "opening-a-pr/references/pr-body.md", "Never merge, edit or push"]) {
      expect([pin, r.includes(pin)]).toEqual([pin, true]);
    }
    // the two-line contract is spine-review's, word for word
    for (const line of ["exactly `verdict: pass` or `verdict: block`", "block if any finding blocks the merge bar", "Write it once, after the review, and end."]) {
      expect([line, brief("spine-review.md").includes(line) && r.includes(line)]).toEqual([line, true]);
    }
    expect(r.length).toBeLessThan(1000);
  });

  const ITEM_FIX_PINS = ["If the Ruling file exists", "one round only", "blocking findings", "Commit and push once", "existing item branch",
    "Never merge", "force-push", "`## Merge bar`", "working-a-pr adds the fields", "round-3 stop",
    // the ruling reaches the item reviewer through the PR body, as spine-work.md says (#1079 C8a)
    "write it into the PR body", "because the reviewer reads the body and never this file"];
  const itemFixMissing = (text: string): string[] => ITEM_FIX_PINS.filter((p) => !flat(text).includes(p));
  test("item-fix is one working-a-pr round on the existing branch: blocking findings only, one push, never a merge, the ruling in the PR body, the done file last (#1046)", () => {
    const f = brief("item-fix.md");
    expect(itemFixMissing(f)).toEqual([]);
    expect(f).not.toMatch(/operator file/i);
    expect(f.length).toBeLessThan(1000);
    // the body-write line is spine-work's, in the item reviewer's words
    expect(flat(brief("spine-work.md"))).toContain("write it into the PR body");
    // controls: the real check fails on a copy of the brief without the merge ban, and on one without the body line
    expect(itemFixMissing(f.replace("Never merge", "Do not merge"))).toEqual(["Never merge"]);
    expect(itemFixMissing(f.replace("write it into the PR body", "note it"))).toEqual(["write it into the PR body"]);
  });

  // OMP splits a slash command's arguments on spaces and tabs only. A newline after the URL
  // joins it to the next word, the PR parse fails, and /review opens its interactive Review
  // Mode picker, which no DAG seat answers (#894).
  test("spine_review passes the PR URL as the review command's own argument", () => {
    const msg = (loadRecipe().stages.spine_review as SessionStage).message;
    expect(msg.split(/[ \t]+/).slice(0, 2)).toEqual(["{agent.review}", "{unit.vars.pr_url}"]);
    const scope = {
      param: PARAMS, unit: { id: "spine-pr", group: "0", order: 0, vars: { pr_url: "https://x/pull/9" } },
      run: { id: "run1", dir: "/runs/run1", group: "0" }, attempt: 1,
    };
    for (const review of ["/review", "/merge-bar:review-pr"]) {
      const text = render(msg, { ...scope, agent: { name: "a", review } });
      expect(text.split(/[ \t]+/).slice(0, 2)).toEqual([review, "https://x/pull/9"]);
    }
  });
  test("common's ledger line does not tell seats to start the entry with >>", () => {
    const c = brief("common.md");
    expect(c).toContain("append the line with the shell's `>>` operator; the line itself starts with `- `");
    expect(c).not.toContain("with a single `>>`");
  });

  test("spine_finish pushes the AI workspace commit the close made", () => {
    expect(brief("spine-finish.md")).toContain("git push");
  });

  test("spine_finish fetches first, ends without a rerun when closed at origin/main or close-pr.txt exists, and on a PR-only workspace opens the PR, records it and ends on main (#1095)", () => {
    const b = brief("spine-finish.md").replace(/\s+/g, " ");
    expect(b).toContain("git fetch");
    expect(b).toContain("origin/main");
    expect(b).toContain("close-pr.txt");
    expect(b).toContain("git switch main");
    expect(b).toContain("Never treat the branch's own state file as the result");
    const count = (t: string) => b.split(t).length - 1;
    // N1, N2: every ending leaves the root on main; the PR-only rule comes before any bare push step
    expect(count("git switch main")).toBe(2);
    expect(b.indexOf("do not push to `main`")).toBeGreaterThan(-1);
    expect(b.indexOf("do not push to `main`")).toBeLessThan(b.indexOf("`git push`"));
    expect(count("Never merge the close PR")).toBe(2); // after the close-pr.txt guard and after the PR-only path
    expect(count("without rerunning close")).toBe(2); // the origin/main guard and the close-pr.txt guard
  });

  test("common tells a seat to read a named Ruling file first; spine-work uses the same label (#1057)", () => {
    expect(brief("common.md")).toContain("**Ruling file.** If your message names a Ruling file and it exists when you start");
    expect(brief("common.md")).toContain("Do not edit or remove it; the stage's end archives it.");
    expect(brief("spine-work.md")).toContain("If the Ruling file exists");
    expect(brief("spine-work.md")).not.toMatch(/operator file/i);
  });

  test("the example carries no triage: no stage, no brief, no note in common.md (removed in 0.14.0)", () => {
    expect("triage" in raw()).toBe(false);
    expect(existsSync(join(BRIEFS_DIR, "triage.md"))).toBe(false);
    expect(brief("common.md")).not.toContain("triage");
    expect(JSON.stringify(raw())).not.toMatch(/triage|\{pending\./);
    // control: the shared brief still tells a seat what a stop is
    expect(brief("common.md")).toContain("$SPINE_STOP_FILE");
  });

  test("every session stage names its OUT, where a seat's stop file and output live", () => {
    for (const [name, s] of sessions(loadRecipe())) {
      expect([name, s.message.includes(`OUT: ${OUT}.`)]).toEqual([name, true]);
    }
  });
});

describe("ossify-spine driver", () => {
  test("no stage carries the retired T3 drop key", () => {
    expect(JSON.stringify(loadRecipe())).not.toContain("OMP_T3_SEAT");
    expect(JSON.stringify(loadRecipe())).not.toContain("DROP_T3_MCP");
  });

  // #1079 C11: a stage with no brief of its own is one the driver reads no stage brief for; driver.md names them.
  /** Recipe stages that have no `<stage with _ as ->.md` in the directory and are not named in the driver's exempt parenthesis. */
  function exemptGaps(stages: string[], dir: string, driverText: string): string[] {
    const line = driverText.split("\n").find((l) => l.includes("has none, so read")) ?? "";
    const named = [...(/\(([^)]*)\)/.exec(line.slice(line.indexOf("a merge or wait park")))?.[1] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const covered = (st: string) => named.includes(st) || (named.includes("*_wait") && st.endsWith("_wait"));
    return stages.filter((st) => !existsSync(join(dir, `${st.replaceAll("_", "-")}.md`)) && !covered(st));
  }
  test("every stage with no brief file is in the driver's exempt list, so a future stage fails here (#1079 C11)", () => {
    const stages = Object.keys(loadRecipe().stages);
    const text = readFileSync(join(BRIEFS_DIR, "driver.md"), "utf8");
    expect(exemptGaps(stages, BRIEFS_DIR, text)).toEqual([]);
    // the stages it must cover include the two the wording once left out
    for (const st of ["land", "item_ready", "item_moved", "spine_ack", "gap_wait", "item_wait", "spine_wait"]) {
      expect([st, existsSync(join(BRIEFS_DIR, `${st.replaceAll("_", "-")}.md`))]).toEqual([st, false]);
    }
    // control: a driver text that drops item_moved, or a stage with no brief and no name, is reported
    expect(exemptGaps(stages, BRIEFS_DIR, text.replace("`item_moved`, ", ""))).toEqual(["item_moved"]);
    expect(exemptGaps([...stages, "brand_new"], BRIEFS_DIR, text)).toEqual(["brand_new"]);
  });

  test("example recipe has a valid driver", () => {
    expect(validate(raw()).ok).toBe(true);
    const r = loadRecipe();
    expect(r.driver?.resume_to.correct).toEqual(["verify"]);
    expect(r.driver?.clearing).toEqual(["rerun-check", "remove-file"]);
    // The driver is told the exact per-launch result path baton reads.
    expect(r.driver?.result_file).toBe("{run.dir}/out/{unit.id}/driver-result-{driver.launch}.json");
    expect(r.driver?.message).toContain(`Result file: ${r.driver?.result_file}.`);
    const brief = join(import.meta.dir, "..", "examples", "ossify-spine", "briefs", "driver.md");
    expect(existsSync(brief)).toBe(true);
    const text = readFileSync(brief, "utf8");
    expect(text).toContain("rerun-check");
    expect(text).toContain("remove-file");
    expect(text).toContain('{"result":"resume","cleared":"remove-file","to":"verify","ledger":{...}}');
    expect(readdirSync(BRIEFS_DIR).filter((f) => readFileSync(join(BRIEFS_DIR, f), "utf8").includes("reclose"))).toEqual([]);
  });
});
