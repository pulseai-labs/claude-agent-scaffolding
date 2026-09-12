# The fake-expiry blocking finding

Depth for SKILL.md §6, step 3 (`release-close.md` §4). Spec §6.1 makes the fake
ledger's promise enforceable exactly here: *deferred truth never becomes
permanent silently*. A fake reduces **breadth, not truth**, and the only thing
keeping that sentence honest is a gate that fires at a release boundary.

_Dispatcher invocations below are `"$oss_bin" …` — the calling skill resolves `oss_bin` once (recipe: the plugin's `rules/dispatcher-path.md`); if it is unset in your context, resolve it there first._

`plan-spine` authors these entries (`plan-spine/references/fake-ledger-discipline.md`).
This file is the first **close-time** reader of them — until this layer existed,
`"$oss_bin" fake_status` had prose callers at planning time and none at a close, which
meant the expiry column was written by everyone and read by nobody.

---

## 1. Two arms, and only one of them is mechanical

Spec §6.1: *"A fake whose **trigger has fired**, or whose **expiry release
closes without a replacement**, becomes a blocking release-close finding."* Two
conditions, joined by an **or**, and they are not the same kind of thing:

| Arm | Kind | Who decides |
|---|---|---|
| **Expiry reached** | a **checked fact** | `"$oss_bin" expired_fakes` — a jq selector over `status` and `expiry_release` (§2) |
| **Trigger fired** | a **judgment** | you, reading each remaining fake's `replacement_trigger` against what the product now does (§4) |

**`replacement_trigger` is free text.** `"$oss_bin" fake_add` stores whatever its fourth
argument was — *"when the vendor ships a sandbox"*, *"the first live order"*,
*"the first user who isn't me"* (`oss_reg_add_fake` in `lib/registries.sh`). No selector can evaluate
whether that has happened. Running only the mechanical arm and reporting "fake
gate: clean" drops half of a spec row while sounding complete; running only the
judgment arm loses the one part of it a machine can be trusted with.

**Both arms run, every release close.** Neither substitutes for the other.

---

## 2. The mechanical arm — `"$oss_bin" expired_fakes`

```bash
ef=0; fakes_due="$("$oss_bin" expired_fakes "$rel")" || ef=$?
case "$ef" in
  0) echo "fake expiry: clean" ;;
  1) printf '%s\n' "$fakes_due"
     echo "close: $rel has fakes at or past their expiry - replace or explicitly renew each - halt"; exit 1 ;;
  *) echo "close: expired_fakes could not run (rc $ef) - INCONCLUSIVE, not clean - halt"; exit 1 ;;
esac
```

**The rc contract, pinned:**

| rc | Meaning | stdout |
|---|---|---|
| **0** | **CLEAN** — the blocking set is empty | nothing |
| **1** | **BLOCKING** — at least one fake is due | one TSV row per fake: `boundary`, `status`, `expiry_release`, `replacement_trigger` |
| **2** | **could-not-check** — the release argument is not `r<N>`, or `.fakes` is unreadable | the reason, on stderr |

**rc 0 is CLEAN here and rc 0 is a HIT in `"$oss_bin" touch_check`.** The polarity is
deliberately opposite: `touch_check` answers *"did anything match"*, this gate
answers *"may the close proceed"* — the same polarity as
`"$oss_bin" report_cross_check`. A ceremony that copies the touch-check branch shape
inverts the judge and passes exactly the releases this gate exists to block, at
rc 0, with nothing on stdout to say so.

**rc 2 halts.** An unreadable fake registry is inconclusive, never clean — the
same doctrine `touch_check` states for its own rc 2 (`spine-close.md` §6). The
state is broken exactly when degrading to the permissive answer is least
acceptable.

The release argument is validated for **shape only**, never for existence. This
is a read-only selector and the id reaches it from `"$oss_bin" id_parse`; an existence
check would add an rc-7 arm the ceremony has no branch for.

---

## 3. The selector, and every clause in it is load-bearing

The selector lives in **`oss_reg_expired_fakes`** (`lib/registries.sh`) — read it
there, never from a copy here that can drift. In prose: a fake joins the blocking
set when its `status` is `active` **or** `renewed`, **and** its `expiry_release`
(leading `r` stripped, compared as a number) is at or below the closing
release's — or fails to parse at all.

### `renewed` is inside the selector, and it is the entry most in need of it

The fake vocabulary is `active | replaced | renewed`, and **`replaced` is the
only resolving status**. Selecting on `active` alone lets a renewal escape its
own deadline: a fake renewed at `r1` with a new expiry of `r2` arrives at `r2`'s
close carrying `status == "renewed"`, is skipped by the gate, and is never asked
about again. Someone already pushed that deadline once — which is precisely what
makes it the record least safe to stop watching — and the escape is **silently
green**.

### At or before, never identity

`<=`, not `==`. Identity asks "does this fake expire exactly now" and lets every
fake that already **outlived** its deadline escape forever: three fakes expiring
at `r1`, `r2` and `r2` all vanish from an equality gate run at `r3`'s close, and
the release closes clean over all three.

### Numerically, because jq compares strings lexicographically

`jq -n '"r2" <= "r10"'` evaluates to **false**. A string comparison therefore
stops blocking `r2` expiries from the tenth release onward — the point in a
project's life with the most accumulated fakes. The `r` is stripped and the
remainder compared as a number. (`"r1" <= "r10"` is *true*, so a lexicographic
bug is invisible to any fixture whose expiry is a single digit. Only an `r2`-at-
`r10` case discriminates.)

### A malformed expiry blocks rather than being skipped

`try/catch` keeps a bad value from aborting the selector — without it one
unparseable record makes **every other fake escape with it**, which is the worst
available failure for a gate. But a caught record is not dropped: it is emitted
with `unparseable-expiry` in the expiry column. An expiry that never compares is
an expiry that never fires, and a fake that can never expire is exactly the
permanent-by-accident outcome this gate exists to prevent.

---

## 4. The judgment arm — the trigger pass

For every fake still outstanding **after** the mechanical arm is satisfied —
`status` is `active` or `renewed`, expiry still in the future:

```bash
"$oss_bin" get '[.fakes[] | select(.status=="active" or .status=="renewed")
          | {boundary, channel, expiry_release, replacement_trigger, reason}]'
```

Walk them one at a time. **Read each `replacement_trigger` verbatim**, out loud,
and ask the one question it was written to make answerable: *has this happened
yet?* A trigger is condition-shaped by construction — *"the first real strategy
iteration"*, *"the first live order"*, *"the first user who isn't me"*
(`plan-spine/references/fake-ledger-discipline.md` §2) — so the answer is usually a fact about the
release that just closed, and the release walkthrough (§3 of
`release-close.md`) is where you just watched it either happen or not.

**A fired trigger is a blocking finding with the same two unblocks as an expired
one.** It does not matter that the expiry is still in the future: the expiry
catches the fake whose trigger was written too narrowly to ever fire, and the
trigger catches the fake that became wrong because the product changed. They fail
differently, which is why the spec names both.

Do not paraphrase a trigger into something easier to answer, and do not answer it
from the fake's `reason` — the reason says why the fake was acceptable *then*.

### When the trigger is not answerable from the walkthrough

The paragraph above assumes a **product-observable** trigger, which is what the
authoring discipline asks for. Two kinds routinely arrive anyway, especially on a
project that predates the discipline:

**Externally-anchored** — *"when the vendor ships a sandbox"*, *"when the upstream
API leaves beta"*. Nothing in the walkthrough answers it, because the condition
lives outside the product. Check the external fact directly and **record the check
with its date and source** in the release retro's §7. Unchecked is not the same as
not fired; an unchecked external trigger is an open item, not a pass.

**Undecidable** — *"when performance becomes a problem"*, *"once the design
settles"*, *"when we have real users"*. There is no observation that closes these,
which means the fake can never expire by trigger and only the expiry release will
ever catch it.

**The rule: an unverifiable trigger is itself a finding.** Do not guess, and do
not wave it through as "not fired" — "not fired" is a claim you cannot support.
Surface it, and let the operator take one of the two unblocks in §5. **Renewal
requires rewriting the trigger into something checkable** — that rewrite is the
actual work, and a renewal that carries the same undecidable string forward has
renewed nothing. If the operator cannot state an observation that would fire it,
that is strong evidence the fake needs replacing rather than renewing.

---

## 5. The only two unblocks

```bash
"$oss_bin" fake_status "<boundary>" replaced "<what landed, and where>"
"$oss_bin" fake_status "<boundary>" renewed  "<why it is still needed>" "<new-expiry-release>"
```

**Replace** — the real boundary landed. The fake entry is never deleted, the same
way a demo line never is; `replaced` is the only status the gate treats as
resolved.

**Renew, explicitly** — with a **new expiry release** and a stated reason. The
reason is the whole content of the act: what the real one would cost, and why
that cost still buys nothing yet. "No time" is not a reason
(`plan-spine/references/fake-ledger-discipline.md` §1).

> **`renewed` with no fifth argument does not move the deadline.** It is a status
> annotation: `expiry_release` stays exactly what it was
> (`plan-spine/references/fake-ledger-discipline.md` §3), so the fake arrives at the *next* close still
> due, still blocking, now carrying `status == "renewed"` — which this gate
> selects on precisely so that call cannot become an escape. **A renewal without
> a new expiry does not unblock the close.** Pass the fifth argument.

**There is no third option.** Not "note it and move on", not "carry it forward",
not a deferral row. A fake that cannot be replaced and cannot be given a defended
new deadline is a fake nobody is willing to own, and that is the finding.

Two side effects worth taking while you are here, neither of them an unblock:

- **Feed the replacement into the feature map** so it competes for selection like
  everything else, rather than living only in a record nobody re-reads:
  `"$oss_bin" feature_add "replace the <boundary> fake" "<the value the real one unlocks>" "<bone|flesh>" fake-replacement`.
- **A fake renewed twice is a finding about the plan**, not about the fake. Say
  so in the release retrospective's still-standing roll-up
  (`release-close.md` §6).

---

## 6. Anti-patterns

- **Running the mechanical arm only** and reporting the gate clean (§1).
- **Pretending a selector decides whether a trigger fired.** It is free text
  (§1).
- **Selecting on `active` alone.** A renewal then escapes its own deadline,
  silently green (§3).
- **Comparing the expiry for identity.** Everything already overdue escapes
  forever (§3).
- **Comparing release ids as strings.** `"r2" <= "r10"` is false (§3).
- **Skipping a fake whose expiry will not parse.** It can never expire, so it
  blocks (§3).
- **Copying `touch_check`'s branch shape** — rc 0 is a hit there and clean here
  (§2).
- **Folding rc 2 into clean** (§2).
- **Treating `renewed` with no new expiry as a renewal** (§5).
- **Inventing a third unblock** — noting it, deferring it, carrying it forward
  (§5).
- **Answering a trigger from the fake's `reason`** (§4).
