# The handoff contract

Depth for SKILL.md §3, from the **author's** side. The handoff is the only input
the worker gets: one document in, one structured return out. Everything the
worker needs must resolve out of this file or out of the spec it names.

**Author the sections directly. There is no template file and nothing renders.**
The section set below is the contract; a handoff that satisfies it passes
pre-flight, and one that does not returns `gaps-surfaced` before any work
happens.

Written by the round-orchestration lane (`references/round-orchestration.md` §4),
one per work item, at:

```text
<ai-workspace>/docs/specs/<release-id>/<spine-id>-<spine-slug>/work-<wi-id>/handoff.md
```

---

## 1. The five fields pre-flight resolves

Gate 1 fails the whole run if any of these cannot be found. They are spread
across three sections on purpose — this table is the index:

| Field | Section | Fails how |
|---|---|---|
| Worktree absolute path | §3 | Nothing to `git -C`; every later step is guesswork |
| Declared branch | §3 | The branch-match gate has nothing to compare against |
| **Absolute spec path** | §3 | No ACs, so nothing to build and nothing to verify |
| Verification commands | §9 | Nothing to run after the loop |
| Constraints | §10 | See `## 10. Constraints` below — the strictest of the five |

A handoff missing any one of them is **malformed, and malformed is itself a
gap.** The worker will not infer the missing piece from its own body, by design:
a handoff that never stated a boundary may have been produced by something that
does not know the boundary exists, and the rest of it is then equally suspect.

---

## 2. The twelve sections

Headings exactly as written, in this order — twelve sections, of which §8 (the
non-binding AC reference copy) is the one that may be omitted entirely (see its
entry).

### `## 1. How to use this handoff`

Two or three lines: read this file end to end, then the spec end to end, then run
pre-flight. Name the re-dispatch rule — **on a re-dispatch, read it again from
scratch**, because clarifications are appended to the end of this document (§3 of
this contract) and skimming is how they get missed.

### `## 2. Spine context`

The spine id, its class (`bone` / `flesh`), the release it belongs to, and a
one-paragraph statement of what the spine is for. Then three branch facts:

- `repo:` the repo this work item targets — the same value as `target_repo` in
  §3. The spine branch is cut in every repo hosting at least one of the
  spine's items (`round-orchestration.md` §2), so `spine_branch:` and
  `base_branch:` below describe *this* repo, not necessarily every repo the
  spine touches.
- `spine_branch:` the integration branch this repo is parked on.
- `base_branch:` the branch this repo was on when the spine branch was cut.

`base_branch` is carried here because **no state field holds it** and spine close
needs it to switch back before merging. Copy it into every handoff in the spine,
including re-dispatches. **This is the branch the spine was actually cut from,
in this repo; `SPINE.md`'s spine-context section holds the branch it was
*planned* to be cut from. They can differ** — the lane takes HEAD, not the plan
(`round-orchestration.md` §2) — and spine close reads **this field first**,
cross-checking against `SPINE.md`'s planned base and halting on disagreement
(`close/references/spine-close.md` §3). A value copied from the plan instead of
the worktree hides the very mismatch that halt exists to catch. Record the
observed one here; it is the evidence.

### `## 3. Work item identifiers`

The load-bearing section. Five facts, each on its own line, each absolute where a
path is involved:

```text
work_item_id:   r1.s2.w1
target_repo:    canonical
worktree_path:  /abs/path/to/canonical/.worktrees/r1.s2.w1
branch:         work/r1.s2.w1-toc-anchors
spec_path:      /abs/path/to/ai-workspace/docs/specs/r1/r1.s2-toc/work-r1.s2.w1/spec.md
```

**`spec_path` is not optional and lives nowhere else.** Pre-flight's Gate 2 runs
`oss verify_acs "<abs spec path>"` against it and the whole TDD loop works the
ordered rows that come back. A handoff whose only mention of the spec is a
sentence like "see the spec in this directory" is malformed at Gate 1.

`branch` must be the branch that is **actually checked out** in the worktree —
read it back with `git -C "$wt" rev-parse --abbrev-ref HEAD` rather than
re-deriving it, and record the same value into state with `oss work_item_exec`.

### `## 4. Pre-flight calibration`

What pre-flight should expect to find, so a deviation is recognisable as one:
the worktree was spawned clean off `spine_branch` at `base_sha`, no file has been
touched since, and the branch above is checked out. State that **any**
`git status --porcelain` output means something ran in between — that is a gap to
report, never dirt to tidy.

If a previous dispatch left a recorded override (an AC that is legitimately
already GREEN, per SKILL.md §4), it goes here, named by AC and by the reason it
was granted. An override that lives only in the conversation does not survive the
next dispatch.

### `## 5. What's already merged`

The sibling work items from earlier rounds that have landed on the spine branch —
id, one line of what they delivered, and the merge sha. This is what tells the
worker which seams it may build on.

Empty is a legitimate value for round 1. Write "nothing yet — this is round 1"
rather than omitting the section; an absent section reads as an oversight.

### `## 6. Memory bank pointers`

Absolute paths to the memory-bank files worth reading for this item, with one
line each on why. **State that they are read-only.** Memory-bank writes are on
the worker's NEVER list — the pattern it notices goes in the report's
memory-bank-suggestions section, and the harvest takes it from there.

