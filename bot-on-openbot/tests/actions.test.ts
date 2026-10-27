import { expect, test } from "bun:test";
import {
  answerScreen, answerText, defaultRunner, disarm, merge, prView, screen, unpark, unparkTo, type Runner,
} from "../src/actions.ts";

const recorder = () => {
  const seen: string[][] = [];
  const r: Runner = async (argv) => {
    seen.push(argv);
    return { rc: 0, stdout: "", stderr: "" };
  };
  return { seen, r };
};

test("each action builds exactly its fixed argv", async () => {
  const { seen, r } = recorder();
  await unpark("r1", "u1", r);
  await unparkTo("r1", "u1", "build", r);
  await disarm("r1", r);
  await merge("https://github.com/o/r/pull/38", "a".repeat(40), r);
  await prView("https://github.com/o/r/pull/38", r);
  expect(seen).toEqual([
    ["baton", "unpark", "r1", "u1"],
    ["baton", "unpark", "r1", "u1", "--to", "build"],
    ["baton", "disarm", "r1"],
    ["gh", "pr", "merge", "https://github.com/o/r/pull/38", "--merge", "--match-head-commit", "a".repeat(40)],
    ["gh", "pr", "view", "https://github.com/o/r/pull/38", "--json", "number,baseRefName"],
  ]);
});

test("actions argv for screen, answerScreen and answerText", async () => {
  const { seen, r } = recorder();
  await screen("r1", "u5", r);
  await answerScreen("r1", "u5", "2026-10-27T16:50:00.000Z", 2, "green", r);
  await answerText("r1", "u5", "2026-10-27T16:50:00.000Z", "use main; $HOME", "spike: which colour?", r);
  expect(seen).toEqual([
    ["baton", "screen", "r1", "u5"],
    ["baton", "answer", "r1", "u5", "--park", "2026-10-27T16:50:00.000Z", "--screen", "2", "green"],
    ["baton", "answer", "r1", "u5", "--park", "2026-10-27T16:50:00.000Z", "--screen-text", "use main; $HOME", "--question", "spike: which colour?"],
  ]);
});

test("defaultRunner returns rc, stdout and stderr, and passes argv with no shell", async () => {
  const res = await defaultRunner(["sh", "-c", 'printf out; printf "err $0\\n" >&2; exit 3', "$HOME"]);
  expect(res).toEqual({ rc: 3, stdout: "out", stderr: "err $HOME\n" });
});

test("defaultRunner turns a missing binary into a failed result, not a throw", async () => {
  const res = await defaultRunner(["bot-on-openbot-no-such-binary-xyz"]);
  expect(res.rc).not.toBe(0);
  expect(res.stderr).toBe("bot-on-openbot-no-such-binary-xyz: could not start");
});
