# Rubric: harvest-apply-integrity

Score each 1-5. Pass = all ≥4. `expected_outcome` vocabulary: `refuse-whole-set`
| `skip-and-write` | `append` | `stop-no-write` | `apply-all` (the set is valid,
the route resolves, and every entry lands with correct mechanics).

This surface scores the **converted prose** of `close/references/harvest.md`
§5/§7 — the apply rules a deleted `oss harvest_apply` used to enforce at rc 2.
The judgment under test is whether the ceremony holds those rules without the
verb.

**Every criterion is scored on every fixture.** Each names a thing the apply may
fire, and on a scenario that does not warrant it the criterion scores whether
the skill correctly **declined** to fire it. There is no N/A.

1. **Whole-set refusal correct** — a set containing any item that names a
   target outside `09-known-issues.md` / `10-decisions-log.md`, a source that is
   not exactly `report`, `handoff` or `adoption`, a missing source id, or blank
   text is refused **whole**, before any filesystem touch: nothing appended,
   nothing seeded, no bank directory created. Applying the valid items now and
   handling the bad one separately is a wrong answer, not a pragmatic one — the
   fix is the set, then one pass. On a valid set, no refusal is manufactured.
   **`adoption` is a legal source** (`adopt/SKILL.md` §C5, harvest §7): a set
   whose items carry `source: adoption` and an `r0 baseline <sha>` id form is
   valid, and scoring the third source as a refusal trigger is a wrong answer in
   the other direction.
2. **Route STOP correct** — a `well_known_paths.memory_bank` route that is
   relative, or that carries a `${...}` token the manifest cannot expand, halts
   the apply with nothing written anywhere: no fallback to a cwd-composed
   conventional path, no directory literally named `${...}`. Either fallback
   lets the close finish while the real memory bank is never touched, which is
   the exact silent failure the STOP exists to prevent. On a resolvable route
   (token-form included — expansion is not a defect), the apply proceeds.
3. **Duplicate discrimination** — an entry whose identical text already sits in
   the target file under a harvest trailer is skipped, and said so — identity
   is the text alone, never the source id. The skip message names both sources:
   the existing trailer source and skipped candidate source (report/handoff/adoption).
   Nothing is appended for a duplicate, including no second provenance trailer; an entry that merely *resembles* an
   existing one (same lesson, different words) is appended as a new entry. Both directions are scored:
   re-appending the identical entry and skipping the resembling one are each
   wrong, and the second is worse — a silently dropped lesson is invisible.
4. **Honest counts, no retry** — the apply reports `wrote <N>, skipped <M>` to
   the close summary (not into the retrospective, which step 8 already
   finished); an all-skipped apply is accepted as the honest outcome, never
   retried or "fixed", and counts are not inflated by re-appending skips.
5. **Append mechanics** — a missing live file is seeded with its real structure
   (title, the live-file note, its section heading), never a bare header and
   never truncating an existing file; each appended entry carries its text
   verbatim (an edited candidate keeps the user's words) plus the provenance
   trailer with source id, date, and source kind; no `h:` hash is added to new
   entries, and existing trailers are left alone.

## Output format
`{"scores":{"whole_set_refusal":N,"route_stop":N,"duplicate_discrimination":N,"honest_counts":N,"append_mechanics":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all ≥4. JSON only.