### `## 7. Requirement traceability`

Which spec sections, requirement ids and registered bone ADRs this item answers
to. One line each. This is what makes a reviewer able to ask "did this item do
what it was for" without re-reading the whole spine plan.

### `## 8. Acceptance criteria (reference copy — non-binding)`

An orientation aid **and the prose must say so, in the heading and in the body.**

The worker never takes its ACs from here. It reads the spec end to end and parses
the ordered `auto:` rows out of it with `oss verify_acs`, and *that* TSV order is
the binding working order for the RED gate and the loop. Titling this section as
if it were authoritative creates a second source of truth that nothing reads and
that drifts from the spec the moment either is edited.

Keep it short, label it non-binding, or **omit the section entirely** — omitting
it is a legitimate choice and costs nothing.

### `## 9. Verification commands`

The commands to run in the worktree after the loop, each with an expectation in
the same grammar the ACs use, because the worker runs them through the same
predicate:

```bash
oss verify_step "<worktree-abs>" "<command>" "<expectation>"
```

State that these run **without halting on first fail** — all of them, every time,
even after one fails. The orchestrator needs the whole picture to pick a recovery
path, and a partial run forces a second dispatch that costs more than the failed
commands did.

### `## 10. Constraints`

The strictest section in the file. It **must** carry both of the following, and a
handoff missing either one is malformed:

**1. The git policy, verbatim:**

```text
git_policy: STAGE-not-commit
```

`git commit`, `git push`, `git pull` and `git fetch` are forbidden anywhere in
the worker's tool-call log. It stages with `git -C "<worktree-abs>" add -A` and
stops; the commit boundary belongs to the work-item close layer, after its gate.

**2. The return JSON shape, verbatim** — both shapes:

```
{"mode": "complete", "report_path": "<abs path to report.md>", "summary": "<one-line>", "stage_status": "all_staged | partial | none"}
```

```
{"mode": "gaps-surfaced", "gaps": [{"section": "<ref>", "question": "<concrete question>", "severity": "blocking | nice-to-have"}, ...]}
```

**`references/returns.md` is the source of truth for these two shapes.** This
section is the instruction to copy them into the handoff exactly as they appear
there — if this file and `returns.md` ever differ, `returns.md` wins and this
file is the bug. That is not pedantry: the worker's Gate 1 treats a handoff
missing the shape as malformed, so a drift between the two **deadlocks the engine
on its own pre-flight** — every dispatch returns `gaps-surfaced` and no work ever
starts.

Anything else genuinely binding for this item goes here too: a dependency that
must not be added, a file that must not be touched, a performance floor.

### `## 11. When done`

The exit sequence, in order: author `report.md`, stage, return the JSON, **stop**.
Say explicitly that the worker does not commit, does not merge, does not clean up
the worktree and does not run its own gate — the orchestrator owns everything
after the return.

### `## 12. Report contract`

The absolute path where `report.md` goes (beside `spec.md` and this file), and a
pointer to `references/report-contract.md` for the section set.

**Do not restate the ten sections here.** They are a machine contract — the
harvest greps one heading by exact string and the close gate greps the AC labels
— and they live in exactly one place on purpose. A second copy in every handoff
is ten opportunities per work item for a heading to drift out of grep range.

---

## 3. Appending clarifications

A `gaps-surfaced` return is answered by appending to **this file**, never by
editing the spec and never by stuffing the answers into the re-dispatch prompt:

```markdown
## Clarifications

### Dispatch 2 — <date>
- **AC-2, blocking:** *Should a duplicate heading get a numeric suffix, or should
  the run exit nonzero?* → Numeric suffix, `-2` upward. Recorded by <user>.
```

The worker re-reads the handoff end to end on every dispatch, which is exactly
how the resolutions reach it. A fresh subagent has no memory of the previous
attempt, so an answer that lives anywhere else is an answer it never sees.

Append; never rewrite the answered section in place. The gap and its resolution
are both evidence, and the retrospective reads them.

---

## 4. Anti-patterns

- **Omitting `spec_path`** because the spec is "obviously" beside the handoff.
  Gate 1 does not infer paths; every dispatch returns gaps and no work starts.
- **Copying `SPINE.md`'s planned base into `base_branch`** instead of reading the
  worktree's actual base. The cross-check then compares a value against itself.
- **A §2 `repo:` that does not match §3's `target_repo`.** They record the same
  fact twice on purpose — one as spine-context, one as a work-item identifier —
  and a drift between them means one was copied from the wrong place rather
  than read off this item.
- **Paraphrasing the return shapes** in §10 instead of copying them. Same
  deadlock, harder to see.
- **A §8 titled as authoritative.** Second source of truth, silently drifting.
- **Restating the report's ten sections** in §12.
- **Pre-placing an empty `report.md`** beside the handoff. The worker authors it;
  its own contract tells it to prefer Edit on a file that already exists, so an
  empty placeholder puts it in conflict with its binding prose.
- **Answering gaps in the dispatch prompt** instead of appending a
  `## Clarifications` section to the handoff (§3 of this contract).
- **A relative worktree path.** The worker's cwd is the caller's, never the
  worktree.
