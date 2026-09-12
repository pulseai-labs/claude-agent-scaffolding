# Routing — the id decides the scope

Depth for SKILL.md §2. `close` is **context-routed** (spec §9.1): one skill, three
scopes, and the scope is a mechanical fact about the id's shape rather than
something you ask about or infer. This file is that mechanism in full.

---

## 1. The id grammar

`lib/id.sh` is the **single owner** of ossify's id grammar. Nothing else derives,
validates, or invents an id shape.

| Scope | Shape | Example |
|---|---|---|
| Release | `r<N>` | `r0`, `r2`, `r1000` |
| Spine | `r<N>.s<K>` | `r2.s1` |
| Work item | `r<N>.s<K>.w<J>` | `r2.s1.w3` |

`<N>`, `<K>` and `<J>` are unbounded digit runs. Two branch namespaces derive
from those ids and neither is an id itself:

- **spine branch** — `spine/<spine-id>-<slug>` (`oss branch_name`)
- **work-item branch** — `work/<wi-id>-<slug>` (`oss work_item_branch`)

Work items get their own namespace on purpose: sharing the spine's would make N
concurrent work-item worktrees fight over one ref.

**Shapes that are deliberately not ids**, and must be refused rather than
coerced: `VS-1.1.1` and anything else carrying a `VS-` prefix (the predecessor
stack's vertical-slice id — the grammar has no such shape and rejects it), a bare
number, a branch name, a worktree path, a spine's `name`, a work item's `title`.

---

## 2. The call, and what comes back

```bash
parts="$(oss id_parse "$id")" || parts=""
scope="$(printf '%s\n' "$parts" | awk '{print $1}')"
```

**Call the dispatcher verb, not the lib function.** `bin/oss` dispatches only
`oss_cmd_*`; skill prose cannot reach a bare lib function, and a snippet that
tries produces "command not found" at the first line of the ceremony.

`oss id_parse` echoes **one line**: the scope, then the numeric components,
space-separated.

| Input | stdout | rc |
|---|---|---|
| `r2.s1.w3` | `work_item 2 1 3` | 0 |
| `r2.s1` | `spine 2 1` | 0 |
| `r2` | `release 2` | 0 |
| `VS-1.1.1` | *(empty)* | 1 |
| `r2.w3` | *(empty)* | 1 |

**Take the first field.** `[ "$parts" = "work_item" ]` is never true for a
work-item id, because the components are on the same line — a router written
against "it returns `work_item`" falls through every arm and closes nothing while
reporting success.

The numeric components are useful beyond routing: the release id is `r<field 2>`
and the spine id is `r<field 2>.s<field 3>`, which is how the work-item layer
reconstructs a docs path from a work-item id alone
(`work-item-close.md` §1).

---

## 3. The unparseable id

An id the grammar rejects exits **rc 1 with empty stdout and empty stderr**. The
lib emits **no message at all**, so the error is the skill's to supply. Do not
assume a diagnostic reached the user; do not echo a captured-but-empty stderr.

One line, naming what was passed and showing all three shapes:

> `close`: `<what was passed>` is not an ossify id. Work item `r1.s2.w3`, spine
> `r1.s2`, release `r1`.

Then stop. Do not fall back to "the most recent thing", do not fuzzy-match
against spine names, and do not offer to close something adjacent.

**Guard the capture under strict mode.** `parts="$(oss id_parse "$id")"` is a
bare assignment from a command that is *expected* to fail on bad input; under
`set -e` that aborts the block before the message can be emitted. Use
`|| parts=""` and test emptiness, as §2 does.

---

## 4. No argument at all

`/close` with no id **refuses and lists what is open.** It does not guess.

```bash
oss spine_list
oss get '[.work_items[] | select(.status != "complete") | {id, title, status}]'
```

Then ask for the id explicitly. The reason to refuse rather than guess: a close
run against the wrong scope is expensive and **silent**. Every step of a
work-item close against the wrong work item succeeds — the gate runs, a commit
lands, a branch merges — and nothing reports a problem until a later ceremony
finds a spine it cannot reconcile.

One disposition is not a refusal: a change to **any declared repo** belonging
to no open spine or work item — a typo fix, a doc touch-up — is not a close at
all. Run SKILL.md §3's pre-flight (the lane reads the registries and mutates
state too), then route it to the patch lane (`references/patch-lane.md`),
which resolves and records which declared repo the patch targets, never a
forced ceremony. An AI-workspace edit needs no lane — no ceremony governs
that repo. (SKILL.md §2 states the same rule at the routing table.)

`oss get` is `jq -r` without `-e`: a `select` matching nothing exits **0** with
an empty string. Test the *output*, not the rc, whenever you resolve an id
against state — `oss get … || …` never fires on a typo.

---

## 5. Routing anti-patterns

- **Asking the user which scope they meant.** The id already said.
- **Inferring scope from the phrasing** — "close the spine" with a work-item id
  is a work-item close. The words are how the skill was reached; the id is what
  it operates on.
- **Inferring scope from the environment** — the branch a repo happens to be
  on, the last thing closed, the newest spine. All three are guesses dressed
  as context.
- **Comparing `oss id_parse`'s whole line against a bare scope word** (§2).
- **Calling `oss_id_parse`** (the lib function) instead of `oss id_parse` (the
  dispatcher verb).
- **Treating rc 1 as "the lib will have said something".** It said nothing (§3).
- **Accepting a `VS-` id by stripping the prefix.** It is a different grammar
  from a different stack; the ids do not correspond.
- **Closing a scope whose children are not closed.** Each layer refuses upward:
  work items must be `complete` before a spine closes, spines must be closed
  before a release does.
