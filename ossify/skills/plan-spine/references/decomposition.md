# Decomposition (1-5 work items)

Depth for SKILL.md §4. A spine becomes a small set of work items, each one an
independently buildable, independently verifiable change with a named target repo.

---

## 1. The bound is 1-5, and the low end is ordinary

Work-item count is **whatever the spine's scope needs**, bounded 1-5. Two rules
from the predecessor stack are explicitly **retired as floors**:

- the **"4-5 items" norm** — a spine of 1-3 items is legitimate and expected;
- the **anti-microscope rule** — it no longer forces a small item to be folded
  into a sibling.

They survive only as advice against the *opposite* failure: a 1500-LOC mega item
behind one bullet is still four items hiding in a trench coat, and an item that
exists only to rename a constant probably belongs with its neighbour. Neither is
a gate. **Do not split a coherent change into five to look thorough, and do not
pad a thin spine to reach a count.**

There is no size or weight axis in ossify. **Class is the only classification**
(`bone` / `flesh`, declared at release planning), and item count simply follows
from decomposition — so a count is never evidence about a spine's importance and
never needs defending as one.

### When an honest decomposition needs more than five

The upper bound is the one that bites, and it has a specific meaning: **a
decomposition that genuinely needs more than five items is telling you the spine
is two spines.** The bound is a scope signal, not a formatting rule, and 6 is not
"5 with an exception".

**Take it back to `plan-release`.** Split the spine along the *journey* — the
same cut `plan-release/references/feature-map-grooming.md` §3 uses on an over-large candidate — and let
each half be declared, classed, and DAG-positioned in its own right. Both halves
must still cross the product end to end; a split that leaves one half unable to
reach an outcome has produced an `internal-enabler`, which is a different
conversation (`plan-release/references/class-declaration.md` §4).

Concretely, on the spine already in state: `oss spine_status <spine> abandoned`,
then `oss spine_add` each half at `plan-release` with its own class and DAG
position; carry any ledger line already planned against the old spine with
`oss ledger_unplan <line-id> <old-spine>` first (`demo-amendments.md` §6). The old spine stays in
state, abandoned, so the release close can report it
(`close/references/release-close.md` §2 names abandoned spines explicitly).

What **not** to do, in order of how tempting each is:

- **Do not merge two items to reach five.** The count is now legal and the plan
  is worse: one item hides two changes, and its RED→GREEN evidence covers
  neither cleanly.
- **Do not defer the sixth item to "a follow-up spine" without planning it.** An
  unplanned follow-up is a deferral with no record; if it is real work, it
  belongs on the feature map (`oss feature_add`).
- **Do not quietly ship six.** The bound exists so this conversation happens.

The signal is reliable in practice: a six-item decomposition almost always has a
seam in the middle where the first *n* items deliver one outcome and the rest
deliver another. That seam is the spine boundary you are looking for.

---

## 2. What each work item declares

| Field | Notes |
|---|---|
| **Title** | What it delivers, in the product's vocabulary. Not "part 2 of 4" |
| **Expected paths** | The files/modules it will touch. Feeds the §4c bone-touch check |
| **Dependencies** | Sibling item ids it cannot start without. Feeds the round DAG |
| **`target_repo`** | Exactly one repo. Defaults to the sole declared repo; see `cross-repo.md` |
| **Rationale** | Why this item, at this size. One line |

```bash
w1="$(oss work_item_add "$spine" "order-ticket form + validation")"
w2="$(oss work_item_add "$spine" "paper-fill adapter" private_core)"   # dispatchable since #272/#310 Task 9 (cross-repo.md's banner); shown for the field's shape only
```

Each call prints the minted id (`r1.s2.w1`, …); capture it. An unknown spine id
exits **7** and writes nothing — check §3's pre-flight resolved before you start
minting.

---

## 3. Worked example

