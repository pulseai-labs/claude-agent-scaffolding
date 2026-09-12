# Journey map (Patton story map)

Depth for SKILL.md §5. The journey map is the **derivation instrument** for the
skeleton cut and the **seed** of the feature map. It is explicitly NOT a build
order and NOT a backlog.

---

## 1. What it is

A Patton-style story map: the complete user journey enumerated step by step, in
the order a *user* lives it — not the order an engineer would build it. Its two
jobs:

1. Make the thinnest coherent path across the product **visible**, so the
   skeleton cut (§6) is a marking exercise rather than an argument.
2. Harvest everything not in the skeleton into the feature map, so nothing that
   surfaced during the vision conversation is silently lost.

The map replaces the retired upfront BACKLOG and the multi-year roadmap. It is
narrative-shaped and cheap: at Release-0 minimum it is **one core journey**.

---

## 2. Line grammar (three parts, all mandatory)

Every step is one line with three parts:

```text
<actor action>  |  <system responsibility>  |  <observable evidence>
```

- **Actor action** — what a named actor *does*. A concrete verb, performed by a
  person (or an external system acting as a client). "The trader types a
  strategy idea into the chat box."
- **System responsibility** — what the product must do in response. One clause,
  behavioral, not architectural. "Compose the idea into a DSL program and run a
  backtest." Not "the composer module calls the DSL crate."
- **Observable evidence** — what the actor can *see* that proves the step
  happened, from the product's own surface. "Backtest results render on screen
  with an equity curve."

**Rejected phrasings** (these are the recurring failure mode):

| Bad line | Why | Fix |
|---|---|---|
| "Set up the database schema" | No actor, no evidence — a build task | Delete; it's implementation of some real step |
| "Inspect the SQLite table to confirm the trade saved" | Inspector phrasing — the actor is a developer with a debugger, not a user | "See the trade appear in the open-positions list" |
| "The API returns 200" | Evidence is a wire detail, invisible to the actor | Name what the actor sees |
| "The user can manage settings" | No concrete action, no evidence | Split into the actual actions |

The same actor-action + observable-evidence discipline is re-enforced later by
the **demo-line floor** at spine planning (spec §5.3, owned by `plan-spine`).
Getting the grammar right here means the demo ledger nearly writes itself.

The map's actor and action terms are **owned vocabulary** — the authored
map's actor/action/evidence columns are their definition of record, and
challenging or sharpening them is `references/domain-modeling.md`.

---

## 3. Marking: skeleton / next / later

Every step carries exactly one mark:

- **`skeleton`** — on the thinnest coherent path. The step must be present for a
  user to get end-to-end value at all. Pre-seeds Release 0 (§6).
- **`next`** — obviously wanted right after the skeleton works. Becomes an
  MVP-candidate spine.
- **`later`** — real, but not soon.

Marks are a *judgment about value order*, not about difficulty. A hard step on
the thin path is still `skeleton`; an easy step off it is not.

Unmarked steps are a bug in the map — every step gets a mark before you leave
this block.

**This block owns the marking — all three marks, including `skeleton`.** The
skeleton cut (`references/skeleton-cut.md`, SKILL.md §6) does not mark; it
**validates** the `skeleton` set you produce here and reads it back as one
sentence. The ownership matters because §5's harvest runs *before* the cut and
keys on these marks: deferred to §6, either nothing is marked `skeleton` yet — so
the harvest sweeps future-skeleton steps into the feature map, violating its own
"do not `feature_add` skeleton steps" rule — or the harvest slips past its stated
trigger. One station marks; the next checks.

---

## 4. Worked example (pulse-trader, condensed)

| # | Actor action | System responsibility | Observable evidence | Mark |
|---|---|---|---|---|
| 1 | Trader types a strategy idea in plain English into the chat box | Coach clarifies the idea into a concrete rule set | The clarified rules appear back in the chat as a numbered list | `skeleton` |
| 2 | Trader accepts the clarified rules | Composer emits a DSL program | The DSL program is shown, editable | `skeleton` |
| 3 | Trader hits "backtest" | Backtest runs over historical bars | Equity curve + summary stats render on screen | `skeleton` |
| 4 | Trader tweaks one rule and re-runs | Re-compose + re-backtest | The two runs sit side by side for comparison | `skeleton` |
| 5 | Trader saves the strategy under a name | Persist the strategy | The strategy appears in the saved list on next launch | `next` |
| 6 | Trader schedules the strategy against a paper broker | Paper-execution loop | Paper fills appear in the positions list | `next` |
| 7 | Trader reviews a monthly performance report | Report generation | The report opens with per-strategy attribution | `later` |

Steps 1-4 are the thinnest coherent path: a trader gets a real, judged answer to
"is my idea any good?" without leaving the product. That is the skeleton cut.

---

## 5. Harvest: unmarked/`next`/`later` steps become feature-map entries

_Dispatcher invocations below are `"$oss_bin" …` — the calling skill resolves `oss_bin` once (recipe: the plugin's `rules/dispatcher-path.md`); if it is unset in your context, resolve it there first._

Every step NOT marked `skeleton` is recorded as a candidate spine before you
leave this block — this is what stops the vision conversation from evaporating:

```bash
"$oss_bin" feature_add "<name>" "<one-line user value>" "<bone|flesh>" journey-map
```

- `<name>` — short, the step's action ("save a named strategy").
- `<one-line user value>` — why the actor wants it.
- `<bone|flesh>` — a *guess*, refined and possibly overridden at release planning
  (the class declaration + critic veto live in `plan-release`, not here). Guess
  `bone` when the step obviously moves a boundary, owns data, or crosses a trust
  edge; otherwise `flesh`.
- `journey-map` — the source tag, so a later groom knows where the entry came
  from.

Do not feature_add `skeleton` steps — those become Release-0 spines through the
skeleton cut, not through the feature map.

---

## 6. Release-0 minimum

**One core journey**, marked. Not every actor, not every path, not the admin
surface, not the error journeys. If the product has three actor types and only
one of them has a journey worth mapping today, map that one and note the others
as feature-map entries. The map grows at every release close.

---

## 7. Anti-patterns

- **Mapping the architecture.** If a step names a module, a table, or a
  framework, it is not a journey step.
- **Treating the map as a build order.** The map is lived-order; the build order
  comes from the skeleton cut plus release planning.
- **Exhaustive enumeration at bootstrap.** Onboarding-to-first-code is measured
  in days. A 60-step map on day one is ceremony sprawl wearing a Patton costume.
- **Leaving steps unmarked.** An unmarked step is neither in the skeleton nor in
  the feature map — it is lost.
