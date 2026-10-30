// The prose that seats and orchestrators follow, pinned on the lines they cannot do without:
// the skill's approval stop and no-watch rule (#969 C11), and each done-file brief's last step
// (#908). Prose, so the pins are exact phrases, each read on one line of its source.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILL = join(import.meta.dir, "..", "skills", "running-a-spine-on-baton", "SKILL.md");
const BRIEFS_DIR = join(import.meta.dir, "..", "examples", "ossify-spine", "briefs");
const skill = (): string => readFileSync(SKILL, "utf8");
const brief = (name: string): string => readFileSync(join(BRIEFS_DIR, name), "utf8");

/** The frontmatter's `description` value, or "" when there is none. */
function description(md: string): string {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md);
  return /^description: (.*)$/m.exec(fm?.[1] ?? "")?.[1] ?? "";
}

/** The last numbered step of a brief, or "" when it has none. */
function lastStep(md: string): string {
  const steps = md.split("\n").filter((l) => /^\d+\. /.test(l));
  return steps.at(-1) ?? "";
}

describe("running-a-spine-on-baton", () => {
  test("the description tells baton arm apart from /ossify:run-spine", () => {
    const d = description(skill());
    expect(d).toContain('"on baton"');
    expect(d).toContain("`/ossify:run-spine`");
    expect(description("no frontmatter")).toBe("");
  });

  test("the approval stop survives a waiver and a changed value", () => {
    const s = skill();
    expect(s).toContain("do not waive this step");
    expect(s).toContain("A yes that changes or supplies a value is not that yes");
    expect(s).toContain("wait for an explicit yes");
  });

  // #993: seats come from crew's two files, resolved at arm time and approved with the command.
  test("the seat step reads crew's two files and stops on a role with no row", () => {
    const s = skill();
    expect(s).toContain("`.crew/roles.md`");
    expect(s).toContain("`~/.claude/crew/agents.md`");
    expect(s).toContain("A role with no row is one question, and arms nothing");
  });

  test("the seat table is shown with the command, and written only after the yes", () => {
    const s = skill();
    expect(s).toContain("| Stage | Role | Agent | Command | Model | Effort | From |");
    expect(s).toContain("--seats /home/<user>/baton-recipes/seats/<run>.json");
    expect(s).not.toContain("--seats ~");
    expect(s).toContain("never `~/…`");
    expect(s).toContain("Write the seat file only after the yes");
    // The write comes after the stop, never before it.
    expect(s.indexOf("Write the seat file only after the yes")).toBeGreaterThan(s.indexOf("wait for an explicit yes"));
  });

  test("an argv is built only from a plain program, Devin's ends with --, review drops its PR placeholder", () => {
    const s = skill();
    expect(s).toContain("a shell function or an alias");
    expect(s).toContain("End a Devin agent's argv with `--`");
    expect(s).toContain("drop a trailing `<PR_URL>` or `<PR>`");
  });

  test("via is gone from the skill and the README's arm example", () => {
    expect(skill()).not.toMatch(/\bvia\b/);
    const readme = readFileSync(join(import.meta.dir, "..", "README.md"), "utf8");
    expect(readme).not.toContain("--param via=");
    expect(readme).toContain("--seats <file>");
    expect("--param via=x").toContain("--param via="); // control: the probe matches the old line
  });

  test("after arming, a watch request runs no command and the close is baton's", () => {
    const s = skill();
    expect(s).toContain('"Keep an eye on it" is not a status request');
    expect(s).toContain("Do not start `/ossify:close` beside it.");
  });
});

describe("done-file briefs", () => {
  // The label each stage's message gives its done file, read from the recipe.
  const recipe = JSON.parse(readFileSync(join(BRIEFS_DIR, "..", "recipe.json"), "utf8"));
  const labels = (stage: string): string[] =>
    [...String(recipe.stages[stage].message).matchAll(/([A-Z][a-z]+(?: [a-z]+)* done file|Corrected file): /g)].map((m) => m[1]);
  for (const [name, stage] of [["correct.md", "correct"], ["spine-work.md", "spine_work"], ["lane.md", "lane"]]) {
    test(`${name} ends by writing the done file its stage's message names`, () => {
      const ls = labels(stage);
      expect(ls.length).toBeGreaterThan(0);
      for (const l of ls) expect([l, lastStep(brief(name)).includes(`: > <${l} from your message>`)]).toEqual([l, true]);
    });
  }

  test("control: a brief whose done-file write is not the last step fails", () => {
    expect(lastStep("1. Write the file: `: > <Corrected file from your message>`.\n2. End.")).not.toContain(": > <");
    expect(lastStep("prose only")).toBe("");
  });
});
