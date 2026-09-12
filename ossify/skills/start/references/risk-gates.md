# Risk gates

Depth for SKILL.md §8. A risk gate is a first-class registry entry: a named
hazard, the **touch surface** that reaches it, and the **controls its family
attaches**.

---

## 1. What qualifies as a risk gate

A risk gate is not "code that might have bugs". It is a surface where a defect
produces harm that a test failure cannot undo. Four families:

| Family | Examples | Why it is irreversible |
|---|---|---|
| **Money** | Placing live orders, charging a card, paying out, spending API credits at scale | Money moved is gone |
| **Destructive** | Deleting user data, dropping/altering tables, overwriting files, force-pushing | Data destroyed is gone |
| **Identity / trust** | Auth, session issuance, permission checks, secrets handling, sending on the user's behalf | Impersonation and disclosure cannot be recalled |
| **Ordering / correctness-critical** | Ledger sequencing, idempotency keys, event ordering, financial arithmetic, determinism fingerprints | Silent corruption compounds before it is noticed |

If the harm is bounded and locally reversible, it is not a gate — do not inflate
the registry.

---

## 2. Controls, attached by family

**The "Applies when" column is the rule, not a hint.** A control whose column
names the gate's family is **required**. A control whose column does not name it
is **not applied**, and applying one anyway is ceremony inflation. Read the
column and take every row that names your family — there is no harm-scaling
judgment left to make, and no floor above which an attached control turns
optional.

| Control | What it means | Applies when |
|---|---|---|
| **Paper / sandbox env** | The operation runs against a non-real target by default; real mode is opt-in and explicit | Money, destructive |
| **Human confirm** | An interactive confirmation that names the concrete effect ("sell 200 shares of X at market") — never a generic "are you sure?" | Money, destructive |
| **Kill switch** | A single flag/env/endpoint that halts the operation class without a redeploy | Money, ordering |
| **Audit trail** | Append-only record of who/what/when/inputs/outcome, retained independently of the operation's own state | All four families |
| **Progressive exposure** | Ship to a narrow blast radius first (one account, one symbol, 1% of traffic), widen on evidence | Money, destructive, ordering |

Two more controls the column cannot express, defined here and attached below:
**least privilege** (the code path holds the narrowest credential that works)
and **no-secret-in-log** assertions.

**What the table cannot carry.** Identity gates also take least privilege and
no-secret-in-log assertions. Ordering gates also take a determinism/property test
when one is cheap. These are additions to what the column attaches, not
replacements for it, and they are the **only** additions — anything else outside
the column is ceremony inflation.

---

## 3. Recording a gate

```bash
oss risk_gate_add "<name>" "<touch-glob-csv>" "<controls-csv>"
```

Worked example:

```bash
oss risk_gate_add "live-order-execution" \
  "src/exec/**,src/broker/**" \
  "paper env,human confirm,kill switch,audit trail: record symbol\, side\, qty and outcome per order,progressive exposure"

oss risk_gate_add "user-data-deletion" \
  "src/admin/purge.rs" \
  "paper env,human confirm,audit trail,progressive exposure"
```

Touch surfaces use the same `case`-glob semantics as bones — see
`references/bones-registry.md` §4.

**The CSV grammar, once (#340): a bare `,` separates entries; `\,` is a
literal comma inside an entry.** A control is a short, checkable phrase a
human reads back at spine planning — and phrases may need commas, so escape
them (`audit trail: record image\, mounts\, egress per bootstrap` is ONE
control). Unescaped commas split — that was #340's defect: split fragments
could not be repaired afterward, because the journal is append-only. For
TOUCH surfaces, spell multiple directories as multiple entries
(`src/exec/**,src/api/**`): `case`-globs do not brace-expand, so a single
`src/{exec,api}/**` entry would match only the literal brace path and the
gate would never fire. A gate minted before you knew the grammar is
repaired NOT by editing state but by a corrective append:

```bash
oss risk_gate_set_controls "<name>" "<controls-csv>"   # refuses unknown names; refuses duplicate names (#305)
```

---

## 4. What a gate does downstream

A risk gate behaves like a bone with an attached checklist:

- A spine whose plan touches a gate's surface **auto-reclassifies to `bone`**
  (same mechanical check as bones, `oss touch_check`), *and* inherits that
  gate's control checklist as required work in the spine's plan.
- The gate's exposure is a **docs trigger** at release close: the first release
  where a gate's surface becomes reachable requires threat/failure notes plus an
  audit & recovery plan for that gate (spec §8 trigger table).

So a gate written here is not advisory — it converts, mechanically, into extra
ceremony the first time someone goes near it. That is the intended cost.

---

## 5. Release-0 minimum

Register only the gates the skeleton can actually reach. A skeleton that
backtests against historical data touches no money gate — but if the skeleton
*writes to the user's real filesystem* or *calls a paid API in a loop*, that is
a gate, register it now.

A gate that Release 0 cannot reach is still worth registering **when you already
know it is coming and know its surface** — the surface is what makes the later
reclassification automatic. If you do not yet know the surface, put it in the
feature map instead and register the gate when the surface exists.

---

## 6. Anti-patterns

- **A gate with no controls.** Then it is a worry, not a gate.
- **A control the family's column does not name.** Paper env or progressive
  exposure on an identity gate, a kill switch on a destructive one. That is
  ceremony inflation, and it is what trains people to skip the checklist
  wholesale. Attachment decides; harm is not re-litigated gate by gate.
- **"We'll add the kill switch later."** The control belongs in the plan of the
  spine that first reaches the surface — that is precisely what the touch
  surface guarantees. Do not pre-emptively defer it here.
- **Confirming with a generic prompt.** A confirmation that does not name the
  concrete effect trains the user to hit yes.
- **Treating a risk gate as a substitute for a bone.** A gate about *safety*
  often accompanies a bone about *design*. Register both when both apply.
