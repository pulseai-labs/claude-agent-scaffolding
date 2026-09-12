# RELEASE.md emission

Depth for SKILL.md §8. The release spec directory and the one document that lives
in it.

---

## 1. Where it goes

```text
<ai-workspace>/docs/specs/<release-id>/RELEASE.md
```

The directory is the **release id verbatim** — `docs/specs/r0/`, `docs/specs/r1/`.
ossify's ID grammar has one owner (spec §9.2): release ids (`rN`), spine ids
(`rN.sM`), and work-item ids (`rN.sM.wK`) are minted by the state engine, and
release directories, branch names, worktree paths, ledger keys, ADR links, and PR
titles all derive from them **without transformation**. The spec's prose name for
this directory is `docs/specs/release-N/`; under the ID grammar that renders as
`docs/specs/rN/`. Do not invent a prettier name — a parity test enforces the
derivation, and a hand-named directory breaks every downstream lookup.

Route the path through `oss release_dir`, which resolves the **topology
declaration** like every other ossify artifact — `.ossify/topology.json` first,
a `.workspace/pairing.json` as the translated fallback, so a topology-only
workspace needs no pairing manifest to emit a release spec. Release specs are
process artifacts and live in the AI workspace, not in any declared repo.

```bash
rel="$(oss get '.releases[-1].id')"          # e.g. r0
rel_dir="$(oss release_dir "$rel")"          # ABSOLUTE, ai_workspace-rooted
mkdir -p "$rel_dir"
```

`oss release_dir` resolves the manifest root for you, so the `<ai-workspace>`
in the diagram above is a **shape**, never something to paste into a command.
Running `mkdir -p "<ai-workspace>/..."` literally creates a directory named
`<ai-workspace>` under wherever the agent happens to be standing, and every
later lookup then misses in a way nothing reports.

---

## 2. What it carries — five things, no more

| Section | Source of truth | Notes |
|---|---|---|
| **Goal** | `releases[].goal` | The promise, phrased as what a user can DO at close |
| **Exit criteria** | `releases[].exit_criteria` | One user-journey sentence each |
| **Spines: order + dependencies** | `releases[].spine_dag` | Rendered as layers; name the parallelizable ones |
| **Spine classes + rationale** | `spines[].class` + the class-declaration reason | One line each, naming the rule that decided it |
| **Ledger budget** | `releases[].ledger_budget` | The wall-clock budget set at planning |

Plus two short blocks that make the document readable on its own: the **real-use
findings** that shaped selection, and the **next-release sketch**.

Nothing else. No work items, no demo lines, no specs, no schedule, no estimates —
those are `plan-spine`'s or they do not exist in this methodology at all.

**Exit criteria are phrased against the settled landing tier (#339).** A
spine's hosting repos merge to their base branches **by PR where a remote
exists**; a repo with no remote lands by the local `--no-ff` merge instead —
work-item merges stay local either way, and a release is a tag on each landed
base branch, not a merge of its own. So an exit criterion that says "merged"
means merged by whichever arm that repo's topology selects, and nothing in a
release's phrasing implies a release-level branch or a release-level merge. A
criterion that cannot be judged on a PR-landed spine is a planning defect to fix
here, not a landing detail to work out at close.

---

## 3. Template

```markdown
# Release <N> — <name>

**Status:** planned · **Ledger budget:** <600s> · **Planned:** <YYYY-MM-DD>

## Goal

<One paragraph. The promise, as what a user can DO at close — never which
layers will exist.>

## Exit criteria

- At close, a <actor> can <action> and <observable outcome>.
- At close, a <actor> can <action> and <observable outcome>.

## Spines

| ID | Spine | Class | Why this class | Depends on |
|---|---|---|---|---|
| r1.s1 | <name> | bone | creates a bone: module boundaries — <decision>; ADR-0007 | — |
| r1.s2 | <name> | bone | bone-touch: ADR-0002 (src/domain/**) | r1.s1 |
| r1.s3 | <name> | flesh | lands entirely on existing bones (report port, UI shell) | — |

**Order:** `r1.s1` and `r1.s3` may run in parallel; `r1.s2` starts when `r1.s1`
closes.

### Class dispositions

- `r1.s2` — declared `flesh`, reclassified to `bone` by the bone-touch judge
  (`src/domain/port.rs` → ADR-0002).
- `r1.s3` — critic raised no veto-grade finding; class stands as declared.
- <any escalated finding, with its trigger and the user's ruling>

## Real-use findings feeding this release

- <finding>
- <finding>

## Next release (sketch)

**Goal:** <one line>
**Candidates:** <spine>, <spine>

_No detail beyond this — rolling wave._
```

Render the **dispositions** block from `veto_dispositions` in state, plus the
class-override reasons from `class_overrides`. **Both arrays are global across
all releases** — filter by this release's spine-id prefix or prior releases'
records leak into this document:
`oss get '.veto_dispositions | map(select(.spine | startswith("<release-id>.")))'`
(same shape for `.class_overrides`). It is the part a reader six months later
actually needs: not just what class each spine has, but which judge decided it.

---

## 4. State is authoritative

`project-state.json` is the source of truth; `RELEASE.md` is a **record of the
plan** rendered from it. If they disagree, state wins and the document is
re-rendered — never the other way around, and never a hand-edit of the document
to "fix" a class.

Practical consequence: emit the document **after** §5-§7 of the flow have written
their state (spines created, classes declared, dispositions recorded), so the
first render is already correct. If the critic veto changes a class after the
first render, re-render.

The one ordering exception is the critic pass itself: `RELEASE.md` is the `--spec`
artifact the critic audits, so a first render must exist before §7c runs. Render,
audit, apply dispositions, re-render. Say that you re-rendered.

---

## 5. Release 0

Same document, same five sections, no shortcuts. Its goal is the skeleton cut's
sentence, its single exit criterion is the clean-checkout test phrased as a
journey, and its one spine is the skeleton spine (`bone`, by definition). The
"Real-use findings" block reads `n/a — Release 0`.

---

## 6. Anti-patterns

- **A goal phrased as layers.** "Release 1: the persistence layer and the API" is
  the failure mode the whole document exists to prevent.
- **Hand-naming the directory** (`docs/specs/mvp/`). The id is the name.
- **Editing RELEASE.md instead of state.** State wins (§4).
- **Adding work items, demo lines, or estimates.** Wrong altitude.
- **Omitting the class rationale column.** "Why this class" is the audit trail;
  without it, the next planner re-derives it wrongly.
- **Detailing the next release** beyond goal + candidates
  (`references/rolling-wave.md`).
- **Emitting it to any declared repo.** Process artifact; manifest-routed to the
  AI workspace.
