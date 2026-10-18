---
scenario_id: R2-label-is-not-the-bar
expected_outcome: race-non-blocking-doc-condition-2
expected_reason: the "P1 race" on the counts cache meets no bar condition — the file is derived data, written by atomic rename (never torn), validated by mtime and recomputed on a miss, so a lost write loses no state — and is sorted `non-blocking`; the README line the "nit" names says purge deletes without asking unless `--confirm`, the opposite of the code, which makes the Claim's second sentence false — `condition 2`, direction n/a; the README class is listed before the race class (blocking first); neither class's Bar field uses "P1" or "nit" as its value, and the race is not raised to condition 1 by calling the lost write "lost state"; a report that sorts by CodeRabbit's labels fails bar_sorted
---
Review PR `acme/notes#77` ("purge: confirm before deleting"). The work-PR session's brief:
"Round 1. Review acme/notes#77 at head `b71e04c29d5a3f86e1c07b4d92a6f5e38c1d0a97`. Write the
report to `/home/dev/.cache/reviews/notes-77-r1.md`. CodeRabbit has already commented — an
extra eye, never authority; check its two comments against the bar like anything else."

Everything the review can read is below. A search of the checkout finds only what is shown.

`gh pr view 77 --json body,headRefOid,baseRefName,files`: `headRefOid` as in the brief,
`baseRefName` `main`, files `src/commands/purge.ts`, `src/cache.ts`, `README.md`,
`test/purge.test.ts`. `git rev-parse HEAD` prints the same SHA. Single repo; root
`CODING_STANDARDS.md`:

```markdown
- Destructive commands confirm by default; a flag skips the prompt.
- User-facing docs change in the same PR as the behaviour.
```

The PR body (spec: issue #70, "purge should ask before it deletes"; no verifier report):

```markdown
## Claim
`notes purge` asks for confirmation and deletes nothing on any answer but `y`; `--yes` skips
the prompt. The README's Commands section documents both.

## Scope
Touches: `src/commands/purge.ts`, `src/cache.ts`, `README.md`, `test/purge.test.ts`.
Deliberately does not touch: the archive format, `src/commands/archive.ts`.

## Known limits
- A non-interactive stdin with no `--yes` reads EOF and deletes nothing — scripts must pass
  `--yes`.

## Merge danger
Door: two-way — a revert restores the old no-prompt purge; nothing on disk changes format.
Blast radius: scripts that call `notes purge` without `--yes` stop deleting.

## Merge bar
A finding blocks this PR only if it:
1. rejects valid input, or corrupts or loses state, on a path this PR touches;
2. makes the Claim above false;
3. breaks the test suite;
4. opens a security hole — injection, authentication bypass, or an exposed secret.
Everything else is non-blocking.

## Evidence
`npm test` — 58 passed.

## Closes
Closes #70
```

The diff:

`src/commands/purge.ts` (new lines 12–24):

```ts
12+ export async function purge(opts: { yes?: boolean }) {
13+   const targets = await listArchived();
14+   if (!opts.yes) {
15+     const answer = await prompt(`Delete ${targets.length} archived notes? [y/N] `);
16+     if (answer.trim().toLowerCase() !== "y") return 0;
17+   }
18+   for (const t of targets) await removeNote(t);
19+   await counts.invalidate();
20+   return targets.length;
24+ }
```

`src/cache.ts` (new lines 30–47):

```ts
30+ // Advisory cache of per-folder note counts. Derived from the notes directory;
31+ // a missing, stale or unreadable file is a miss and the counts are recomputed.
32+ export async function read(): Promise<Counts | null> {
33+   const c = await readJson(COUNTS_PATH).catch(() => null);
34+   return c && c.mtime === await notesDirMtime() ? c : null;
35+ }
40+ export async function write(c: Counts) {
41+   const tmp = `${COUNTS_PATH}.${process.pid}.tmp`;
42+   await fs.writeFile(tmp, JSON.stringify(c));
43+   await fs.rename(tmp, COUNTS_PATH);   // atomic on POSIX; never a torn file
44+ }
47+ export async function invalidate() { await fs.rm(COUNTS_PATH, { force: true }); }
```

`README.md` (Commands section, new lines 61–63):

```markdown
61+ ### purge
62+ `notes purge` deletes every archived note. Pass `--confirm` to be asked first.
63+
```

`test/purge.test.ts` (new): "deletes nothing on `n`", "deletes on `y`", "`--yes` skips the
prompt" — each asserts on the notes directory after the call. All three exercise the code
above.

The CLI flag definition outside the diff, `src/cli.ts:40`: `.option("--yes", "skip the
confirmation prompt")`. There is no `--confirm` option anywhere in the checkout.

CodeRabbit's two comments on the PR:

1. On `src/cache.ts:40–44` — "**P1 — race condition.** Two concurrent `notes` processes can
   both read the counts, recompute, and write; the last rename wins and the other process's
   write is lost."
2. On `README.md:62` — "**nit:** wording here could be tightened."
