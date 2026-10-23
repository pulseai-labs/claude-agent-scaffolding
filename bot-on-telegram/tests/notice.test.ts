import { expect, test } from "bun:test";
import { parseKey } from "../src/notice.ts";

test("the five key shapes", () => {
  expect(parseKey("r1/run/park/2026-10-23T10:00:00Z")).toEqual({ kind: "run-park", run: "r1" });
  expect(parseKey("r1/u1/park/x")).toEqual({ kind: "unit-park", run: "r1", unit: "u1" });
  expect(parseKey("r1/u1/spine_ack/2026-10-23T10:00:00Z")).toEqual({
    kind: "unit-move", run: "r1", unit: "u1", stage: "spine_ack",
  });
  expect(parseKey("r1/done")).toEqual({ kind: "run-done", run: "r1" });
  expect(parseKey("auth/2026-10-23")).toEqual({ kind: "plain" });
});

test("ids failing baton's patterns are plain", () => {
  expect(parseKey("R1/u/park/x")).toEqual({ kind: "plain" });
  expect(parseKey("r1/u1/Bad-Stage/x")).toEqual({ kind: "plain" });
  expect(parseKey("r1/u 1/park/x")).toEqual({ kind: "plain" });
  expect(parseKey("down/2026-10-23")).toEqual({ kind: "plain" });
  expect(parseKey("token/2026-10-23")).toEqual({ kind: "plain" });
  expect(parseKey("")).toEqual({ kind: "plain" });
});

test("a unit named run under /park/ is a run-park (documented limit)", () => {
  expect(parseKey("r1/run/park/x")).toEqual({ kind: "run-park", run: "r1" });
});