**Spine `r1.s2` — "cancel a working order from the order book"** (flesh, per
`plan-release`). The release's exit criterion: *"At close, a trader can cancel a
working order and see it drop out of the working list."*

Draft decomposition — **3 items**:

| Id | Title | Paths | Deps | Repo |
|---|---|---|---|---|
| `r1.s2.w1` | cancel affordance + confirm step in the order book | `src/ui/book/**` | — | canonical |
| `r1.s2.w2` | cancel path through the existing order port | `src/app/orders.rs` | — | canonical |
| `r1.s2.w3` | working list + reserved margin reflect the cancel | `src/ui/working/**`, `src/app/positions.rs` | w1, w2 | canonical |

Three items, not five. The spine is thin by design — it rides bones the skeleton
already laid (the order port, the UI shell), and inventing two more items would
manufacture coordination cost with no product effect.

**What was rejected during drafting:**

- *"Refactor the order port for extensibility"* — no product effect this spine
  needs, and it would touch a registered bone surface. It is a separate
  candidate for the feature map, not an item here.
- *"Add tests"* — not a work item. Tests are part of each item's own definition
  of done; a separate testing item is a phase, reintroduced at item scale.
- *Splitting w1 into "cancel button" + "confirm dialog"* — microscope split. One
  coherent change, one item.

---

## 4. The bone-touch re-check (SKILL.md §4c)

Release planning judged a **coarse** plan. Decomposition is the first moment the
real path set exists, so run the check again over the union of every item's
expected paths:

```bash
if oss touch_check src/ui/book/cancel.rs src/app/orders.rs src/app/positions.rs; then
  : # rc 0 = MATCHED — capture stdout: "bone <adr>" / "risk_gate <name>" per match
else
  : # rc 1 = clean — but rc 2 lands here too, and it is NOT clean (see below)
fi
```

**rc 0 = matched, rc 1 = clean, rc 2 = could not check.** The 0/1 inversion is
deliberate and reading it backwards inverts the judge. rc 2 (no paths given, or
an unreadable state) is the third answer a two-branch `if` cannot see: it falls
into the `else` and reads as a clean verdict, which quietly leaves the spine in
the permissive class. It prints the reason on stderr — check the rc explicitly
when the plan depends on the verdict, and never treat 2 as clean. Capture stdout
too: the matched surface names are what goes into the reclassification reason.

A hit on a `flesh` spine is **drift**: the class was declared against a plan that
did not include this path. Do not shrug it off because "the critic was clean at
release planning" — different judges, and this one is mechanical.

```bash
oss class_set "$spine" bone "bone-touch at decomposition: ADR-0002 (src/domain/**)"
```

Then tell the user what changed and what it costs: a reclassified spine picks up
the bone close path (full audit with the external adversary, full retro, an ADR)
and the §7 grill-me gate now applies.

A **risk-gate** hit does the same *and* attaches that gate's controls
(`oss get '.risk_gates'`) to the spine's close path as required work — paper/
sandbox env, human confirm, kill switch, audit trail, progressive exposure, as the
gate lists them. A one-line flesh change inside the live-order path is still a
Risk event.

---

## 5. Anti-patterns

- **Padding to 4-5 items** because the old norm said so, or **splitting to look
  thorough**. The bound is 1-5 and the count is an outcome (§1).
- **A mega item** — one bullet hiding 1500 LOC and four decisions.
- **A hidden dependency** — a shared migration or schema change nobody made its
  own item, so two items race for it. Surface it as an item.
- **An item advancing zero demo criteria.** Justify it or fold it in; a spine's
  items should visibly add up to its demo contribution (§8).
- **A "tests" item, a "docs" item, or a "refactor" item.** Those are phases at
  item scale. Each item carries its own tests and doc changes.
- **An item spanning two repos.** Split it (`cross-repo.md`).
- **Skipping the §4c re-check** because release planning already classed the
  spine. Different plan, different fidelity.
- **Reading `touch_check`'s rc backwards.** rc 0 = matched.
