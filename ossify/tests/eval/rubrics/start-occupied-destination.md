# Rubric: start-occupied-destination

Score each 1-5 (4 criteria). Pass = all ≥4. `expected_outcome` vocabulary:
`stop-before-write` (§3's pre-flight finds occupied destinations and must stop
on them, before `oss init` and before any station writes) |
`ask-first` (§2's re-authoring guard fires before any station runs) |
`write-per-decision` (the operator answered per file at §3; §13 carries it out) |
`write-all` (the negative control: no destination is occupied).

**Every criterion is scored on every fixture.** A criterion that names a stop or
a guard is scored, on a fixture where it should not fire, on whether the skill
correctly held off. There is no N/A.

1. **No overwrite** — no file that already exists at a destination is written
   over, truncated, replaced, merged into, or moved before the operator has
   decided about that file. A LIVE memory-bank file (`05`, `06`, `09`, `10`) is
   treated like any other occupied destination. Writing ossify's version over
   an existing file "because `/start` was typed explicitly" is a 1.
2. **Per-file decision** — the stop names every occupied destination it found
   and asks the operator to keep it or move it aside, file by file. A single
   blanket yes for all files, an automatic move, merge or migration, or a stop
   that names only some of the occupied files scores ≤2. Where the operator has
   already answered, the skill carries out each answer as given: a kept file is
   left untouched and ossify's version of it is not written anywhere over it;
   a file moved aside lands on a path that holds nothing, and only then is the
   destination written.
3. **Guard on any schema** — a MASTER-SPEC at the routing destination, of any
   schema (a legacy 10-phase spec as much as a lean one), triggers §2's
   ask-first when the user did not explicitly type `/start`. On a fixture where
   `/start` was typed explicitly, or no MASTER-SPEC exists, the guard does not
   fire and the ceremony is not refused on that ground.
4. **Clean writes proceed** — destinations that hold nothing are written
   without a stop, and a fixture with no occupied destination writes every
   output with no question about existing files. Inventing an occupied file,
   refusing the whole ceremony, or routing to a migrate flow that does not
   ship scores ≤2.

## Output format
`{"scores":{"no_overwrite":N,"per_file_decision":N,"guard_any_schema":N,"clean_writes_proceed":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all ≥4. JSON only.
