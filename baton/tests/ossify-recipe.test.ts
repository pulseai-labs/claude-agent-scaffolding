// The example ossify-spine recipe (baton/examples/ossify-spine/recipe.json), pinned
// structurally: the claim every seat carries, the roles, where each stage launches, the
// dispatch count and cap, the R7 gap re-entry, the land order, and the build slot.
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, validate, type MergeStage, type Recipe, type SessionStage, type WaitStage } from "../src/recipe.ts";
import { loadRecipe, raw, RECIPE_PATH, renderStageEnv } from "./ossify-recipe-helpers.ts";

const BIN = join(import.meta.dir, "..", "bin", "baton");

const SESSION_STAGES = [
  "lane", "implement", "regap", "verify", "close", "correct",
  "spine_open", "spine_review", "spine_work", "spine_finish",
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

// Spec D2: each session stage, the triage stage and the driver name a crew role, verbatim.
const STAGE_ROLES: Record<string, string> = {
  lane: "spine session", regap: "spine session",
  implement: "implementer", correct: "implementer",
  verify: "verifier",
  close: "close session", spine_open: "close session", spine_finish: "close session",
  spine_review: "reviewer",
  spine_work: "work-PR session",
};
const stageRoles = (r: Recipe) => ({
  ...Object.fromEntries(sessions(r).map(([n, s]) => [n, s.role])),
  triage: r.triage?.role, driver: r.driver?.role,
});

/** Agent or harness names in a recipe's text: the recipe names roles, never agents. */
const agentNames = (text: string): string[] => [...text.matchAll(/omp-|claude-|devin/gi)].map((m) => m[0]);

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
    expect(stageRoles(r)).toEqual({ ...STAGE_ROLES, triage: "triage", driver: "driver" });
    const launchers: [string, Record<string, unknown>][] = [
      ...Object.entries(raw().stages as Record<string, Record<string, unknown>>).filter(([, s]) => s.kind === "session"),
      ["triage", raw().triage], ["driver", raw().driver],
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
    expect(stageRoles(copy)).not.toEqual({ ...STAGE_ROLES, triage: "triage", driver: "driver" });
  });

  test("no-agent-names-in-recipe", () => {
    expect(agentNames(readFileSync(RECIPE_PATH, "utf8"))).toEqual([]);
    // control: the scan finds each kind of name it looks for
    expect(agentNames('"via": "omp-glm-flash", "x": "claude-sonnet-high", "y": "Devin"')).toEqual(["omp-", "claude-", "Devin"]);
  });

  test("every session stage runs molt as a child", () => {
    for (const [name, s] of sessions(loadRecipe())) {
      const where = `stage ${name}`;
      expect([where, s.env.MOLT_HANDOFF]).toEqual([where, "parent"]);
      expect(s.handoff).not.toBeNull();
      expect([where, s.handoff!.file]).toEqual([where, `${OUT}/molt.log`]);
      expect([where, s.env.MOLT_STATUS_PATH]).toEqual([where, s.handoff!.file]);
      expect([where, s.stop_file]).toEqual([where, `${OUT}/stop`]);
      expect([where, s.env.SPINE_STOP_FILE]).toEqual([where, `${OUT}/stop`]);
      expect([where, s.env.SPINE_LEDGER]).toEqual([where, "{param.spine_dir}/autopilot-ledger.md"]);
      expect([where, s.before?.[0]]).toEqual([where, ["mkdir", "-p", OUT]]);
    }
  });

  const ROLES = {
    lane: "coordinator", regap: "coordinator", spine_open: "coordinator", spine_finish: "coordinator",
    implement: "implementer", close: "implementer", correct: "implementer",
    spine_work: "implementer", spine_review: "reviewer", verify: "verifier",
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
    for (const n of ["implement", "correct", "verify", "spine_review"]) {
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
    // a verdict from the last pass never routes this one: it goes before every launch
    expect(v.before).toEqual([["mkdir", "-p", OUT], ["rm", "-f", VERDICT]]);
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
      expect([name, s.outcomes]).toEqual([name, [
        { when: [{ exit0: PR_RECORDED }], to: "land" },
        { when: [{ file: PACKET }], to: "correct" },
      ]]);
      for (const field of ["{unit.vars.handoff_path}", "{unit.vars.worktree_path}", "{unit.vars.branch}", "{unit.vars.base_sha}", `Correction packet: ${PACKET}.`]) {
        expect([name, field, s.message.includes(field)]).toEqual([name, field, true]);
      }
    }
    const c = r.stages.correct;
    expect(c.message).toContain(`Correction packet: ${PACKET}.`);
    // cleared on the way to verify, never before a launch: a relaunched correction still reads it
    expect(c.outcomes[0].run).toEqual([["rm", "-f", `${OUT}/corrected`, PACKET]]);
    expect(c.before.flat()).not.toContain(PACKET);
  });

  test("the spine PR wait parks a conflict and keeps its order", () => {
    const w = loadRecipe().stages.spine_wait as WaitStage;
    const shape = w.outcomes.map((o) => [
      o.to, ...o.when.map((sig) => ("pr" in sig ? sig.pr.test : "exit0" in sig ? sig.exit0.slice(1, 3).join(" ") : "?")),
    ]);
    expect(shape).toEqual([
      ["spine_finish", "merged"],
      ["park", "closed"],
      ["park", "conflict"], // spine_work runs as an implementer: no merge, no force-push, so it cannot resolve one
      ["spine_work", "checks_red"],
      ["spine_work", "-qx verdict: block", "checks_green"],
      ["spine_ack", "-qx verdict: pass", "checks_green", "mergeable"],
    ]);
  });

  test("a spine PR round clears the operator file with the review", () => {
    const run = (loadRecipe().stages.spine_work as SessionStage).outcomes[0].run;
    expect(run).toEqual([["rm", "-f", `${OUT}/review.md`, `${OUT}/round-done`, `${OUT}/operator.md`]]);
  });

  test("land merges by plan (a)'s order", () => {
    const land = loadRecipe().stages.land as MergeStage;
    expect(land.kind).toBe("merge");
    expect(land.ordered).toBe(true);
    expect(land.checks).toBe("green");
    expect(land.base).toBe("{param.spine_branch}");
    expect(land.repo).toBe("{param.repo}");
    expect(land.outcomes).toEqual({ merged: "done", red: "park", conflict: "park" });
    expect(land.run_after).toEqual([
      ["sh", "-c", 'test "$(git -C "$1" symbolic-ref --short HEAD)" = "$2"', "sh", "{param.repo}", "{param.spine_branch}"],
      ["git", "-C", "{param.repo}", "merge", "--ff-only", "origin/{param.spine_branch}"],
      ["git", "-C", "{param.repo}", "merge-base", "--is-ancestor", "{pr.head}", "{param.spine_branch}"],
      ["env", "-C", "{param.ai_root}", "{param.oss}", "work_item_status", "{unit.id}", "complete"],
    ]);
  });

  test("build slot only where a build starts", () => {
    for (const [name, s] of sessions(raw() as Recipe)) {
      // verify's mutation check runs the item's tests
      const want = ["implement", "correct", "verify"].includes(name) ? ["session", "build"] : ["session"];
      expect([name, s.slots]).toEqual([name, want]);
    }
  });
});

