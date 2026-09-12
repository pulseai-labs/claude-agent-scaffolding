# Rolling wave

Depth for SKILL.md §9. Three planning horizons, and only three:

| Horizon | Detail level | Where it lives |
|---|---|---|
| **This release** | Full — spines, classes, exit criteria, DAG, ledger budget | `RELEASE.md` + `project-state.json` |
| **The next release** | Sketch — a goal and candidate spines. Nothing else | `releases[].next_sketch` |
| **Everything beyond** | Ranked list only | the feature map |

Anything planned in more detail than its horizon allows is the multi-year roadmap
coming back in disguise. That roadmap was obsolete within a sprint, and then it
was quietly ignored — which is worse than not having it, because the plan kept
claiming authority it had lost.

---

## 1. What a sketch is

A goal line plus candidate spine names. That is the whole artifact.

_Dispatcher invocations below are `"$oss_bin" …` — the calling skill resolves `oss_bin` once (recipe: the plugin's `rules/dispatcher-path.md`); if it is unset in your context, resolve it there first._

```bash
"$oss_bin" release_set_meta "$rel" '{"next_sketch":{"goal":"a trader can run a saved strategy against paper fills","candidates":["save a named strategy","paper-execution loop","positions list"]}}'
```

The sketch is recorded on the **current** release (it is the current planning
pass's output), and it becomes the starting point when this release closes and
the next `plan-release` run begins.

**A sketch has no:** exit criteria, classes, DAG, ledger budget, specs, work
items, estimates, or dates. Declaring a class for a spine whose plan does not
exist is a guess with a state record attached — and the class ladder's rungs 2
and 3 both read the *plan*, so there is nothing to run them against yet.

The candidates are **names from the feature map**, not new inventions. If the
sketch names something the map does not carry, add it to the map first
(`oss feature_add`) — otherwise it exists only inside one release record and
disappears when that record is closed.

---

## 2. Why the cap is exactly one release

Two reasons, and the second is mechanical.

**Honesty.** The next release is the furthest point at which a plan is still
mostly true. Beyond it, the product will have taught you something that changes
the answer — and if it has not, the motivation loop is not running
(`references/real-use-findings.md` §5).

**The enabler consumer rule depends on it.** An internal-enabler is admitted only
if it names a committed user-facing spine that consumes it, **scheduled in the
current or the next release**. That rule is only checkable because "the next
release" is a recorded object with named candidates. Without the sketch, "the UI
will consume it someday" becomes unfalsifiable again, and the
anti-foundation-phase rule quietly stops working.

So the sketch is not a courtesy to the reader. It is the data structure the
admission rule reads.

---

## 3. What survives from sketch to plan

Nothing is binding. When this release closes and the next planning pass starts,
the sketch is an **input**, ranked alongside everything the release taught you:
the real-use findings, the retro, fired fake-replacement triggers, and any
internal-enabler that returned because its consumer was dropped.

A sketched candidate that no longer earns its place is dropped — and the drop has
a consequence to check: **if a dropped candidate was the named consumer of an
admitted internal-enabler, that enabler returns to the feature map** (spec §5.3).
Check for that explicitly at the next groom; it is the one way an admitted enabler
can become orphaned work.

---

## 4. Ladder labels are not a schedule

The release ladder is **Skeleton (Release 0) → MVP → v1 → vN**, and it is
evidence-gated, not counted:

- **MVP** is the release at which the product can be used independently — cold
  start, real data lifecycle, a recovery path appropriate to solo scale. It is not
  "release 3", and it is not "skeleton plus N spines" as an arithmetic rule
  (skeleton + 2-3 feature spines is the observed shape, not the criterion).
- **v2** requires a *changed product promise*, a new primary journey, or an
  intentionally breaking public contract. Accumulated features stay v1.x.

So a sketch may name the next release's *label* as a hypothesis ("next: MVP if the
paper loop lands"), but the label is confirmed by evidence at that release's
planning, never assigned in advance as a milestone.

---

## 5. Anti-patterns

- **Sketching two or three releases ahead.** One. The cap is the rule.
- **Assigning classes or exit criteria in the sketch.** No plan exists to judge.
- **Naming candidates that are not on the feature map.** They evaporate.
- **Treating the sketch as a commitment** — or as a promise to a stakeholder. It
  is a hypothesis recorded so the enabler rule can read it.
- **Dropping a sketched candidate without checking whether an admitted
  internal-enabler depended on it** (§3).
- **Dating releases.** The ladder is evidence-gated; a date is a wish.
