# Ceremony pre-flight

Depth for the pointer at the end of `start/SKILL.md` §3 and
`plan-release/SKILL.md` §3: the branch a ceremony runs, once its own
fail-fast gates have resolved a workspace root, to notice whether a
decision map already exists for this repo before its stations start
asking. It reads `references/tracker.md` §1 for its **resolution** — not
for its stops; see §2 — and on the one-map branch reads
`references/charting.md`'s `## Decisions so far` heading. Nothing
downstream reads this file's own output — the ceremony that ran it is the
last consumer, whichever branch fires.

---

## 1. Count the maps

A map is chartered with the label `wayfinder:map` (`references/charting.md`
§4). Counting them tells the ceremony whether this repo already has a
decision on record that bears on its own stations.

```bash
gh issue list -R "$OWNER_REPO" --label "wayfinder:map" --state all \
  --limit 500 --json number,title,state,url
```

`--state all` on purpose: a closed map's `Decisions so far` is still a
resolved decision worth reading back, and a map that later reopens must
not have silently dropped out of the count.

`--limit 500` is not padding. `gh issue list` defaults to **30**, and this
query is a *count* that branches — a truncated page does not shorten the
answer, it changes which row of §2 fires. Past 30 maps on one tracker the
`>1` branch could no longer name every map, so the operator would be asked to
choose from a list that silently omitted the one they wanted. `--state all`
makes the ceiling easier to reach than it looks, because closed maps never
age out of it.

---

## 2. Branch on the count

| Count | Behaviour |
|---|---|
| 0 | Proceed exactly as today — the common case, and it costs nothing. |
| 1 | Read its `## Decisions so far` (`references/charting.md` §3) and carry each recorded decision into §3 below. |
| >1 | Name every map — by title, never by bare number — and ask the operator which one this ceremony is for. |
| tracker unresolved | Proceed as count 0. |

The zero branch is the load-bearing one: a repo with no map yet pays **one
query and never a prompt** on a `/start` or `/plan-release` run. That query
is §1's `gh issue list` — an empty result **is** the answer, and nothing
else in this file executes.

**The unresolved row exists because wayfinder is advisory here.** Run
directly, every unresolved-tracker path in `references/tracker.md` §1 is a
**stop** — branch 0's conflict, branch 4's failed probe, and the
empty-`$OWNER_REPO` guard alike. **Inside a ceremony none of them fires.** A
ceremony that documents its own hard stops must not grow another one it never
came to ask about, and a tracker it cannot resolve simply means no count can
be taken. Proceeding as count 0 costs the ceremony nothing and leaves the map
to be read by an explicit `/ossify:wayfinder` run.

**Branch 3 counts as unresolved here, and this is the common case.** §1's
branch 3 asks the operator for a tracker and writes `.wayfinder.json`. That is
correct for a wayfinder session and wrong for a ceremony: a fresh workspace
normally has no `origin` (`workspace-init` writes `git_remote: null` by
default), so branch 1 declines and, with no dotfile yet, branch 3 is exactly
where a new project lands. A ceremony that followed it would prompt for
tracker configuration and mutate a config file the operator never came to
`/start` or `/plan-release` to discuss — breaking this section's own promise
of one query and never a prompt, in the very case that promise was written
for. **Take the unresolved row instead: no prompt, no dotfile, count 0.**
Only branches 1 and 2, which resolve a tracker without asking anything, are
followed here.

**Every §1 stop is wayfinder's, never a ceremony's.** A ceremony agent sent to
§1 by this file's opening pointer reads it for the **resolution** and stops
there: it writes no map and mutates no tracker, so none of the failures those
stops protect against can happen to it. An unresolved tracker here means only
that the count cannot be taken, which is precisely the unresolved row above.
`exit 1` is wayfinder's behaviour, never `/start`'s or `/plan-release`'s.

---

## 3. Pre-fills a station; never replaces one

**Binding.** A map's resolved decisions change *how* a station is asked,
never *whether* it is asked. `/start` still walks all nine
forced-enumeration categories (`start/references/bones-registry.md` §2)
end to end, and `plan-release` still walks every one of its own steps, in
full, on every run. A category the map already answered gets that answer
**read back for confirmation** in place of an open question — the operator
can still overrule it — but the station itself still runs, the same as a
category with no map at all. Letting pre-flight skip a station outright,
even a fully-answered one, would reintroduce through a new door the same
completion-floor defect #303 already tracks: a ceremony reporting complete
without ever covering the categories it exists to cover.
