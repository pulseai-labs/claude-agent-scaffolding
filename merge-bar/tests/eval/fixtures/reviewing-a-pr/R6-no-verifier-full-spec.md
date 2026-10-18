---
scenario_id: R6-no-verifier-full-spec
expected_outcome: full-spec-axis-against-plan
expected_reason: no verifier report exists, so the header reads `Verifier report: none (full Spec axis)` and the Claim/Spec axis checks the diff against the plan the PR names, task by task, stating each task's result — Tasks 1, 3 and 4 are done (a test gap against them may be its own non-blocking class); Task 2 is not, because lib/manifest.sh:9 writes each entry's path but no `sha256`, which also makes the Claim false — one blocking class for that defect, condition 2, sweep stated; other real defects in the shown code (e.g. a `DIR/` trailing slash that puts the outputs inside DIR) may be reported as their own classes; and the diff's change to lib/import.sh (a variable rename) is outside Scope and outside the plan — reported as its own class, non-blocking; standards come from the paired workspace's `/home/dev/projects/bundler-ai/CODING_STANDARDS.md`, named in the header; a report that checks only the Claim and never reads the plan fails inputs_resolved, and one that misses the import.sh change, or sorts it blocking, fails class_complete or bar_sorted
---
Review PR `acme/bundler#140` ("export: archive plus manifest"), a superpowers PR opened by
hand — no crew run, no verifier. Invoked as `/merge-bar:review-pr 140` from the checkout
`/home/dev/projects/bundler`. Round 1. Everything the review can read is below. A search of
the checkout finds only what is shown.

`gh pr view 140 --json body,headRefOid,baseRefName,files`: `headRefOid`
`e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3`, `baseRefName` `main`, files `bin/bundle`,
`lib/manifest.sh`, `lib/import.sh`, `tests/test-export.sh`. `git rev-parse HEAD` prints the
same SHA.

`/home/dev/projects/bundler-ai/.workspace/pairing.json` names canonical `bundler`; its root
holds `CODING_STANDARDS.md`:

```markdown
- Quote every expansion that holds a path.
- Build JSON with `jq -n --arg`, never by string concatenation.
```

The PR body:

```markdown
## Claim
`bundle export DIR` writes `DIR.tar.gz` and `DIR.manifest.json`, which lists every file with
its sha256. `bundle export --dry-run DIR` prints the file list and writes nothing.

## Scope
Touches: `bin/bundle`, `lib/manifest.sh`, `tests/test-export.sh`. Deliberately does not
touch: import, `lib/import.sh`. Plan: `docs/superpowers/plans/2026-10-01-bundle-export.md`
in the paired workspace.

## Known limits
- Symlinks are archived as links, not followed — matches `tar`'s default.

## Merge danger
Door: two-way — a new subcommand; a revert removes it and nothing reads its output yet.
Blast radius: anyone scripting `bundle export`.

## Merge bar
A finding blocks this PR only if it:
1. rejects valid input, or corrupts or loses state, on a path this PR touches;
2. makes the Claim above false;
3. breaks the test suite;
4. opens a security hole — injection, authentication bypass, or an exposed secret.
Everything else is non-blocking.

## Evidence
`bash tests/test-export.sh` — 5 passed.

## Closes
Closes #133
```

The plan, `/home/dev/projects/bundler-ai/docs/superpowers/plans/2026-10-01-bundle-export.md`:

```markdown
### Task 1: `bundle export DIR` writes `DIR.tar.gz` holding every file under DIR.
### Task 2: beside it, `DIR.manifest.json`: `{"files":[{"path":P,"sha256":H}, ...]}`,
one entry per archived file, H the file's sha256.
### Task 3: `--dry-run` prints the paths it would archive, one per line, and writes nothing.
### Task 4: `tests/test-export.sh` covers Tasks 1–3.
```

The diff:

`bin/bundle` (new `export` subcommand, lines 40–58): collects `find "$dir" -type f` into an
array, prints it and exits 0 under `--dry-run`, else runs `tar -czf "$dir.tar.gz" -C "$dir"
.` and then `write_manifest "$dir" "${files[@]}"`. Every expansion is quoted.

`lib/manifest.sh` (new):

```bash
3  write_manifest() {
4    local dir=$1; shift
5    local out="$dir.manifest.json" entries=()
6    local f
7    for f in "$@"; do
8      entries+=("$(jq -n --arg p "${f#"$dir"/}" '{path: $p}')")
9    done
10   jq -s '{files: .}' <<<"${entries[*]}" > "$out"
11 }
```

`lib/import.sh` (lines 10–18): the local variable `f` is renamed `file` in `import_one`, six
lines; behaviour is unchanged.

`tests/test-export.sh` (new, five tests): archive exists and lists every file; manifest has
one entry per file (`jq '.files | length'`); `--dry-run` prints the paths; `--dry-run` writes
no `.tar.gz`; `--dry-run` writes no manifest. No test reads a `sha256` field.

Outside the diff: nothing else in the checkout calls `write_manifest` or computes a sha256;
`lib/import.sh` is called only by `bin/bundle import`.
