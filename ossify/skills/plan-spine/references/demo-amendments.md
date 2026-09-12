# Demo-line amendments (supersede / retire)

Depth for SKILL.md §8e. A spine's plan may declare that it changes lines the
ledger already carries. Amendments are **planned here** and **applied at that
spine's close**.

---

## 1. The two planning verbs

_Dispatcher invocations below are `"$oss_bin" …` — the calling skill resolves `oss_bin` once (recipe: the plugin's `rules/dispatcher-path.md`); if it is unset in your context, resolve it there first._

```bash
"$oss_bin" ledger_supersede "<line-id>" "<by-spine>" "<reason>"
"$oss_bin" ledger_retire    "<line-id>" "<by-spine>" "<reason>"
```

| Verb | Means | Use when |
|---|---|---|
| **supersede** | This line is replaced by a line this spine adds | The flow still exists but is reached differently — a redesign, a moved entry point, a deepening pass that subsumes the old check |
| **retire** | This line describes a flow the product no longer has | The capability was removed, or the journey it walked no longer exists |

Both are keyed by the **line id** (`d3`, `d7`) — the value `"$oss_bin" ledger_add_auto` /
`ledger_add_user` printed when the line was created. Not the text. An unknown line
id exits **7** and writes nothing.

Find the id before you amend:

```bash
"$oss_bin" get '[.demo_ledger[] | {id, type, status, text, source_spine}]'
```

---

## 2. Archived, never deleted

Neither verb removes anything, and neither touches the line's own `status` —
that is the whole point of splitting planning from apply. Planning records a
**pending amendment**: a list entry carrying its own `status` (`superseded` /
`retired`), `by` (the amending spine), and `reason`, held pending against the
line until that spine's own close **applies** it — which is when the line's
own `status`, `status_by`, and `status_reason` actually flip. `status_by` /
`status_reason` are the **line's** fields, not the pending entry's; they stay
`null` until apply — that is the whole distinction planning verbs preserve.
The line stays in `demo_ledger` forever, archived, not deleted.

A line carries pending amendments from **more than one spine at once** — a
list, not a single slot. Two spines can each plan an amendment on the same
line; each spine's close applies and consumes only its own, and a sibling
spine's still-pending plan is untouched. If both amend the same line, the
**last close to run wins** on `status`, and the ledger records which spine via
`status_by` — the losing spine's amendment was still applied when its close
ran, it was just superseded again by the one that closed after it.

That is deliberate. The ledger is the product's demo history: it is how a release
retro can say *"the CLI entry point was the journey until `r2.s1` replaced it with
the ticket"*. A deleted line takes that with it, and it also takes the audit trail
for a line someone removed because it was inconvenient.

Consequences worth knowing:

- `"$oss_bin" ledger_active_auto` returns only `active` `auto:` lines. A **planned**
  amendment does not change that — the line keeps running until this spine's
  close applies it, so a sibling spine closing in between still exercises the
  flow. Coverage is never dropped for work that has not landed.
- The release-close walkthrough uses the **amended** set.
- Counting `.demo_ledger | length` counts history, not the live suite. Filter on
  `.status == "active"` when you want the live set.

---

## 3. Every amendment names a reason, and the reason is a change

The reason field is not decoration — it is what a reader six months out has. Write
the **change that caused it**, not the feeling:

| Bad reason | Good reason |
|---|---|
| "no longer needed" | "the order ticket replaced the CLI entry point in r2.s1" |
| "flaky" | "…" — see §4; a flaky line is not an amendment |
| "cleanup" | "the CSV export flow was removed by this spine" |
| "superseded" | "subsumed by the p50 latency bound this spine adds" |

**A superseding spine must actually add the replacement.** Superseding a line and
contributing nothing in its place is a retire wearing the wrong verb, and it
quietly shrinks the demo's coverage of the product.

`<by-spine>` **is validated against known spines**: an unknown spine id exits
**7** and writes nothing. This is not cosmetic — `<by-spine>` is the join key
`close` matches on to find and apply this spine's pending amendments, so a
typo'd id here would mean the amendment is never applied by any close, silently
and forever. Paste the id you resolved at pre-flight (§3), do not retype it.

---

## 4. Quarantine is not a planning verb

```bash
"$oss_bin" ledger_quarantine "<line-id>" "<reason>" "<release>"    # NOT a planning action
```

Quarantine exists for a line failing for causes **unrelated to any open spine** —
an upstream outage, a broken CI image. It is a **parking ticket, not a shrug**: a
quarantined line is state-recorded and skipped by the runner, and **must be
fixed or retired by the next release close**. The `<release>` argument is what
makes that enforceable — it is the parking ticket's date. Omit it and the next
release close has no way to tell which quarantines are overdue.

the doctor surface reports outstanding quarantines as an advisory line — `warn: ledger
- N quarantined line(s); each must be fixed or retired by the next release
close`. It is a warning, not a failure: it never changes doctor's exit code, so a
quarantine cannot block a ceremony that is otherwise healthy. For the lines
themselves, read the ledger: `oss get '[.demo_ledger[] | select(.status ==
"quarantined")]'`.

It belongs to `close` and `doctor`, at the moment a line actually fails. Do not
reach for it at planning time to make an inconvenient line go away — that is
exactly the misuse the "parking ticket" framing exists to name. If a line is wrong,
supersede or retire it with a reason.

---

## 5. When to amend, and when not to

**Amend when:**

- this spine changes the flow an existing line walks (supersede);
- this spine removes the capability a line demonstrates (retire);
- a deepening pass replaces a coarse line with a measured one (supersede);
- the ledger will not fit the release's `ledger_budget` and the release-planning
  decision was **prune** — retire the lines that no longer earn their runtime,
  with the budget as the recorded reason.

**Do not amend when:**

- the line is slow but still true — that is a budget conversation at
  `plan-release`, or a parallelize decision, not a retire;
- the line is failing because *this spine broke it* — that is a bug in the spine,
  and the cumulative demo just did its job;
- the line is inconvenient to keep green;
- you did not write it and are not sure why it exists. Ask. `source_spine` and the
  spine's retro say who to ask.

The third and fourth are the failure mode: a ledger that shrinks whenever it is
inconvenient stops being evidence about the product.

---

## 6. Anti-patterns

- **Amending by text instead of by line id** (§1).
- **Superseding without adding the replacement** (§3).
- **Quarantining at planning time** (§4).
- **A reason that names a feeling instead of a change** (§3).
- **Retiring a failing line instead of fixing the spine that broke it** (§5).
- **Planning an amendment and never closing the spine.** A pending amendment is
  consumed by `close`. If the spine is replanned or abandoned, clear it with
  `"$oss_bin" ledger_unplan <line-id> <spine>` — the spine argument is required (a
  line can hold more than one spine's pending amendment, so clearing without
  saying which one is the same silent-coverage-loss footgun the list exists to
  prevent) and an unknown line, or a spine with nothing pending on that line, is
  rejected rc 7. Otherwise the amendment sits in state waiting for a close that
  will never come — the doctor surface reports that as `warn: ledger - N demo line(s)
  carry a pending amendment awaiting a spine close`, advisory only; read the
  entries with `oss get '[.demo_ledger[] | select((.pending_amendments // [])
  | length > 0)]'`. There is no `reactivate` for an
  amendment `close` has already applied: at that point the flow really is gone
  and the ledger is recording history.
- **Deleting from `demo_ledger` directly.** There is no such operation, and there
  should not be.
