# The skeleton cut

Depth for SKILL.md §6. The skeleton cut is the load-bearing question of
spec-core onboarding: it defines **Release 0**, the mandated first release.

---

## 1. Terminology collision — read this first

The legacy stack asked an "MVP cut" question (old Q1.3.2). This is **not** that
question, and the rename is deliberate:

| | Skeleton cut (this) | MVP |
|---|---|---|
| Answers | "What is the thinnest path that is *usable end to end*?" | "What is the smallest thing worth shipping to users?" |
| Produces | **Release 0** | A later release (skeleton + 2-3 feature spines) |
| Judged by | The clean-checkout test (§4) | Market/user judgment |

Calling Release 0 "the MVP" is how the predecessor toolchain produced seven
sprints with no usable UI: everything that felt MVP-shaped got pulled into the
first release, the release got long, and nothing was usable until it landed.
Release 0 is deliberately *less* than an MVP. Do not let the user re-import MVP
scope here — record it as `next` on the journey map instead.

---

## 2. How to derive the cut

The cut is a **validation of the marks already on the journey map**, not a fresh
brainstorm and not a second marking pass. `journey-map.md` §3 marked every step
`skeleton` / `next` / `later`, and §5 has already harvested the non-`skeleton`
ones into the feature map. **Re-marking here would run after that harvest and
silently disagree with it.**

1. Take the mapped journey (`references/journey-map.md`) with its marks.
2. Ask of the `skeleton` set: *"Is this the contiguous minimum for the named actor
   to enter through the real entry point and reach a real outcome?"*
3. **Correct the map if the answer is no** — go back to `journey-map.md` §3 and
   fix the marks there. Do not patch the set here; the map is the record.

_Dispatcher invocations below are `"$oss_bin" …` — the calling skill resolves `oss_bin` once (recipe: the plugin's `rules/dispatcher-path.md`); if it is unset in your context, resolve it there first._

   **By the time you are reading this, the harvest has already run.** This file
   is depth for SKILL.md **§6**, and §5's "Harvest before moving on" step
   committed every non-`skeleton` step to the feature map before §6 began. The
   map is **append-only** — `"$oss_bin" feature_add` has no remove or update sibling
   (`plan-release/references/feature-map-grooming.md` §2) — so a promotion here cannot retract the entry
   that already exists. The pre-harvest check belongs one station earlier and
   lives there: `journey-map.md` §3, "before you leave this block".

   So handle the two directions differently, because only one is recoverable:

   - **Demotion** (a `skeleton` step is really `next`/`later`): re-run §5's
     `"$oss_bin" feature_add` for that step, or it never reaches the map at all.
   - **Promotion** (a `next`/`later` step belongs in the skeleton): its feature-
     map entry is already committed and **stays**. Do not hand-edit state to
     remove it. Say so now, and let the next groom prune it with a reason —
     "shipped in Release 0" — which is the supported way an entry leaves
     contention (`plan-release/references/feature-map-grooming.md` §2 pass 4). Unsaid, release planning
     sees Release-0 work in the candidate list and may plan it twice.
4. Read the marked path back as one sentence: *"At Release 0 close, a `<actor>`
   can `<action>` and `<observable outcome>`."* If you cannot say that sentence
   without an "and then I manually…" clause, the cut is wrong.

**Thinnest** and **coherent** are both binding. Thin without coherent gives a
layer (a database with no way to reach it). Coherent without thin gives an MVP.
The cut is never "minimal" — it *is* the minimum; what varies is how much of the
journey map it was derived from (`references/journey-map.md` §6: one core
journey is enough).

---

## 3. Tests the cut must pass

- **End-to-end, not end-to-layer.** The path crosses every layer the journey
  needs — entry point, logic, persistence if the journey needs it, and the
  surface the actor actually sees. A "backend first, UI next release" cut is a
  horizontal build wearing a skeleton costume; reject it.
- **Real entry point.** The actor enters the way a real user would. A CLI
  harness standing in for the shipped UI fails this unless the CLI *is* the
  product's real entry point.
- **Real outcome.** The value the actor came for, however narrow. Not a log
  line, not a fixture dump.
- **One journey, not one feature.** The cut is a path, not a capability list.

---

## 4. The Release-0 close criterion (clean-checkout test)

Stated here so the cut is chosen against the bar it will be judged by. At
Release 0 close, from a **clean checkout**:

> the named actor enters through the real entry point and reaches the observable
> outcome — without editing storage, invoking hidden developer operations, or
> receiving manual repair.

A **declared** overlay env var (§10 posture block, recorded via `oss
overlay_set`) counts as *configuration*, not manual repair — that is exactly why
the seam is declared here rather than improvised later.

Release 0 also owes the cumulative ledger **one automated golden-journey `auto:`
line**, so the journey becomes a standing regression test rather than a
one-off walkthrough. That line is authored at spine planning, where it is
`plan-spine`'s binding floor **F6** (SKILL.md §8a; depth in that skill's
`references/demo-authoring.md` §7) — the cut just has to be the kind of path that
*can* carry one.

---

## 5. What the cut hands downstream

The cut pre-seeds Release 0 but does not plan it. Concretely it hands
`plan-release`:

- the **skeleton spine** (bone class by definition, full ceremony),
- the release exit criterion phrased as a user journey (the sentence from §2.4),
- the marked journey map, so the `next` steps are already ranked candidates.

Release 0 still goes through the normal `plan-release` ceremony — with the retro
input `n/a` and a possibly sparse feature map. `start` does not create the
release; do not call `"$oss_bin" release_add` from this skill.

---

## 6. Anti-patterns

- **Naming the cut "the MVP".** See §1.
- **A cut with no user-visible surface.** "Release 0 is the domain model" is the
  foundation-phase failure mode the whole methodology exists to prevent.
- **A cut that needs a fake at the actor's outcome.** Faking the actor's outcome
  is a banned fake (spec §5.3) — if the outcome must be faked, the cut is in the
  wrong place.
- **Deriving the cut before the journey map exists.** Then it is an opinion, not
  a derivation.
