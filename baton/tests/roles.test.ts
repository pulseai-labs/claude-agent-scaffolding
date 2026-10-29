import { expect, test } from "bun:test";
import { validateRoleTable } from "../src/roles.ts";

const good = () => ({
  verifier: { agent: "claude", argv: ["claude", "--model", "x"], brief_delivery: "inject", expected_model: "x", effort: "high", env: { FOO: "1" } },
});

test("valid-table", () => {
  const r = validateRoleTable(good());
  expect(r.ok).toBe(true);
});

test("empty-argv-refused", () => {
  const t = good();
  t.verifier.argv = [];
  const r = validateRoleTable(t);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors[0]).toContain("verifier.argv");
});

test("reserved-env-key-refused", () => {
  for (const k of ["BATON_ROLE", "BATON_ROLE_TABLE", "PATH", "lower"]) {
    const t = good();
    t.verifier.env = { [k]: "1" };
    expect(validateRoleTable(t).ok).toBe(false);
  }
});

test("unknown-delivery-refused", () => {
  const t: any = good();
  t.verifier.brief_delivery = "pipe";
  expect(validateRoleTable(t).ok).toBe(false);
});

test("non-object and NUL argv refused", () => {
  expect(validateRoleTable([]).ok).toBe(false);
  const t = good();
  t.verifier.argv = ["a\0b"];
  expect(validateRoleTable(t).ok).toBe(false);
});