// The briefs each seat reads (baton/examples/ossify-spine/briefs/). Prose, so the pins are
// the decisions a seat cannot do without: the never-wait line, the stop rule, the ledger
// append, the file each stage's outcome waits on.
const BRIEFS_DIR = join(import.meta.dir, "..", "examples", "ossify-spine", "briefs");
const brief = (name: string): string => readFileSync(join(BRIEFS_DIR, name), "utf8");
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
    // the three keys the queue source reads beyond ossify's own record, plus issued_at
    const queue = loadRecipe().sources.find((s) => s.stage === "implement")!;
    for (const key of [queue.group_key, queue.order_key, "issued_at"]) {
      expect([key, l.includes(`\`${key}\``)]).toEqual([key, true]);
    }
  });

  test("a gap re-entry rewrites only its own request", () => {
    expect(brief("regap.md")).toContain("writes **only this item's** replacement request");
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
      "then restore it from that saved copy — never from git", "after every mutation is restored",
      "temp name in the same directory, then `mv`",
    ]) {
      expect([pin, v.includes(pin)]).toEqual([pin, true]);
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

  test("common tells a relaunched seat to read the triage note first", () => {
    expect(brief("common.md")).toContain("<your OUT>/triage-note.md");
  });

  test("every session stage names its OUT, where common.md puts the triage note", () => {
    for (const [name, s] of sessions(loadRecipe())) {
      expect([name, s.message.includes(`OUT: ${OUT}.`)]).toEqual([name, true]);
    }
  });
});

