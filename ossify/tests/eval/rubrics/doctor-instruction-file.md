# Rubric: doctor-instruction-file

Score each 1-5 (4 criteria). Pass = all ≥4. `expected_outcome` vocabulary:
`repair-rename` (no `AGENTS.md`; once the operator says yes, §5's branch 1 moves
the `CLAUDE.md` — root or `.claude/` — to `AGENTS.md`, re-checks its imports and
re-emits both lines, committing nothing) |
`repair-merge-asks` (both files exist; once the operator says yes, §5's branch 2
merges, keeping every rule and fact, dropping pointer-only lines, showing each
disagreement to the operator instead of resolving it, showing the whole merged
file before writing, removing the `CLAUDE.md`, committing nothing) |
`report-only` (the read-out names both failures and offers the repair with what
it would change, and the operator says no: nothing is written, moved, merged or
deleted, nothing is committed, and the two failing lines are NOT re-emitted as
`ok:`).

**Every criterion is scored on every fixture.** A criterion whose own condition
does not arise in a fixture is scored on whether the skill correctly stayed
silent about it — or reported the clean line — the same convention
`doctor-declared-repos` and `close-per-repo` use. There is no N/A.

1. **Line correctness — the `agents_md` and `claude_md` lines match the
   fixture's files exactly.** `doctor/references/interop-check.md` §3: `agents_md`
   requires `AGENTS.md` at the AI-workspace root, existing and naming ossify;
   `claude_md` looks at `CLAUDE.md` at that root **and** at
   `<ai_workspace.root>/.claude/CLAUDE.md`. Both come out in the same
   `ok:`/`fail:` grammar as every other line, in check order, naming the path the
   fixture gave. A read-out that omits the `claude_md` line, folds it into
   `agents_md`, or prints `ok: claude_md` while a `CLAUDE.md` exists is wrong
   even when the closing verdict happens to be right. When §5 has run, the
   re-emitted lines must describe the new state, not the old one; when it has
   not, re-emitting a failed line as `ok:` with the file still in place is the
   wrong answer.
2. **Repair gated — nothing is written before the operator's yes, and the branch
   that runs is the one §5 names for this shape.** §5: "offer to repair it. Show
   the operator every change first — the move, or the whole merged file — and do
   nothing until the operator says yes." A transcript that moves, merges,
   deletes or writes any instruction file before that yes fails this criterion
   regardless of the tree it ends with. With a yes, a fixture holding no
   `AGENTS.md` must take branch 1 (rename) and a fixture holding both files must
   take branch 2 (merge) — running the wrong branch, or neither, is wrong
   whether or not the check lines were right. With a no, the offer must still
   have shown what it would change, and the tree must be untouched.
3. **Merge fidelity — no rule or fact is lost, pointer-only lines go, a
   disagreement is shown and not resolved.** §5 branch 2: "Keep every rule and
   fact from both files. Drop lines whose only job was to point from one file to
   the other ("Read `CLAUDE.md` for …"). Where the two files disagree, do not
   pick one: show both versions and ask the operator. Show the operator the whole
   merged file before you write it." On a fixture where the two files disagree,
   silently choosing one version of the disputed rule fails even if every other
   part of the merge is right. Where there is nothing to merge — a rename, or no
   write at all — this criterion is scored on the skill not inventing a merge and
   not losing content that existed before.
4. **Import check and no commit.** §5 branch 3: every `@` import in the new
   `AGENTS.md` is listed with whether it resolves; a relative import whose base
   changed with the move is fixed or reported as broken, and an absolute import
   outside the workspace is flagged as possibly needing approval again. §5 branch
   4: "**Never commit.** Report what changed and leave the commit to the
   operator." A `git add`, `git commit`, or an unstated commit anywhere in the
   transcript fails this criterion on every fixture, including one where
   nothing was written. Where no new `AGENTS.md` was produced, the import half is
   scored on the skill correctly not claiming to have checked imports it never
   re-listed.

## Output format
`{"scores":{"line_correctness":N,"repair_gated":N,"merge_fidelity":N,"import_check_no_commit":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all ≥4. JSON only.
