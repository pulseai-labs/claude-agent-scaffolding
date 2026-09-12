# The critic veto (fail-closed)

Depth for SKILL.md §7c. The veto is **plugin-side interpretation of standard
audit findings** — the audit is ossify's own `challenge` skill in audit mode,
and the veto is entirely our reading of what it returned. Everything below is
about how *you* read what it returned.

**One sentence to hold onto:** a veto-grade finding you understand reclassifies
the spine to `bone`; a veto-grade finding you *don't* understand escalates to the
user; a finding that isn't veto-grade at all does nothing. There is no fourth
outcome, and "it's probably fine" is not one of the three.

---

## 1. What is submitted, and when

| | |
|---|---|
| **When** | At class declaration (SKILL.md §7), after the class ladder and the bone-touch judge have run, before `RELEASE.md` is final and before any spine reaches `plan-spine` |
| **Submitted** | `RELEASE.md` + the bones registry *with its touch surfaces* + each spine's plan (name, class, scope, expected changed paths) |
| **Depth** | `close` |
| **Fires** | Once per release-planning pass. A re-plan after an escalation is resolved may fire again |

The bones registry is part of the submission on purpose: without the touch
surfaces the critic cannot tell that "adds a second order type" lands inside the
hexagonal core, and its findings degrade to generic advice.

---

## 2. Running the audit (the only supported shape)

Read `${CLAUDE_PLUGIN_ROOT}/skills/challenge/references/audit.md` end to end
and follow it: `RELEASE.md` is the artifact (one absolute path), the depth is
`close`, the target label is the release id. The bones registry and the spine
plans go into the conversation alongside it, not into a flag — the audit reads
one artifact file, and the rest of its context is conversational.

**The audit always runs.** It is internal to ossify: there is no install probe,
no env bridge, and no absent-critic path. Whether an external fresh-frame
adversary joins the close-depth pass is the adversary ladder's decision
(`challenge/references/adversaries.md`), and the audit's summary names what
ran. A host-only pass on an unconfigured install is the declared default, not
a skipped veto: the findings are real findings, and Gate A applies to them
unchanged.

