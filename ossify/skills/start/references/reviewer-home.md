# Reviewer home — the standards stub, the review ledger and the Review section

Depth for SKILL.md §13. `/start` gives the project a place for its reviewer to read from and
write to. This file can also be followed on its own for an existing ossify project (§6).

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
   `03-code-patterns.md`, once its machine-checkable rules section holds a rule (a freshly seeded,
   empty section gets no line). Pointers only. Never copy a project doc or
   merge-bar's baseline into the stub. When no such file exists, keep the heading and say in one
   sentence that the project has no such docs yet.
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
