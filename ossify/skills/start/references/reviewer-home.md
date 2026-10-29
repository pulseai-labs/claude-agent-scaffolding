Followed by /ossify:start and /ossify:adopt, and on its own for a project that ossify already runs (§6).

# Reviewer home — the standards stub, the review ledger and the Review section

Depth for SKILL.md §13. `/start` gives the project a place for its reviewer to read from and
write to.

---

## 1. Outputs

| Output | Path | Written later by |
|---|---|---|
| Standards stub | `<ai-workspace>/CODING_STANDARDS.md` | the operator |
| Review ledger | `<memory-bank>/review-ledger.md` | merge-bar `working-a-pr` §5, one line per merged PR |
| Review section | `## Review` in `<memory-bank>/08-governance.md` | the operator |

Nothing here lands in a declared repo.

- **Resolve** the workspace root with `oss repo_root ai_workspace` and the memory bank by
  `close/references/harvest.md`, "Where the bank is". No other path logic.
- **Never overwrite.** An occupied destination is named and asked about, per
  `occupied-destinations.md`. A kept file is left as it is.
- **Refuse and write nothing** when posture marks the AI workspace root as public, or when
  `oss repo_root ai_workspace` equals the root of a declared repo. Say why, and stop.

## 2. The standards stub

Three parts and nothing else. No fill-in markers, no `TODO`, no empty rule headings, and no entries:
`/start` never writes an entry.

1. **Header**, one paragraph. Who reads the file: the reviewer (merge-bar `reviewing-a-pr`) and the
   crew verifier's standards claim. No implementer brief points at it. Entries sit over merge-bar's
   baseline and override it where they conflict. Each entry is a defect class with a rule, a
   **Why** and its source PRs, and the reviewer sweeps the repo for it, not only the diff.
2. **`## Read these where they live`**, a pointer list. Add a line only for a file that exists
   and carries rules: the canonical's `CLAUDE.md` sections on testing or review, a style guide, the memory bank's
   `03-code-patterns.md`. The `03-code-patterns.md` line is written whenever that file exists, even
   when this run authored it with an empty machine-checkable rules section, because crew's
   verifier stops at the first standards file and so reads the stub instead of `03-code-patterns.md`.
   Every other pointer needs its file to exist and carry rules. Pointers only. Never copy a
   project doc or merge-bar's baseline into the stub. When no pointer can be written, keep the
   heading and say in one sentence that the project has no such docs yet.
3. **One sentence of current state**, verbatim: `No project entries yet. Entries come from review findings that recur, accepted by the operator.`

## 3. The review ledger

The file is `# Review ledger — <project>` and one paragraph: one line means one merged PR, it is
written by merge-bar `working-a-pr` §5 in the shape that section sets, and `retro` and the operator
read it. The file holds no line of its own at creation, and this file states no line format.

## 4. The review section

`## Review` is part of `08-governance.md` as this run authors it at §13, four lines. When
`08-governance.md` was an occupied destination the operator chose to keep, do not add the section
and never append to the kept file; name it in the hand-off so the operator can add it by hand.
The four lines:

- the standards file path;
- the review ledger path, and `tech-debt.md` for the `[KL]`/`[TD]` lines;
- the reviewer: merge-bar `reviewing-a-pr`, at the seat the project's crew file or standing orders
  name, or the operator's choice per PR when neither does. Name no model;
- CodeRabbit or any CI review, when the project has one, as an extra that gates nothing. Omit this
  line when the project has none.

## 5. Adopt's history pass

After §1–§4 are written, adopt reads the project's review history and proposes the first entries.
Sources:

- review comments and review bodies on the last 30 merged PRs (`gh`), or all of them if fewer;
- any review ledger already in the AI workspace;
- `[KL]` and `[TD]` lines in `tech-debt.md`;
- review sections of the canonical's `CLAUDE.md`. These become pointers in the stub's
  `## Read these where they live`, never entries.

A finding becomes a proposal only when it recurs in two or more PRs. Each proposal states the class,
the rule, the **Why** and the source PRs. The operator accepts, edits or rejects each one.
Only accepted entries are written. They go under `## Entries` in `CODING_STANDARDS.md`. In a stub
this run wrote, the first accepted entry removes the stub's `No project entries yet.` sentence, which
the entry makes false. Never edit a pre-existing standards file.

When `CODING_STANDARDS.md` already exists, write nothing to it. List the proposals in `ADOPTION.md`
for the operator to place. `<m>` counts entries written to the file, so it is 0 here, and the result
line says where the proposals went (below).

Adopt never overwrites: on an adopted project `08-governance.md` is occupied, so append its
`## Review` section (§4) only when the file has none, with adopt's provenance trailer
(`adopt/SKILL.md` C5; a §6 standalone run writes none). Otherwise leave the file and name it in the hand-off.

`ADOPTION.md` gets one line: `Reviewer home: <n> proposed, <m> accepted, window <first PR>–<last PR>`,
with an existing standards file, `<m>` is 0 and the line reads
`Reviewer home: <n> proposed, 0 accepted (standards file kept; proposals listed below), window <first PR>–<last PR>`;
or `Reviewer home: no review history` when there is none. With no history the stub stays plain.

## 6. On an existing project

For a project ossify already started or adopted. Follow §1–§5 as written, with these changes:

- Run no adopt station. Append the `## Review` section with no provenance trailer: adopt's
  `source: adoption` and `r0 baseline` do not apply to a project it did not adopt.
- `ADOPTION.md` may not exist. Record the result line as a fifth line in the `## Review` section
  of `08-governance.md`, the section that holds the four lines of §4.
- When `08-governance.md` has no `## Review` section, add it, as part of seeding the project.
  Never edit any other part of the file.
