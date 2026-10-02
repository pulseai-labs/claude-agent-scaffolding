# Lean MASTER-SPEC schema

Depth for SKILL.md §4, §12, and §13. Settles spec §13 open question 2 (the lean
spec package): which sections survive, what is dropped, and the Release-0
minimum for each.

---

## 1. Sections that survive

The lean MASTER-SPEC has **seven** sections, in this order. Every one of them is
a *record of a decision made*, never a prophecy.

| # | Section | Content | Authored by |
|---|---|---|---|
| 1 | **Vision narrative** | Product vision + 5-year shape as prose. Zero execution semantics — see §2. | SKILL §4 |
| 2 | **Journey map** | The Patton table: actor action / system responsibility / observable evidence / mark. | SKILL §5 |
| 3 | **Skeleton cut** | The marked thin path + the Release-0 promise sentence + the clean-checkout criterion. | SKILL §6 |
| 4 | **Bones-registry index** | One row per bone: ADR ref, title, touch surface, revisit trigger, verified/unverified claims. The ADR bodies live as separate files. | SKILL §7, §9 |
| 5 | **Risk gates** | One row per gate: name, touch surface, control checklist. | SKILL §8 |
| 6 | **Posture & boundary** | Posture, channel(s), overlay seam, `PUBLIC_BOUNDARY.md` pointer, private-inventory pointer. No moat item named in any public-routed copy. | SKILL §10 |
| 7 | **Release-0 minimums** | What each artifact above is deliberately deferring, and the trigger that grows it. | SKILL §11, applying §12's floors |

Two derived artifacts accompany it: **EXECUTIVE-SUMMARY.md** (a spec-derived
read of sections 1-3, for a human skimming the project) and the **seed feature
map** (in `project-state.json`, not in the spec file).

### Authoring EXECUTIVE-SUMMARY.md

Named as an output in SKILL.md §13 and as a derived artifact here, with no step
saying who writes it or when. **`start` writes it, at outputs time (SKILL.md
§13), after the seven sections are settled** — routed per the manifest, like the
lean spec itself.

Derive it from **sections 1-3 only** — vision, journey map, skeleton cut — and
keep it to **a page or less**. It answers one question for a human who will not
read the spec: *what is this project, and what does its first release deliver?*

- **Derive, never re-decide.** If writing it makes you want to change something,
  the spec is what changes; a summary that disagrees with its source is worse
  than no summary.
- **No bones, no risk gates, no posture.** Those are sections 4-6, they are for
  people doing the work, and pulling them in makes this a second spec.
- Skip it and nothing breaks mechanically — which is exactly why it goes missing.
  No gate reads it, and its absence is silent.

---

## 2. The vision narrative is narrative — and nothing else

The vision section is prose. **Nothing sequences by it.** No IDs are minted from
it, no release is derived from it, no ceremony reads it as input, no validator
checks it.

This demotion is deliberate. In the predecessor stack the vision fed a
multi-year roadmap that was obsolete within one sprint and then quietly ignored
— "version-number theater" with a planning document attached. Here the vision's
job is orientation for a human (and for an agent picking the project up cold),
and its only structured descendants are feature-map entries harvested from the
conversation that produced it.

Capture: the problem, the actor, the shape of the product in five years, and
what would make it obviously worth having. A page is plenty.

---

## 3. What is dropped (and where it comes back)

| Dropped from onboarding | Why | Where it comes back |
|---|---|---|
| Exhaustive FR/NFR enumeration | Requirements written before any usable software are guesses with ID numbers | Grown at **release closes**; IDs minted incrementally, never renumbered |
| PRD / SRS upfront bundle | Same | Per-release **docs increments** (Plan C), describing what now exists + the next release's commitment |
| BACKLOG.md upfront | Replaced as the planning source of truth | **Feature map** in `project-state.json`; `BACKLOG.md` becomes a *rendered record* at release close |
| Multi-year roadmap | Obsolete on contact; the failure mode this methodology exists to end | **Release planning**: current release detailed, next sketched, feature map beyond |
| PROJECT_PLAN.md | Retired outright | `RELEASE.md` is the plan |
| ROADMAP.md (Phase→Sprint→Slice) | Replaced | Feature map + release planning |
| ADR-0001 "the architecture" blob | Unreviewable, never revisited | **Bones registry**: one ADR per decision, each with a touch surface + revisit trigger |

If the user asks for any of these during `start`, the answer is not "no" — it is
*"that's a release-close artifact; it will exist and it will describe what
actually shipped."*

---

## 4. Release-0 minimums (the lean-bootstrap rule)

Onboarding-to-first-code is measured in **days**. Every artifact has an explicit
floor, and the floor is genuinely low. This is the guard against replacing BDUF
with ceremony sprawl.

| Artifact | Release-0 minimum | Grows at |
|---|---|---|
| **Vision narrative** | A page. Problem, actor, five-year shape. | Never regenerated wholesale; amended |
| **Journey map** | **One core journey**, every step marked | Every release close |
| **Skeleton cut** | The marked path + one promise sentence | Superseded when the product's primary journey changes |
| **Bones registry** | **Only the bones the skeleton touches.** All nine categories *answered*, most as `not-applicable` + a revisit trigger | Release closes; bone supersede ceremonies |
| **Risk gates** | Only gates the skeleton can reach | When a gate's surface becomes reachable |
| **Fake ledger** | **Skeleton shells only** | Every spine that introduces or retains a fake |
| **Feature map** | **May be three lines** | Groomed at every release close |
| **Posture** | May be *"default-private, revisit at MVP"* | Posture-supersede ceremony |
| **Memory bank + CLAUDE.md** | The Tier-0 files with real content; the rest seeded thin | Harvest at every spine close |

A spec-core close that produced a five-line feature map and four `not-applicable`
bones is a **successful** close, not a lazy one — provided every category was
*asked*.

---

## 5. Validation

The lean schema is what **`doctor` checks**, in its own §5 — see
`doctor/references/spec-validation.md`. There is no `validating-master-spec`
skill in this plugin to route to: spec §8.1 lists that name in its *capability*
catalog and marks the capability **carried**, and what v0.3 shipped is `doctor`
owning the check inline rather than delegating to a skill of that name. Read the
§8.1 row as a capability that survived the consolidation, not as a skill ossify
installs. The rule diff versus the legacy 10-phase schema:

- Sections 1-7 above are the required set; the legacy phase-named sections are
  not.
- No FR/NFR ID tables are required (and their absence is not an error).
- The bones index must have a row per registry entry in `project-state.json`
  (spec-vs-state drift is a `doctor` finding).
- The posture section must be present and non-empty — an absent posture is an
  error, because "absent" is exactly the ambiguity that must resolve private.

---

## 6. Anti-patterns

- **Reintroducing FR/NFR tables "just to be safe".** They are guesses with ID
  numbers; they create maintenance debt and false precision.
- **Letting the vision acquire execution semantics.** The moment something
  sequences by the vision, the multi-year roadmap is back.
- **Growing the spec at spec-core close instead of at release closes.** Records,
  not prophecy.
- **Treating the Release-0 minimums as targets to exceed.** They are the floor
  *and* the recommended answer at bootstrap.
