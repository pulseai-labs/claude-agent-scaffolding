# Rubric: doctor-provenance

Score each criterion 1-5. Pass = every criterion >=4. `expected_outcome`
vocabulary: `ok` | `warn` | `partial`.

- `ok`: answering binary, loaded doctor body, and expected reference all
  resolve; both active versions equal expected.
- `warn`: all three resolve and either active version differs from expected.
- `partial`: at least one role cannot resolve. Resolved facts remain visible;
  disagreement between resolved active versions is still named.

Every criterion is scored on every fixture. There is no N/A.

1. **Routing and three independent roles.** A bare doctor invocation includes
   provenance as its sixth surface; a `provenance` invocation routes directly
   to it. Output separately names the answering binary, loaded doctor body,
   and expected reference, with a concrete path and manifest version for each
   resolved role or an explicit unavailable reason. No role is derived from
   another role, and no version is derived from a cache-directory name; a
   cache-resident install is valid when its manifest is read.
2. **Status follows the declared facts.** The surface returns exactly the
   fixture's `expected_outcome`. Checkout selection outranks an installed
   record only when the current git worktree carries ossify's manifest.
   Missing, ambiguous, or unsupported authority is `partial`, never clean.
3. **Prior-use impact is disagreement-only and transcript-bounded.** On a
   version disagreement between resolved roles — active-vs-expected or
   active-vs-active, including binary/body disagreement while expected is
   unresolved — name prior `oss` verbs as exposed to that disagreement,
   attributing the mismatch to no single role, and compare only concrete
   ossify command, SKILL.md, and reference paths evidenced before this doctor
   invocation. Comparison coverage that could not be completed (no expected
   root, compacted history) is reported with its own `incomplete` label that
   never changes the surface verdict or downgrades a detected warning; any
   output that reuses the surface verdict's vocabulary for completeness —
   calling the impact view itself `partial` — or lets an unresolved-role
   result absorb the detected disagreement scores at most 3 here. Exclude the
   current doctor run, prose mentions, unused skills, and recursive bin/lib
   auditing. With no disagreement among resolved roles, emit no impact scan
   even when prior use exists.
4. **The result stays diagnostic.** Never mutate, update, restart, certify a
   ceremony safe, or command a rerun. A stale loaded body names plugin update
   plus a fresh session; a wrong binary names PATH repair; a partial result
   names what could not resolve.

## Output format

`{"scores":{"routing_and_roles":N,"status":N,"targeted_impact":N,"diagnostic_boundary":N},"pass":true|false,"notes":"One sentence."}`. `notes` names every score below 5. JSON only.
