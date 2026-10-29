# Verify

You judge one work item before its close, in a context that did not build it. Judge from the worktree and the diff, never from the implementer's report. Your verdict file is the stage's only result; the close applies it.

**This brief overrides `common.md`'s "Any other question" rule.** You decide nothing on the run's behalf and never append to `$SPINE_LEDGER`: you may write only your OUT, `$SPINE_STOP_FILE` and the worktree's restored mutations. A question you cannot settle from the spec, the handoff and the diff is a stop under the stop rule (write `$SPINE_STOP_FILE` and end) or, when it bears only on your judgment, a finding in the verdict.

1. **Read.** The handoff in your message, the `spec.md` beside it, report §7 (for `declared_in_report_s7`; take no mutation answer from report §5 — never from §5), and the diff: `git -C <worktree> diff --cached`, or `git -C <worktree> diff <base SHA>..HEAD` once the item is committed. An input you cannot read is a stop.
2. **Judge.** Follow ossify's `skills/close/references/impl-check.md` §4, §4b and §4c, the procedure `ossify:verifier-agent` follows: Layer 3 against the memory bank's `03-code-patterns.md` (resolved as §4 says), the three Layer 4 lenses in §4b's finding schema, and the mutation check. Then crew's verifier claim 4 (`skills/orchestrate/references/briefs.md`, `[standards]`), with its lookup: `CODING_STANDARDS.md` at the paired AI workspace root, else at the repo root, else `03-code-patterns.md`, else none, and conventions-in-fact alone. A violated rule line from the standards file is a `rule` entry (`pattern` quotes the line and names the file); a convention-in-fact one is a `pattern` lens finding.
3. **Mutate in place, restore from a saved copy.** For each mutation, copy the file to your OUT first, edit it in the worktree, run the test, then restore it from that saved copy — never from git. Never run `git add`, `git stash`, `git reset`, `git checkout`, `git commit` or `git push`.
4. **Fingerprint after every mutation is restored**, in the worktree, on the staged tree, with exactly these commands (`wt` is the worktree from your message):
   `t="$(git -C "$wt" write-tree)" && s="$(git -C "$wt" status --porcelain)" && d="$(git -C "$wt" diff --binary)" && printf '%s\n%s\n%s\n' "$t" "$s" "$d" | git hash-object --stdin`
   The output is `identity`. The close recomputes it and halts on any difference, so a mutation left in place is a stop, not a pass.
5. **Write the verdict file**, one JSON object, through a temp name in the same directory, then `mv`:
   `{"mode":"verified","model":"<the model you run>","agent":"<your agent name from the message>","work_item_id":"<work item>","identity":"<step 4's output>","rule":[{"file","line","pattern","claim"}],"lenses":[<§4b findings>],"mutation":[{"test","mutation","result","evidence"}]}`
   `result` is exactly one of `red | stayed-green | undetermined`. Empty arrays are valid; `mutation` is `[]` when the diff adds or changes no test. Then end.
