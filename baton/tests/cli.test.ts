import { expect, test } from "bun:test";
import { join } from "node:path";

const BIN = join(import.meta.dir, "..", "bin", "baton");
const FIX = join(import.meta.dir, "fixtures", "recipes");

async function run(...args: string[]) {
  const p = Bun.spawn([BIN, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, rc] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, rc };
}

test("baton validate: rc 0 on the relay fixture", async () => {
  const r = await run("validate", join(FIX, "relay.json"));
  expect(r.rc).toBe(0);
});

test("baton validate: rc 2 with one error per line on stderr", async () => {
  const r = await run("validate", join(FIX, "bad-version.json"));
  expect(r.rc).toBe(2);
  expect(r.err.trim().split("\n")).toEqual(["version: must be 1"]);
});

test("baton validate: an unreadable file is rc 2", async () => {
  const r = await run("validate", join(FIX, "nope.json"));
  expect(r.rc).toBe(2);
});

test("baton with no command is a usage error", async () => {
  expect((await run()).rc).toBe(64);
});
