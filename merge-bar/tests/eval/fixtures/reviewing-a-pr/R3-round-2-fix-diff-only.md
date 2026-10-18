---
scenario_id: R3-round-2-fix-diff-only
expected_outcome: fix-diff-and-closure-only
expected_reason: round 2 reviews only `9a8b7c6..c3d4e5f` (lib/journal.sh, lib/lock.sh) plus the closure of C1 and C2; C1 is reported `Still open: lib/compact.sh:23` (closed at journal.sh:41 and :77); C2 is reported `Closes: C2`; the retry loop the fix added to `with_lock` is marked `New mechanism: yes` (round 1 asked for no retry), and its own defect — after five failed attempts it runs the command without the lock and then releases a lock it does not hold, lib/lock.sh:26–28 — is reported as a blocking class from the fix diff (condition 1, admits what it cannot handle); `journal_count`'s subshell counter at lib/journal.sh:90–96, written by the PR's original commit and untouched by the fix, is NOT reported (a fresh whole-PR read is out of round-2 scope); a report that re-reviews the whole PR and lists `journal_count`, or that omits the `Still open`/`Closes` closure lines, fails round_scope
---
Review PR `acme/statekit#530` ("journal: every write holds the state lock"). The work-PR
session's brief: "Round 2. Review acme/statekit#530 at head
`c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6`. Previous report:
`/home/dev/.cache/reviews/statekit-530-r1.md` (round-1 head
`9a8b7c6d5e4f30211a2b3c4d5e6f708192a3b4c5`). Write the report to
`/home/dev/.cache/reviews/statekit-530-r2.md`."

Everything the review can read is below. A search of the checkout finds only what is shown.

`gh pr view 530 --json body,headRefOid,baseRefName,files`: `headRefOid`
`c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6`, `baseRefName` `main`, files `lib/journal.sh`,
`lib/compact.sh`, `lib/lock.sh`, `tests/test-journal.sh`. `git rev-parse HEAD` prints the same
SHA. Single repo; root `CODING_STANDARDS.md`:

```markdown
- Quote every expansion that holds a path.
- Code that writes shared state takes the state lock, and gives it back on every exit.
```

The PR body (spec: issue #522; no verifier report):

```markdown
## Claim
Every write to the journal holds the state lock, so concurrent `statekit` runs never
interleave journal lines.

## Scope
Touches: `lib/journal.sh`, `lib/compact.sh`, `lib/lock.sh`, `tests/test-journal.sh`.
Deliberately does not touch: the journal line format, `lib/replay.sh`.

## Known limits
- A run killed with SIGKILL leaves the lock directory behind — `statekit unlock` removes it.

## Merge danger
Door: two-way — a revert restores unlocked writes; the journal format is unchanged.
Blast radius: every `statekit` command that writes the journal.

## Merge bar
A finding blocks this PR only if it:
1. rejects valid input, or corrupts or loses state, on a path this PR touches;
2. makes the Claim above false;
3. breaks the test suite;
4. opens a security hole — injection, authentication bypass, or an exposed secret.
Everything else is non-blocking.

## Evidence
`bash tests/test-journal.sh` — 9 passed.

## Closes
Closes #522
```

The previous report, `/home/dev/.cache/reviews/statekit-530-r1.md`:

```markdown
PR: acme/statekit#530
Head: 9a8b7c6d5e4f30211a2b3c4d5e6f708192a3b4c5
Round: 1
Door: two-way
Standards: CODING_STANDARDS.md
Bar: body
Verifier report: none (full Spec axis)

## Coverage
| File | Standards axis | Claim/Spec axis |
|---|---|---|
| lib/journal.sh | read | read |
| lib/compact.sh | read | read |
| lib/lock.sh | read | read |
| tests/test-journal.sh | read | read |

## Classes
### C1 — a journal append runs outside the state lock
Axis: Claim/Spec
Bar: condition 2
Direction: admits what it cannot handle
Rule: Claim — "Every write to the journal holds the state lock"
Sweep: `rg -n '>> "\$JOURNAL"' lib/` — 3 hits
Sites:
lib/journal.sh:41 — in scope
lib/journal.sh:77 — in scope
lib/compact.sh:23 — in scope

### C2 — the lock directory path is an unquoted expansion
Axis: Standards
Bar: condition 1
Direction: refuses valid input
Rule: CODING_STANDARDS.md — "Quote every expansion that holds a path."
Sweep: `rg -n '\$STATE_DIR[^"]' lib/` — 1 hit; swept and found one
Sites:
lib/lock.sh:12 — in scope
```

The fix diff, `git diff 9a8b7c6d5e4f30211a2b3c4d5e6f708192a3b4c5..HEAD` (one commit,
`c3d4e5f`, "fix round 1: lock journal appends, quote lock path"):

`lib/journal.sh`:

```bash
41- printf '%s\n' "$entry" >> "$JOURNAL"
41+ with_lock _journal_write "$entry"
77- printf '%s\n' "$entry" >> "$JOURNAL"
77+ with_lock _journal_write "$entry"
98+ _journal_write() {
99+   printf '%s\n' "$1" >> "$JOURNAL"
100+ }
```

`lib/lock.sh`:

```bash
12- lock_take() { mkdir $STATE_DIR/state.lock 2>/dev/null; }
12+ lock_take() { mkdir "$STATE_DIR/state.lock" 2>/dev/null; }
13  lock_release() { rmdir "$STATE_DIR/state.lock"; }

20  with_lock() {
21- lock_take || { echo "statekit: state is locked" >&2; return 75; }
21+ local attempt rc
22+ for attempt in 1 2 3 4 5; do
23+   lock_take && break
24+   sleep "$attempt"
25+ done
26  "$@"
27  rc=$?
28  lock_release
29  return $rc
30  }
```

The rest of the PR at the current head, unchanged by the fix commit (part of
`git diff main...HEAD`, written by the PR's original commit `5e1d2c3`):

`lib/compact.sh`:

```bash
18  compact_journal() {
19    local entry
20    while read -r entry; do
21      [ -n "$entry" ] || continue
22      entry=$(normalize "$entry")
23      printf '%s\n' "$entry" >> "$JOURNAL"
24    done < "$JOURNAL.old"
25  }
```

`lib/journal.sh` (lines the fix did not touch):

```bash
90  journal_count() {
91    local n=0
92    grep -v '^#' "$JOURNAL" | while read -r _; do
93      n=$((n + 1))
94    done
95    echo "$n"
96  }
```

`tests/test-journal.sh`: nine tests of `journal_append` and `compact_journal` output; none
runs two writers at once, none holds the lock from another process, none calls
`journal_count`.

Outside the diff: `lib/replay.sh` reads the journal and never writes it. No other file in the
checkout writes `$JOURNAL` or calls `lock_take`, `lock_release` or `with_lock`.
