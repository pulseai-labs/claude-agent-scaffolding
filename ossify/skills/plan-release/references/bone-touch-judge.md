# The bone-touch judge

Depth for SKILL.md §7b. The mechanical, non-skippable half of class declaration:
**a spine whose plan touches a registered touch surface is reclassified to `bone`
automatically.**

It is called a *judge* rather than a *check* because it returns a verdict nobody
argues with. `oss touch_check` matches globs; the meaning of a match is fixed by
the methodology, not negotiated per spine.

---

## 1. Independent of the critic — say it twice

The bone-touch judge and the critic veto are **two separate judges over
the same spine**, and neither one clears the other:

- A **clean critic** does not clear a touch hit. The critic reviewing a spine and
  raising nothing is not evidence that the spine misses the surface — it is
  evidence the critic did not raise a finding.
- A **critic veto** does not require a touch hit. Rung 3 of the class ladder
  (bone by creation) catches bones that do not exist in the registry yet.
- The judge has **no dependency on the critic at all** — it runs on every
  declaration, whatever the audit's configured depth.

Order in SKILL.md §7 is ladder → touch → critic, and the touch judge's verdict
survives everything downstream of it. The only legitimate way to undo a
bone-touch reclassification is to **fix the touch surface** in the bones registry
(`start`'s job) because it was written wrong — never a user override of the
consequence. Overrides are for critic findings; a glob is not a finding.

---

## 2. Running it

```bash
if oss touch_check src/domain/order.rs src/ui/export.rs docs/guide.md; then
  # rc 0 — HIT. stdout carries one line per match:
  #   bone ADR-0002
  #   risk_gate live-order-execution
  echo "reclassify"
else
  # rc 1 — clean. Nothing registered was touched.
  # rc 2 also lands here, and it does NOT mean clean — see below.
  echo "clean"
fi
```

**rc 0 = matched, rc 1 = clean, rc 2 = could not check.** The 0/1 inversion is
deliberate (a hit is the "success" of the check) and every caller depends on it.
A skill that reads it backwards inverts the judge and silently reclassifies
exactly the wrong spines — this is the single most consequential mistake
available in this file.

**rc 2 is the judge saying it could not run**: no paths were passed, or the state
file was unreadable/malformed. It prints the reason on stderr and matches
nothing. The two-branch `if` above cannot distinguish it from a clean verdict, so
a mechanical check would degrade into the permissive `flesh` answer exactly when
the state is broken — the one situation where degrading is least acceptable. When
the class declaration turns on this verdict, test the rc explicitly:

```bash
oss touch_check src/domain/order.rs src/ui/export.rs; tc=$?
case "$tc" in
  0) : ;;   # HIT — reclassify to bone
  1) : ;;   # clean
  *) : ;;   # inconclusive — fix the state before declaring a class; do not proceed as clean
esac
```

Capture stdout as well as the exit code: the `bone <adr>` / `risk_gate <name>`
lines are what you write into the reclassification reason and what tells you
whether a control checklist has to be attached (§4).

---

## 3. Which paths to feed it

The judge is only as good as the path list. Collect the paths the spine's plan
**expects to change** — from the spine's scope discussion, the modules it names,
and the files an implementer would obviously have to open.

- **Repo-relative, as the plan writes them** (`src/domain/order.rs`, not
  `/Users/…/src/domain/order.rs`). Touch surfaces are authored repo-relative.
- **Directories count.** If the plan says "everything under `src/exec/`", feed a
  representative path under it (`src/exec/router.rs`) — the globs are prefix
  wildcards, so a representative path matches.
- **Include the files it will *read* across a boundary**, not just the ones it
  writes. A spine that starts depending on the domain core has touched the
  boundary even if it edits no file there.
- **Be generous.** A path fed that turns out untouched costs one audit; a path
  omitted costs an unplanned rewrite. When in doubt, feed it.

Glob semantics (matching is bash `case`): `*` matches **any** characters including
`/`, so `src/domain/**` behaves as a plain prefix wildcard and matches
`src/domain/order.rs` *and* `src/domain/pricing/rules.rs`. There is no real
double-star operator. `?` matches one character; `[abc]` is a character class.
Same rules as `start`'s `references/bones-registry.md` §4.

---

## 4. On a hit

### 4.1 Bone hit

```bash
oss class_set "<spine>" bone "bone-touch: ADR-0002 (src/domain/**)"
oss veto_add  "<spine>" "bone-touch: ADR-0002 (src/domain/**)" auto-bone "touch-surface overlap"
```

Both calls. `class_set` moves the class and appends to `class_overrides`;
`veto_add … auto-bone` records *why the class moved* in the same disposition
stream the critic writes to, so the release's audit trail reads as one story.

Then tell the user, in one line: *"`r1.s2` declared `flesh`, reclassified to
`bone` — its plan touches `src/domain/port.rs`, registered to ADR-0002
(hexagonal core)."* A silent reclassification is a surprise at close.

### 4.2 Risk-gate hit

Everything above, **plus** the gate's control checklist attaches to the spine's
close path as required work:

```bash
oss get '.risk_gates[] | select(.name=="live-order-execution") | .controls'
```

The listed controls (paper/sandbox env · human confirm naming the concrete effect
· kill switch · audit trail · progressive exposure, as that gate lists them) are
**required work in the spine's plan**, not advice. They become work items when
`plan-spine` decomposes the spine, and the close path checks them.

Record it so the checklist is not lost between planning and decomposition:

```bash
oss class_set "<spine>" bone "risk-gate: live-order-execution (src/exec/**) - controls: paper env, human confirm, kill switch, audit trail, progressive exposure"
oss veto_add  "<spine>" "risk-gate: live-order-execution (src/exec/**)" auto-bone "risk-surface overlap; gate controls attached"
```

**Harm is orthogonal to reversibility.** A flesh-class one-liner inside the
live-order path is still a Risk event: the class escalates *and* the controls
attach. Do not treat "it's a tiny change" as a reason to skip either half.

A single path can hit **both** a bone and a risk gate. Then both apply: one
reclassification, and the gate's controls on top.

---

## 5. On no hit

Change nothing. Write nothing. No `class_set`, no `veto_add`, no note in
RELEASE.md beyond the class the ladder already gave the spine.

A clean result is a real result: it says the spine lands on ground nobody
declared load-bearing. That is what `flesh` means, and it is the common case in a
healthy project. Manufacturing a reclassification "to be safe" is ceremony
inflation with a state record attached.

---

## 6. Worked verdicts

| Registry | Plan's changed paths | `touch_check` | Verdict |
|---|---|---|---|
| bone ADR-0002 "hexagonal core", touch `src/domain/**, src/port.rs` | `src/domain/order.rs`, `src/ui/list.rs` | rc 0, prints `bone ADR-0002` | **auto-bone** — `class_set … bone "bone-touch: ADR-0002 (src/domain/**)"` + `veto_add … auto-bone` |
| bone ADR-0002 "hexagonal core", touch `src/domain/**, src/port.rs` | `src/ui/export.rs`, `docs/export.md` | rc 1, no output | **clean** — no reclassification, no record; the spine keeps its declared class |
| risk gate "live-order-execution", touch `src/exec/**`, controls: paper env, human confirm, kill switch, audit trail, progressive exposure | `src/exec/router.rs` | rc 0, prints `risk_gate live-order-execution` | **auto-bone + controls attached** — bone close path *plus* that gate's five controls as required work |

In all three rows the verdict is the same whether the critic vetoed, passed, or
never ran.

---

## 7. Anti-patterns

- **Reading the exit code backwards.** rc 0 = matched.
- **Feeding a partial path list** and reporting "clean". The judge cannot see what
  you did not pass it.
- **Letting a clean critic pass override a touch hit** (or the reverse).
  Independent judges.
- **Overriding a bone-touch reclassification.** If the surface is wrong, fix the
  surface in the bones registry; do not override the consequence.
- **Attaching the controls but not escalating the class** on a risk-gate hit (or
  escalating the class and dropping the controls). Both, always.
- **Skipping the check for a "trivial" spine.** Triviality is a size judgment;
  the judge is about surfaces.
- **Running it once for the release** instead of once per spine. The verdict is
  per spine, and the reclassification is recorded against a spine id.
