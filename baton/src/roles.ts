import { ENV_DENYLIST, ENV_KEY_RE, isProtoName, PROTO_NAME_ERROR } from "./recipe.ts";

/** What one role launches on: the command line, how the brief reaches it, and what to expect back. */
export type RoleAgent = {
  agent: string;
  argv: string[];
  brief_delivery: "inject" | "file";
  expected_model: string;
  effort: string;
  env: Record<string, string>;
  review?: string;
};
/** Keyed by role name. */
export type RoleTable = Record<string, RoleAgent>;

/** Env keys the engine sets itself, so a table may not. */
const RESERVED_ENV = ["BATON_ROLE", "BATON_ROLE_TABLE"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function validateRoleTable(raw: unknown): { ok: true; table: RoleTable } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["table: must be an object keyed by role"] };
  const table: RoleTable = Object.create(null);
  for (const [role, v] of Object.entries(raw)) {
    const p = `${role}`;
    if (isProtoName(role)) {
      errors.push(`${p}: role ${PROTO_NAME_ERROR}`);
      continue;
    }
    if (!isObj(v)) {
      errors.push(`${p}: must be an object`);
      continue;
    }
    const str = (k: string) => {
      if (typeof v[k] !== "string" || v[k] === "") errors.push(`${p}.${k}: must be a non-empty string`);
    };
    str("agent");
    str("expected_model");
    str("effort");
    const argv = v.argv;
    if (!Array.isArray(argv) || argv.length === 0) errors.push(`${p}.argv: must be a non-empty array`);
    else
      argv.forEach((a, i) => {
        if (typeof a !== "string" || a.includes("\0")) errors.push(`${p}.argv[${i}]: must be a string without NUL`);
      });
    if (v.brief_delivery !== "inject" && v.brief_delivery !== "file") errors.push(`${p}.brief_delivery: must be "inject" or "file"`);
    if (!isObj(v.env)) errors.push(`${p}.env: must be an object`);
    else
      for (const [k, val] of Object.entries(v.env)) {
        if (!ENV_KEY_RE.test(k) || ENV_DENYLIST.includes(k) || RESERVED_ENV.includes(k)) errors.push(`${p}.env.${k}: denied key`);
        else if (typeof val !== "string" || val.includes("\0")) errors.push(`${p}.env.${k}: must be a string without NUL`);
      }
    if (v.review !== undefined && typeof v.review !== "string") errors.push(`${p}.review: must be a string`);
    table[role] = v as unknown as RoleAgent;
  }
  return errors.length ? { ok: false, errors } : { ok: true, table };
}
