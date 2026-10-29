// The prose that seats and orchestrators follow, pinned on the lines they cannot do without:
// the skill's approval stop and no-watch rule (#969 C11), and each done-file brief's last step
// (#908). Prose, so the pins are exact phrases, each with a control that fails without it.
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
    expect(s).toContain("wait for an explicit yes to\nthat command");
  });

  test("after arming, a watch request runs no command and the close is baton's", () => {
    const s = skill();
    expect(s).toContain('"Keep an eye on it" is not a status request: run\n  no command.');
    expect(s).toContain("Do not start `/ossify:close` beside it.");
  });
});

describe("done-file briefs", () => {
  for (const [name, file] of [["correct.md", "Corrected file"], ["spine-work.md", "Round done file"]]) {
    test(`${name} ends by writing its ${file}`, () => {
      expect(lastStep(brief(name))).toContain(`: > <${file} from your message>`);
    });
  }

  test("control: a brief whose done-file write is not the last step fails", () => {
    expect(lastStep("1. Write the file: `: > <Corrected file from your message>`.\n2. End.")).not.toContain(": > <");
    expect(lastStep("prose only")).toBe("");
  });
});
