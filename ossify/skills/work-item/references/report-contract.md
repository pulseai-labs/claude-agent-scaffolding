# The report contract

Depth for SKILL.md §7. `report.md` is the only durable artifact your run leaves
behind besides the staged diff, and two later steps read it **by exact heading**.
So the section set below is pinned, and this file is its **single copy** — there is
no template file to render, no placeholder to fill, and no second list to drift
against. You author these ten headings directly, in this order, every run.

---

## 1. The ten sections

```markdown
## 1. Work item
## 2. Summary
## 3. ACs — verification status
## 4. Files changed
## 5. Verification commands run
## 6. Decisions during execution
## 7. Deviations from spec
## 8. Blockers and advisories
## 9. Suggestions for memory bank
## 10. Notes for orchestrator
```

Every heading is present on every run, including the ones with nothing in them —
an empty section reads as "considered, nothing to say", a missing section reads as
"not run", and only one of those is true.

| Section | Holds |
|---|---|
| `## 1. Work item` | Id, spine, release, branch, worktree absolute path, spec absolute path, timestamp. |
| `## 2. Summary` | What the item actually delivered, in a short paragraph. The one-line return `summary` is this, compressed. |
| `## 3. ACs — verification status` | **A table**, one row per `auto:` AC. See §2 below. |
| `## 4. Files changed` | Every file created or edited, with a one-line note on what changed in it. |
| `## 5. Verification commands run` | One row per command — the command, its exit code, pass/fail, and an output excerpt for anything that failed. |
| `## 6. Decisions during execution` | Judgment calls you made **inside** the spec's latitude — a defensible default where the spec was silent, a data-structure choice, a nice-to-have gap you absorbed. |
| `## 7. Deviations from spec` | Places where what you built **differs from what the spec says**, with the reason. Empty is the expected state. |
| `## 8. Blockers and advisories` | Everything that impeded the run without being a pre-flight gap — **every RED-gate rc 2 advisory**, **every recorded skip-escape override you honoured**, a missing runner, a structural surprise, a `stage_status` of `none` or `partial`. |
| `## 9. Suggestions for memory bank` | Patterns or invariants worth keeping. May be empty; the heading is not optional. |
| `## 10. Notes for orchestrator` | What to look at first — the failing AC, the riskiest file, the sub-task most likely to need a second pass. |

---

## 2. The AC table

```markdown
| AC | Command | Expected | Observed | Status |
|---|---|---|---|---|
| AC-1 | `pytest tests/test_slugify.py::test_ascii_slug` | exit 0 | exit 0 | pass |
| AC-2 | `pytest tests/test_slugify.py::test_duplicate_suffix` | exit 0 | exit 0 | pass |
| AC-3 | `python -m tocgen sample.md` | output contains - [Install](#install) | anchor rendered as `#install-1` | **fail** |
| AC-4 | `pytest tests/` | exit 0 | exit 0 | pass |
```

**Every `auto:` AC in the spec appears in this table**, whatever happened to it.
That is not a style preference — the orchestrator runs

_Dispatcher invocations below are `"$oss_bin" …` — the calling skill resolves `oss_bin` once (recipe: the plugin's `rules/dispatcher-path.md`); if it is unset in your context, resolve it there first._

```bash
"$oss_bin" report_cross_check "<abs report path>" "<abs spec path>"
```

which parses the spec's ACs and greps this report for each label. A label it
cannot find comes back named, and the gate stops there. An AC you deferred,
skipped under a recorded override, or only partially satisfied must therefore be
**named explicitly, with its severity**, not quietly dropped — a dropped AC does
not read as "deferred", it reads as "the report is incomplete", and it halts the
close. The severity rides in that AC's **Status cell**, in the contract's own
vocabulary (`returns.md`: exactly `blocking` or `nice-to-have`) — `skipped
(blocking)`, `partial (nice-to-have)` — and the fuller account goes in
`## 8. Blockers and advisories`.

---

## 3. Worked shape

```markdown
## 1. Work item

- Work item: r1.s2.w1 — heading slugs and TOC anchors
- Spine: r1.s2 (flesh) · Release: r1
- Branch: work/r1.s2.w1-toc-anchors
- Worktree: /abs/path/to/canonical/.worktrees/r1.s2.w1
- Spec: /abs/path/to/work-r1.s2.w1/spec.md
- Completed: 2026-08-01T14:20:00Z

## 2. Summary

Slug generation and anchor rendering landed. Three of four ACs pass; AC-3 fails
on a suffix collision between the slugger's duplicate counter and the renderer's
own numbering — the behaviour is implemented, the two numbering schemes disagree.

## 3. ACs — verification status

<the table from §2>

## 4. Files changed

- `tocgen/slugify.py` (new) — slug generation with a per-document seen-set.
- `tocgen/render.py` — anchor links now use the slugger rather than raw text.
- `tests/test_slugify.py` (new) — AC-1 and AC-2.

## 5. Verification commands run

| Command | Exit | Result |
|---|---|---|
| `pytest tests/` | 0 | pass |
| `python -m tocgen sample.md` | 0 | fail — expected `- [Install](#install)`, got `- [Install](#install-1)` |

## 6. Decisions during execution

- The spec was silent on non-ASCII headings; transliteration was out of scope, so
  they fall through to an ASCII subset. Recorded here rather than raised as a gap
  because a defensible default existed.

## 7. Deviations from spec

None.

## 8. Blockers and advisories

- RED gate returned rc 2 (advisory) for AC-1 and AC-2 — `tests/test_slugify.py`
  did not exist at pre-flight, which is the expected starting state. Both were
  authored and driven RED→GREEN in the loop.

## 9. Suggestions for memory bank

- The duplicate-suffix scheme is now owned in two places. Worth a note in the
  project's code-patterns file before a third caller appears.

## 10. Notes for orchestrator

- Start at AC-3. The disagreement is a one-line decision about which component
  owns numbering; both sides are implemented.
```

---

## 4. MUST NOT

- **Never omit the AC table**, and never drop a row for an AC that did not land
  (§2).
- **Never conflate `## 6` with `## 7`.** `## 6` is judgment *inside* the spec's
  latitude; `## 7` is divergence *from* the spec. They carry different review
  consequences — a decision gets skimmed, a deviation gets challenged — so filing
  a real deviation as a decision is how a spec divergence reaches merge
  unexamined.
- **Never promise more than was done.** `## 2`, `## 3` and `## 4` are cross-checked
  against each other and against what verification actually observed. Inflation is
  the single most common cause of a cross-check failure, and it is self-defeating —
  the gate reads the same evidence you do.
- **Never skip the report because verification failed.** A failed run with an
  honest report is a recoverable state; a failed run with no report is a dispatch
  the orchestrator has to repeat from scratch.
- **Never rename or renumber a heading.** `## 9. Suggestions for memory bank` in
  particular is matched by exact string at harvest time. A heading that reads
  "Memory bank suggestions" is a section that silently never gets harvested.