Control returns via the audit's closing line — `Audit complete for <target>.
<K> challenges stood:` plus one `- [<severity>] <text>` bullet per standing
challenge, the severity prefix being what Gate A's `alternative`-severity
exclusion sorts on — which is
the input everything below reads.

---

## 3. Gate A — is the finding veto-grade?

Run this first, per finding. It is the gate that stops the veto from firing on
everything the critic says.

A finding is **veto-grade** when it bears on the spine's **class** — it asserts,
or gestures at, the spine doing something its declared class does not admit:

- creating or modifying a bone (system shape, module boundary, data ownership,
  public contract, trust boundary, stack);
- breaking a public contract or a compatibility promise;
- moving a boundary, a seam, or a dependency direction;
- crossing a trust / money / destructive / ordering-critical surface;
- any change the finding calls hard to reverse, load-bearing, or breaking for
  consumers.

A finding is **not** veto-grade when you can positively place it as
class-irrelevant:

- cosmetic or UX polish suggestions ("consider a progress spinner");
- `alternative`-severity remarks — a different way to do the same thing, with no
  claim that the current way changes a bone;
- naming, style, test-shape, or work-item-detail notes;
- praise, or a restatement of the plan.

**Not veto-grade is not the same as not worth acting on.** The critic audits the
whole of `RELEASE.md`, so it also returns findings that are substantive and
release-level yet say nothing about any spine's class:

- *"the exit criteria contradict each other"*
- *"the DAG serializes two spines that have no dependency"*
- *"the release goal is not a user journey"*
- *"two spines both claim the same feature-map entry"*

These are neither veto input nor the trivia listed above. Read literally, the
list is a two-way sort and they fall out of it producing **nothing** — not a
veto, not a digest line, not a mention. A real problem with the release, found
and then dropped, because the only machinery on this page is about class.

**So route them: surface substantive non-class findings to the user as ordinary
critique, and fold the accepted ones into the plan before the final render**
(`release-md-emission.md`). They do not enter the veto ladder, they are not
`oss veto_add` rows — that verb records *class* dispositions and a non-class
finding in it corrupts the record the class audit reads. They are planning
feedback, and this is the last moment the plan is cheap to change.

Say what you did with each in the digest, one line, the same as any other
finding. "Not veto-grade" is a routing decision, never a synonym for "ignored".

**The fail-closed clause.** If you cannot positively place a finding on either
side — because it is too vague to locate, or because it cites scope that is not in
the plan — it is a **veto candidate**, and it goes to Gate B. Only findings you
can affirmatively identify as class-irrelevant fall out here. Uncertainty moves
*toward* the user, never toward silence.

**If no finding on a spine passes Gate A** — the review was clean, or its only
remarks were cosmetic — the disposition is **`none`**:

- write **no** disposition record (`oss veto_add` is not called);
- change **no** class; the spine keeps the class §7a/§7b gave it;
- say so in the digest: *"critic raised no veto-grade finding on `r0.s7`; class
  stands as declared (`flesh`)."*

`none` is a fixture/answer vocabulary word, never an argument: `oss veto_add`
validates its disposition against `auto-bone|override|escalate` and exits 2 on
anything else. **Do not manufacture a veto to look thorough.** A skill that
escalates every clean review is exactly as broken as one that passes every veto —
it just fails in the direction that looks diligent.

---

## 4. Gate B — clear, or one of the three ESCALATE triggers?

Every veto candidate resolves to exactly one of these.

### 4.1 Clear → `auto-bone`

The finding is **specific** (it names the mechanism: which contract, which
module, which surface), **current** (the scope it cites is in this spine's plan),
and **decidable** (you can state in one sentence why the spine's declared class
understates the change).

```bash
oss class_set "<spine>" bone "critic veto: <finding, condensed>"
oss veto_add  "<spine>" "<finding>" auto-bone "<why it is a bone: the mechanism>"
```

Auto-applying the reclassification is the **spec-aligned safety default**
(spec §5.2 step 3): misclassification is a safety property, and bone ceremony on
a flesh spine costs an audit, while flesh ceremony on a bone spine costs an
unplanned rewrite. Tell the user what you auto-applied; do not ask permission
first.

### 4.2 Ambiguous → `escalate`

The finding gestures at a class-bearing concern but names no mechanism, or hedges
its own significance: *"something about the boundary here feels off, not sure it
matters."* It is neither a clear pass nor a clear veto — and a hedge is not a
pass.

### 4.3 Contradictory → `escalate`

Two findings on the same spine cannot both be true: *"safely reuses the existing
event schema (no compatibility risk)"* alongside *"changes the event schema shape
and breaks consumers."* Do **not** pick the reassuring one, do not average them,
and do not silently prefer the more alarming one either — record the pair and let
the user rule. Both findings go into the record.

### 4.4 Stale → `escalate`

The finding cites scope that is not in the current plan — a module that no longer
exists (`src/legacy/adapter.rs`), a contract already retired, an earlier draft of
the spine. Stale findings are the tempting ones to discard, because the reasoning
"that file is gone, so the concern is void" is *usually* right. It is not always
right: the concern may have moved with the code, and a stale citation frequently
means the audit read an older artifact than the one you meant to hand it.
Escalate; the user decides whether the concern survived the rename.

### 4.5 Recording an escalation

```bash
oss veto_add "<spine>" "<finding, verbatim enough to re-read>" escalate "ambiguous|contradictory|stale - fail-closed"
```

Name the trigger in the reason (`ambiguous`, `contradictory`, or `stale`), then
**surface it to the user in conversation** — a state record nobody reads is not an
escalation. The class declaration for that spine is **held open**: it does not
proceed to `plan-spine` until the user rules. If the user declines to rule, the
fail-closed default applies and the spine is planned as `bone`.

### 4.6 Closing an escalation

The `veto_add … escalate` record does not close the escalation, and it does not
move the class. It records that a finding *was* escalated. Until a `class_set`
call runs, the spine keeps whatever the class ladder declared
(`references/class-declaration.md` §1 / SKILL.md §7a) — and for a hedged
boundary finding that is very often `flesh`, the exact opposite of the fail-closed
default §4.5 just promised. Every escalation therefore ends in one of three calls:

| The user's ruling | Class call | Disposition record |
|---|---|---|
| "yes, it is a bone" | `oss class_set "<spine>" bone "escalation resolved: <the ruling>"` | the original `escalate` record stands |
| "no, it stays flesh" | `oss class_set "<spine>" flesh "<the user's reason>"` | `oss veto_add "<spine>" "<finding>" override "<the user's reason>"` — §5's shape, because the user is reversing a fail-closed default |
| declines to rule, or the session ends unresolved | `oss class_set "<spine>" bone "escalation unresolved - fail-closed default"` | the original `escalate` record stands |

Issue the class call even when it does not change the value: `class_set` appends
to `class_overrides`, and that append is the audit trail showing a human was asked
and what came back.

The class in state — not the disposition log — is what `references/release-md-emission.md`
renders into RELEASE.md's class table and what `plan-spine` reads to pick a
ceremony path. Skip the class call and the release ships a class table that
contradicts its own disposition log.

---

## 5. User override — recorded, never silent

An override is the user reversing an `auto-bone` back to `flesh`. Two conditions,
both required:

1. **The user says so explicitly.** You never initiate an override. "The critic
   may have overreached" is your read, not a decision.
2. **They give a reason**, and it is recorded in *their* terms — *"the touched
   file is a generated stub, not the real port."*

```bash
oss class_set "<spine>" flesh "<the user's reason>"
oss veto_add  "<spine>" "<the original finding>" override "<the user's reason>"
```

Both calls, always. `class_set` moves the class (and appends to
`class_overrides`); `veto_add … override` is what preserves the *audit trail* —
that the critic vetoed, that a human overrode, and why. The two records answer
different questions six months later.

An override does **not** erase the original `auto-bone` disposition; dispositions
append. Reading the pair back in order is the story.

An override never applies to a **bone-touch** hit. That judge is mechanical: the
plan touches a registered surface or it does not. If the surface is wrong, fix the
surface (`start`'s bones registry), do not override the consequence.

---

## 6. Worked dispositions

| Finding on the spine | Gate A | Gate B | Disposition | State written |
|---|---|---|---|---|
| "this 'flesh' spine changes the public trade-event schema — compatibility-breaking, hard to reverse" | veto-grade (public contract) | clear, specific, current | `auto-bone` | `class_set … bone` + `veto_add … auto-bone` |
| "something about the boundary here feels off, not sure it matters" | veto-grade (gestures at a boundary) | **ambiguous** | `escalate` | `veto_add … escalate` + surfaced |
| finding cites `src/legacy/adapter.rs`, absent from the plan | can't place → candidate | **stale** | `escalate` | `veto_add … escalate` + surfaced |
| "safely reuses the schema" **and** "changes the schema, breaks consumers" | veto-grade | **contradictory** | `escalate` | `veto_add … escalate` (both findings) + surfaced |
| critic vetoed; user says "that file is a generated stub, not the real port" | — | — | `override` | `class_set … flesh` + `veto_add … override` |
| only remark is "consider a progress spinner for large exports" | **not** veto-grade (cosmetic / `alternative`) | — | **none** | **nothing** — class stands as declared |

---

## 7. Digest

After the pass, surface a short digest: which spines were auto-boned and on what
mechanism, which findings were escalated and under which trigger, which overrides
the user made, and which spines the critic left alone. A silent interpretation is
indistinguishable from ignoring the critic.

---

## 8. Not the same as `start`'s critic moment

`start` §11 runs an **advisory** spec-core audit: its findings are
disposition-triaged, spec-aligned ones auto-fold into the spec, and a challenge
the user declines is recorded while the flow continues. **It never gates.**

This pass is **fail-closed**: a veto auto-applies as reclassification, and
ambiguity defaults to ESCALATE rather than to pass, because misclassification is
a safety property. Do not import `start`'s advisory semantics here, and do not
export this pass's fail-closed semantics into `start`.

Both are true at once, and the asymmetry is deliberate.

---

## 9. Anti-patterns

- **Auto-passing an ambiguous / contradictory / stale finding.** All three
  escalate. This is the whole rule.
- **Manufacturing a veto or an escalation from a clean review.** `none` writes
  nothing.
- **Passing `none` to `oss veto_add`.** Exit 2. It is an answer, not a value.
- **Calling `veto_add` for a spine that does not exist yet.** Exit 7 — create the
  spine first (`oss spine_add`), then record against its minted id.
- **Overriding on your own initiative, or without recording the reason.**
- **Letting a clean critic clear a bone-touch hit** (or vice versa) — independent
  judges.
- **Asking the critic for a verdict.** It returns findings; the veto is our
  interpretation of them. Do not send it ossify vocabulary and expect
  `bone`/`flesh` back.
- **Re-running the critic until it says something you like.** One pass per
  planning round; a re-run belongs to a re-plan after an escalation resolves.
- **Skipping the audit because no adversary is configured.** Host-only is the
  declared default depth, not an absence; the veto runs either way (§2).
