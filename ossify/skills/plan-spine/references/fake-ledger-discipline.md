# Fake-ledger discipline

Depth for SKILL.md §9. Selective fakes reduce **breadth, not truth**. The ledger
is what keeps that sentence honest: it makes every fake visible, dated, and owned.

---

## 1. Every fake gets an entry

Any work item that **introduces or retains** a shell, stub, or fake records one —
including fakes inherited from the skeleton and deliberately left in place. "It
was already there" is the most common way a fake becomes permanent.

_Dispatcher invocations below are `"$oss_bin" …` — the calling skill resolves `oss_bin` once (recipe: the plugin's `rules/dispatcher-path.md`); if it is unset in your context, resolve it there first._

```bash
"$oss_bin" fake_add "<boundary>" "<real|fake|deferred>" "<reason>" "<replacement trigger>" "<expiry release>"
```

| Field | Meaning |
|---|---|
| **boundary** | The seam being faked, named the way the code names it (`broker-adapter`, `coach-llm`, `email-sender`) |
| **channel** | `real` \| `fake` \| `deferred` — validated; anything else exits **2** |
| **reason** | Why the real thing is out of scope *for this spine*. Not "no time" — what the real one would have cost and why that cost does not buy anything yet |
| **replacement trigger** | The **condition** that makes the real one due. Never a date |
| **expiry release** | The release by which it must be replaced or **explicitly renewed**. A release id (`r0`, `r1`, …) — `fake_add` does not check the shape, and anything else BLOCKS the release close as `unparseable-expiry` (`close/references/fake-expiry.md` §3) |

The three channels: **`real`** records a boundary deliberately built real (useful
when a previous spine faked it and this one replaced it); **`fake`** is a shell
standing in for a real implementation; **`deferred`** is a boundary not wired at
all yet, where the product currently goes without.

---

## 2. Trigger and expiry are both mandatory

They fail differently, which is why both exist:

- The **trigger** fires on a condition — *"the first real strategy iteration"*,
  *"the first user who isn't me"*, *"the first live order"*. It catches the fake
  that becomes wrong because the product changed.
- The **expiry release** fires on time — it catches the fake whose trigger was
  written so narrowly it never fires.

A fake whose **trigger has fired**, or whose **expiry release closes without a
replacement**, becomes a **blocking release-close finding**. It can be renewed —
explicitly, with a new expiry and a stated reason — but it cannot be ignored.
Deferred truth never becomes permanent silently.

A date is not a trigger. *"Replace in Q3"* is a wish with a calendar attached; the
condition it is standing in for ("when we onboard a second account") is the real
trigger, and it is the one that will actually fire.

---

## 3. Changing a fake's status later

```bash
"$oss_bin" fake_status "<boundary>" "<active|replaced|renewed>" "<reason>" ["<new-expiry-release>"]
```

An unknown boundary exits **7**; a status outside `active|replaced|renewed`
exits **2**. Use `replaced` once the real boundary has landed — the fake entry
itself is never deleted, same as a demo line.

**`renewed` with no 5th argument is a status annotation only.** It records that
the fake was re-examined and is still needed — it does **not** move the
deadline. `expiry_release` stays exactly what it was, so a `renewed` call with
no new expiry changes nothing the release-close expiry check enforces: the fake
is caught by the same release it was already going to be caught by. To actually
move the deadline, pass the new expiry release as the 5th argument.

**The check reads BOTH fields, and it is worth knowing which does what**
(`oss_reg_expired_fakes`, `lib/registries.sh`):

- **`status` decides what is in scope** — `select(.status == "active" or
  .status == "renewed")`. A fake moved to `replaced` drops out of the gate
  entirely.
- **`expiry_release` decides whether an in-scope fake is expired.**

So `renewed` keeps a fake **in** scope while leaving its deadline alone, which
is exactly the intent — a re-examined fake is still owed. Reading it as "the
check ignores `status`" inverts the first half: it suggests `replaced` and
`renewed` are equivalent to the gate, and they are opposites.

---

## 4. Triggers feed the feature map

So the replacement competes for selection like everything else, rather than living
only inside a fake record nobody re-reads:

```bash
"$oss_bin" feature_add "replace the <boundary> fake" "<the value the real one unlocks>" "<bone|flesh>" fake-replacement
```

Write the **value**, not the task: *"real fills so P&L is trustworthy"* earns
selection; *"implement broker adapter"* does not.

---

## 5. Banned fakes

Never admissible, whatever the schedule pressure. Each one converts "reduced
breadth" into "reduced truth", which is the whole thing the ledger exists to
prevent.

| Banned | Why it is different from a legitimate fake |
|---|---|
| **Faking the core hypothesis**, or the **actor's outcome** | The demo then proves the product works by assuming it works. The one thing a skeleton must be honest about is the thing it is testing |
| **Bypassing the real entry point** | A journey that starts at an internal function is not the journey. The clean-checkout test is exactly this |
| **Bypassing a load-bearing integration seam** | The seam is where the surprises live; skipping it defers all of them to one late spine |
| **Replacing a safety / money / identity / ordering invariant** | Harm is orthogonal to reversibility. A faked kill-switch is not a fake, it is a missing control |
| **Hiding failure signals** — swallowing errors, always-green stubs | The product then cannot tell you it is broken, and neither can the demo |
| **Requiring manual state repair** to keep the demo working | Then the demo measures the operator, not the product |
| **A fake whose semantics differ from its planned replacement** | The integration cost is not deferred, it is *hidden* — and it lands at the worst moment |
| **A speculative abstraction added solely to make something mockable** | Test-shaped architecture. The interface earns its place from the product's needs, not the test's |

**AI providers** are volatile external boundaries and **always** sit behind a
product-owned swappable interface. That is a standing exception to "no speculative
abstractions", justified by the volatility of the boundary — and it **does not
license** speculative interfaces around unrelated internal algorithms.

---

## 6. Worked cases

| Proposed | Verdict |
|---|---|
| Skeleton ships a `coach-llm` shell returning a canned response; trigger *"the first real strategy iteration"*, expiry `r1` | **Admissible.** Narrow boundary, honest reason, condition-shaped trigger, dated ceiling |
| Broker adapter returns synthetic fills so the paper loop closes; trigger *"the first live order"*, expiry `r2` | **Admissible** — provided the fill *semantics* match the real adapter's (partial fills, rejects). Same shape, less breadth |
| Broker adapter always fills at the requested price, instantly, never rejects | **Banned** — semantics differ from the planned replacement. The whole risk of the boundary is exactly what was faked away |
| Order validation stubbed to always pass "so the demo flows" | **Banned** — that is the actor's outcome faked, and it hides failure signals |
| A `Clock` trait introduced so tests can freeze time, with one production impl | **Judgement, leaning banned** — if only the test needs it, it is a speculative abstraction. If the product needs deterministic replay, it is a bone, and it belongs in an ADR, not the fake ledger |
| The whole persistence layer is in-memory for Release 0, and the release's journey does not claim durability | **Admissible as `deferred`** — the product genuinely goes without, and the demo does not claim otherwise. It stops being admissible the moment a journey line says "and it's still there tomorrow" |

---

## 7. Anti-patterns

- **An undeclared fake.** Including one inherited from the skeleton and left in
  place (§1).
- **A date as a replacement trigger** (§2).
- **A trigger with no expiry**, or an expiry with no trigger. Both (§2).
- **Renewing an expired fake silently.** Explicit, with a new expiry and a reason
  (§3) — a `renewed` call with no new expiry is a status annotation, not a
  renewal; the deadline only moves when the 5th argument does (§3).
- **A reason that is "no time".** Say what the real one costs and why that cost
  buys nothing yet (§1).
- **Passing a channel outside `real|fake|deferred`.** Exit 2 (§1).
- **Speculative interfaces justified by the AI-provider exception** (§5).
- **A fake whose semantics differ from its replacement** — the most expensive
  entry in the banned table, because it looks like the cheapest (§5).
