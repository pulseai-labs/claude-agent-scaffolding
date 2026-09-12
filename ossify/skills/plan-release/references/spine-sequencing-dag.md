# Spine sequencing (the inter-spine DAG)

Depth for SKILL.md §6. The release's spines are sequenced by an **explicit
dependency graph at spine granularity** — authored, recorded, and rendered into
RELEASE.md.

Not to be confused with `plan-spine`'s **round DAG**, which sequences *work items
inside one spine*. Same idea, different altitude; this one is coarser and is
authored here.

---

## 1. What an edge means

`B depends on A` means: **B cannot start until A closes.** Not "A should probably
come first", not "A is more important", not "the same person will do both".

The test for a real edge — one of these must be true:

- **B builds on a seam A creates.** The port, the schema, the route, the module
  boundary does not exist until A lands.
- **B's demo cannot run without A's outcome.** The cumulative demo is the product
  contract; if B's journey line requires A's journey to exist, that is an edge.
- **A's bone decision changes B's shape.** Planning B before A closes means
  planning it twice.

If none of the three holds, it is **not an edge**. Say so and drop it.

---

## 2. Why false edges are expensive

Every spurious edge serializes work that could have run in parallel, and it does
so invisibly — nobody reviews a dependency they never questioned. Two spines that
could have gone out together instead go out a week apart, and the release's
promise lands later for no structural reason.

The common sources of false edges:

- **Preference dressed as dependency** — "it makes more sense to do the read path
  first."
- **Shared file, not shared contract** — both spines edit `main.rs`. That is a
  merge conflict to sequence *at execution*, not a planning dependency.
- **Risk aversion** — "let's do the scary one first." Legitimate as an *ordering
  choice among roots*, not as an edge. Order the roots; do not fabricate an edge.
- **Same-bone anxiety** — two spines touch the same bone, so they "must" be
  sequential. Only if one changes the bone in a way the other depends on.

Interrogate every proposed edge with §1's three-way test, out loud, once each.

---

## 3. The recorded shape

_Dispatcher invocations below are `"$oss_bin" …` — the calling skill resolves `oss_bin` once (recipe: the plugin's `rules/dispatcher-path.md`); if it is unset in your context, resolve it there first._

```bash
"$oss_bin" release_set_meta "$rel" '{"spine_dag":[["r1.s1",[]],["r1.s2",["r1.s1"]],["r1.s3",[]],["r1.s4",["r1.s2","r1.s3"]]]}'
```

`[[<spine-id>,[<dep-id>,…]],…]` — an array of `[node, deps]` pairs.

- **Every spine in the release appears exactly once**, including independent ones
  with `[]`. An omitted spine reads as *missing from the plan*, not as
  *independent*; the release-close check walks this list.
- Ids are the minted spine ids (`r1.s2`) — the ID grammar has one owner, and
  RELEASE.md, branch names, and worktree paths all derive from these verbatim.
- Dependencies are **spine ids within the same release**. A dependency on a spine
  in a *previous, closed* release is not an edge — it already exists. A dependency
  on a spine in a *future* release means this spine is in the wrong release.
- `release_set_meta` accepts only five patch keys (`exit_criteria`, `spine_dag`,
  `ledger_budget`, `next_sketch`, `real_use_findings`); anything else is dropped
  silently, so check your key spelling.

---

## 4. Deriving the order

1. **List the spines** the release selected
   (`oss get '.spines | map(select(.release == "'"$rel"'")) | map(.id)'` —
   `spine_list` itself returns every spine in the project).
2. **For each pair, ask §1's test.** Record only the edges that pass.
3. **Find the roots** — spines with `[]`. The release starts with all of them; if
   there are none, you have a cycle (§5).
4. **Layer the rest.** A spine is reachable once all its dependencies are closed.
   Spines in the same layer are parallelizable — say so explicitly in RELEASE.md,
   because "can run in parallel" is planning information the reader cannot
   otherwise recover.
5. **Sanity-check the shape.** A release whose DAG is a single straight chain is
   suspicious: it usually means edges 2-N were assumed rather than tested. A
   release with no edges at all is fine and common.

---

## 5. Cycles

A cycle means the spines are cut wrong, never that the DAG needs a tie-breaker.
Two spines that each need the other are one spine, or the seam between them is in
the wrong place.

Fix it by re-cutting, not by deleting an edge to make the graph acyclic:

- **Merge** them into one spine if the journey is genuinely one journey — and
  `oss spine_status "<orphaned-sid>" abandoned` the half that no longer exists;
  or
- **Re-cut** so the shared seam lands entirely inside the first spine; or
- **Extract** the shared seam — and if the extraction has no actor-to-outcome
  journey of its own, it is an `internal-enabler` and must pass the admission rule
  (`references/class-declaration.md` §4) before it can be admitted at all.

Deleting an arbitrary edge produces a plan that is wrong in a way nobody can see
later.

---

## 6. Sequencing and class

Class and sequence are independent. A `bone` spine does not automatically come
first — it comes first only if something depends on the bone it creates. Common
real pattern: the bone spine *is* the root, because that is what "load-bearing"
usually means in practice. Common false pattern: **all** bone spines first,
because it feels orderly. That is a foundation phase re-derived from good
intentions.

One pairing is mandatory, not judgment: an admitted `internal-enabler` exists
only because a named committed consumer admitted it (`class-declaration.md` §4).
When that consumer is in the same release, the DAG **carries the
enabler-to-consumer edge** — omitting it lets the consumer legitimately start
before the thing it consumes exists.

Do note the practical asymmetry when ordering *among roots*: a bone spine carries
full ceremony (grill gates, external adversary at close), so starting it early
means its ceremony overlaps other work rather than blocking the release's tail.

---

## 7. Anti-patterns

- **A linear list masquerading as a DAG.** If every spine depends on its
  predecessor, you did not test the edges.
- **Omitting independent spines from `spine_dag`.** Write `[]`.
- **Work-item-level edges here.** Different altitude — `plan-spine` owns those.
- **Deleting an edge to break a cycle.** Re-cut the spines (§5).
- **Cross-release dependencies.** Backward ones are already satisfied; forward
  ones mean the spine is in the wrong release.
- **Ordering by class rather than by dependency** (§6).
- **Re-deriving the DAG at execution time.** It is planning output; if reality
  disagrees, re-plan and re-record, do not improvise a new order silently.
