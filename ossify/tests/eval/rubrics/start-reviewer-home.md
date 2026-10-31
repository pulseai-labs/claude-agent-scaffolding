# Rubric: start-reviewer-home

Score each 1-5 (4 criteria). Pass = all ≥4. `expected_outcome` vocabulary:
`seed` (every output whose destination is free is written, in the AI workspace) |
`ask-occupied` (an occupied destination is named and asked about, and the free ones are seeded) |
`refuse` (the AI workspace is public, or the workspace root is a declared repo's root or inside one: nothing is written) |
`withhold-bank` (only the memory bank is in a declared repo: the stub is seeded at the workspace root, the ledger and `## Review` are withheld).

**Every criterion is scored on every fixture.** A criterion that names a stop is scored, on a
fixture where it should not fire, on whether the skill correctly held off. There is no N/A.

1. **Placement** — every output lands in the AI workspace: `CODING_STANDARDS.md` at its root,
   `review-ledger.md` in the memory bank, the `## Review` section in `08-governance.md`. Nothing
   lands in a declared repo. Where the AI workspace is public or is a declared repo root, the
   skill refuses and writes nothing; writing anyway scores 1.
2. **No overwrite** — an occupied destination is named with its path and asked about, and is not
   written over, merged into or moved before the operator answers. Free destinations are written
   without a stop. Inventing an occupied file, or asking about a free one, scores ≤2.
3. **The stub** — it has only the header, the `## Read these where they live` list and the
   one-sentence current state. A pointer line appears only for a file the fixture says exists,
   and none copies a project doc's rules. There is no `TODO`, fill-in marker, empty rule heading
   or entry. A literal placeholder such as `<memory-bank>` in a seeded file scores 2 or lower. The `03-code-patterns.md` pointer is written whenever that file exists, even with an empty rules section; a fixture with no other project docs gets only that pointer. Where nothing is written, score
   this on whether the skill held off.
4. **No model name** — the governance `## Review` section names no model. It points at the
   crew file or standing orders for the reviewer seat, and names CodeRabbit or CI review only
   when the project has one. A model name anywhere in a seeded file scores ≤2.

## Output format
`{"scores":{"placement":N,"no_overwrite":N,"stub":N,"no_model_name":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all ≥4. JSON only.