describe("ossify-spine triage", () => {
  const triage = () => loadRecipe().triage!;
  const NOTE = "{run.dir}/out/{unit.id}/triage-note.md";

  test("no stage carries the retired T3 drop key", () => {
    expect(triage().env.OMP_T3_SEAT).toBeUndefined();
    expect(JSON.stringify(loadRecipe())).not.toContain("DROP_T3_MCP");
  });

  test("triage env carries stop file and ledger", () => {
    const t = triage();
    expect(t.env.SPINE_STOP_FILE).toBe(`${OUT}/stop`);
    expect(t.env.SPINE_LEDGER).toBe("{param.spine_dir}/autopilot-ledger.md");
    expect(t.env.SEAT_MODS_ALLOW).toBe(OUT);
    expect(t.env.SEAT_MODS_ROLE).toBe("orchestrator");
  });

  test("triage launch fields and note file", () => {
    const t = triage();
    expect([t.kind, t.role, t.project, t.cwd, t.launch_dir, t.title, t.stall_minutes]).toEqual(
      ["triage", "triage", "{param.ai_project}", "{param.ai_root}", "worktree", "triage {unit.id}", 10],
    );
    // the engine renders note_file outside a triage scope, so it names no {pending.*}
    expect(t.note_file).toBe(NOTE);
    expect(t.message).toContain(`Note file: ${NOTE}.`);
    expect(t.message).toContain(`Stop file: ${OUT}/stop.`);
    for (const k of ["stop_file", "watch", "before", "after_launch"]) expect(k in t).toBe(false);
    for (const ph of ["{pending.thread}", "{pending.stage}", "{pending.request}", "{pending.questions}"]) {
      expect([ph, t.message.includes(ph)]).toEqual([ph, true]);
    }
    expect(t.message).toContain("{param.briefs}/triage.md");
    // `baton answer` takes the run and the unit; the message is where the seat reads them.
    expect(t.message).toContain("Run: {run.id}. Unit: {unit.id}.");
  });

  test("triage brief checks the stop rule before answering", () => {
    const b = brief("triage.md");
    expect(b).toContain("checking in this order and stopping at the first that applies");
    const at = (h: string) => b.indexOf(h);
    expect(at("1. **Stop**")).toBeGreaterThan(-1);
    expect(at("1. **Stop**")).toBeLessThan(at("2. **Answer**"));
    expect(at("2. **Answer**")).toBeLessThan(at("3. **Correct**"));
    expect(b).toContain("answerable from the brief but touches an ADR, a bone or the skeleton is still a stop");
  });

  test("triage brief appends the ledger entry before the action", () => {
    // the engine may end the triage as soon as the stop file, the note or the answer lands
    const b = brief("triage.md");
    const ledger = b.indexOf("append one ledger entry to `$SPINE_LEDGER`");
    expect(ledger).toBeGreaterThan(-1);
    expect(ledger).toBeLessThan(b.indexOf("then take the action"));
    expect(b.indexOf("then take the action")).toBeLessThan(b.indexOf("then end the turn"));
  });

  test("triage brief maps every session stage to the brief its message names", () => {
    const b = brief("triage.md");
    expect(b).toContain("`_` written as `-`");
    for (const [name, s] of sessions(loadRecipe())) {
      const file = `${name.replaceAll("_", "-")}.md`;
      expect([name, s.message.includes(`{param.briefs}/${file}`)]).toEqual([name, true]);
    }
  });

  test("triage brief names the three actions and the answer shape", () => {
    const b = brief("triage.md");
    for (const pin of [
      "baton answer <run> <unit> \"<label>\"", "the chosen option's `label`, exactly",
      "Exit 75 (a tick holds the lock): wait a minute and retry once.", "Any other non-zero exit: write the note file and stop.", "triage-note.md",
      "$SPINE_STOP_FILE", "never approve a merge",
    ]) {
      expect([pin, b.includes(pin)]).toEqual([pin, true]);
    }
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
