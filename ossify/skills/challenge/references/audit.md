# Audit mode — the adversarial critique

Depth for `challenge/SKILL.md`. An adversarial audit of a written artifact: a
spec, a plan, a `SPINE.md`, a `RELEASE.md`. You surface unstated assumptions,
missing failure modes, and viable alternatives the author has not considered,
consolidate them, and then either hand the set to the invoking ceremony
unwalked (the usual case, §7) or — standalone — run a structured rebuttal
cycle so each challenge is conceded (the artifact strengthens) or stands (and
is recorded standing).

Absorbed from architect-critic's `critiquing-spec` (0.6.0), reduced to what
ossify's call sites consume. What was deliberately left behind: cross-run
state, promotion candidates, principles files, async dispatch, and the env-var
invocation bridge. Ossify's records are the ceremony outputs — the close
report, the veto trail, the retro — and they already persist what the lifecycle
needs.

**You never gate.** The caller dispositions your findings. The same audit is
advisory under `start` and fail-closed under `plan-release`'s veto, and that
asymmetry is the caller's, not yours.

---

## 1. Inputs

The invoking prose hands you, in plain language:

- **the artifact** — one absolute path to a readable file;
- **the depth** — `shallow` (host-only) or `close` (recruit the external
  adversary per the ladder);
- optionally **an adversary override** and **a target label** for the closing
  line.

When the user invoked `/ossify:challenge` directly, resolve the artifact from
the command argument. If there is none, glob the repo root and `docs/` for
**only** `SPEC*` / `MASTER-SPEC*` / `PLAN*` — never `*.md`, which surfaces
READMEs and stray notes as spec candidates — then ask the user to pick.

Edge cases: a directory path → look inside for the restricted patterns, ask if
several match. A URL → reject; the audit reads files on disk. Over 50K lines →
say so and confirm the audit focuses structurally. Under 20 lines → say the
audit will likely surface little, confirm the right file.

Read the artifact end to end and hold it in working context.

---

## 2. Orient first

Emit a compact **"📍 You are here"** block before the audit runs:

- **Topic** — the artifact under audit, one line.
- **Where it sits** — which ceremony moment invoked this (spec-core close,
  release veto, spine plan, spine close, standalone), and the artifact's weight.
- **Why** — what decision this audit informs.

Derive it from context; if thin, ask for a one-line reminder. A few lines —
this orients, it does not gate.

---

## 3. Announce the adversary before the audit runs

Resolve the ladder (`references/adversaries.md`): per-invocation override →
`OSSIFY_ADVERSARY` → host-only. Then say what will happen, in plain prose the
user can act on:

- **close depth, adversary configured and probe passes** — *"<name> detected;
  will run a fresh-frame audit (~60s)."*
- **close depth, unconfigured** — one plain status line, not a warning:
  *"No adversary configured — running host-only. Set `OSSIFY_ADVERSARY` (see
  challenge/references/adversaries.md) for an external fresh-frame."*
  Unconfigured host-only is the declared default, not a degraded state.
- **close depth, `OSSIFY_ADVERSARY=none`** — *"Adversary disabled
  (`OSSIFY_ADVERSARY=none`) — running host-only."* A deliberate choice, one
  plain line; do not advise configuring what was deliberately turned off.
- **close depth, configured but probe fails** — *"<name> configured but not
  available (<cause>); running host-only."*
- **shallow depth** — *"Running a host-only pass. Close depth recruits the
  external adversary."*

Never skip this. The user may want to abort and configure an adversary first.

---

## 4. Host self-audit, in conversation

Perform the audit yourself, here, now. No delegation, no `bash -c` around
reasoning.

**The ghost-notes lens.** The highest-yield move is noticing what the artifact
does *not* say. Specs over-document what their authors were thinking about and
silently omit what they had not thought about. Train on the omissions:

- failure modes named with no specified response;
- dependencies cited generically ("the upstream service") without naming or
  pinning;
- "future work" sections hiding decisions deferred indefinitely;
- defaults assumed but never written (timeouts, retries, ordering guarantees);
- cross-cutting concerns (auth, observability, rate limits) absent from an
  artifact that obviously needs them.

**CORE tone on every challenge.** Curiosity (*"I'm curious whether…"*, a
question not an indictment), Objectivity (what the artifact says and does not
say, with section refs, before interpretation), Reassurance (name what is
reasonable about the current approach before the concern), Empathy (speculate
generously about why the gap exists — often deliberate scoping).

Produce, inline in your turn:

```json
{
  "challenges": [
    { "text": "...", "severity": "premise|gap|alternative", "rationale": "..." }
  ]
}
```

**Severities.** `premise` — a foundational assumption that looks unsound; if
wrong, the artifact collapses. `gap` — a missing element the artifact needs.
`alternative` — a viable approach not considered; the current one is fine, and
the artifact should record why it was picked.

Typically 3–10 challenges; more for long artifacts, fewer for short. One
premise-level challenge outranks ten nits. **Anti-patterns:** nit-picking
(typos are edits, not challenges); restating the artifact; vague universal
advice ("consider more tests" — name the boundary and the scenario);
mode-collapse to one severity; pile-on without escalation (five challenges on
one premise consolidate into one premise-level challenge with the rest as
evidence).

---

## 5. Close depth: the external fresh-frame

Shallow depth skips this step. At close depth, if the ladder resolved to an
adversary, run its recipe from `references/adversaries.md`.

The adversary is a separate model in a separate session with no knowledge of
this conversation. That fresh frame is the point: it catches what your
self-audit cannot see because you already absorbed the artifact's framing. The
prompt you build carries (a) the full artifact content **plus every companion
the invoking prose submitted alongside it** — the bones registry with its
touch surfaces, the spine plans, whatever the caller handed over: the
fresh-frame adversary gets the same submission the host audit got, or its
findings degrade to advice about the one file it was handed, (b) the
instruction to be adversarial — *"surface the strongest single-paragraph
counter-arguments; do not be polite, do not soften, do not assume the author
is correct"* — and (c) the return contract from `adversaries.md` §3, verbatim.

On timeout, non-zero exit, over-cap prompt, or missing/invalid output: one
warning naming the cause, then continue host-only. Never retry mid-ceremony.

---

## 6. Consolidate

Merge the one or two challenge lists yourself, in conversation — two short
lists are judgment work, not helper work:

- **Similarity dedup.** Text overlap above ~70% is the same challenge.
- **Attribution.** Each survivor gets a source: `[host]`, `[adversary]`, or
  `[host, adversary]`. **Cross-confirmed challenges are the strongest
  signal** — an auditor steeped in the framing and one innocent of it landed on
  the same issue. Surface those first in the rebuttal.
- **Severity reconciliation.** Same challenge, different severities → the
  higher stands (`premise` > `gap` > `alternative`).

---

## 7. The rebuttal cycle

The heart of the user experience — **for a standalone invocation.** You ask in
your turn; the user replies in theirs. Never capture answers through bash.

**A ceremony caller skips this cycle entirely.** When the invoking prose is a
lifecycle moment that dispositions findings itself — the release veto's
fail-closed ladder, close's triage, start's disposition pass — the rebuttal
here would consume findings before the caller's own machinery sees them: an
`accept` inside this cycle marks a concession and drops the challenge from
the closing line, and the veto never learns a class-bearing finding existed.
Those callers' ladders ARE the rebuttal, and their records (`oss veto_add`,
the close report, the spec fold-in) are where acceptance is applied. So: a
ceremony invocation returns **every** consolidated challenge unwalked — the
closing line reads `<N> challenges stood:` with all of them, no triage, no
cycle — and the caller dispositions. The cycle below runs only when the user
invoked `/ossify:challenge` directly.

**Recommend by default.** Each challenge you surface carries one recommended
disposition (`accept` / `rebut` / `defer`) with a one-line rationale, cited
from the artifact or project sources where possible, labelled *(general best
practice)* where not. `--neutral` or *"just list the challenges"* suppresses
recommendations for the invocation.

**Triage first** (skipped under `--walk` or `--neutral`): classify every
consolidated challenge against the escalation predicate — UNGROUNDED,
VISION/SCOPE-TOUCHING, ONE-WAY DOOR, TOP SEVERITY (`premise` on this surface),
CONTESTED (recommended disposition is `rebut`, or host and adversary disagree
on the finding). Predicate-clean challenges apply their recommended disposition
now; emit the digest:

```
⚡ Auto-applied K of N
<index> · <challenge one-liner> · <accept|defer> · <citation>
...
Escalated: M challenge(s) — walking them now. (`reopen <ids>` pulls one back.)
```

An auto-applied `defer` stays tracked (filed or listed), never dropped.
`reopen <ids>` reverses an auto-applied item into the walk.

**Then walk the escalated set**, one challenge per turn:

```
Challenge 1 of N (severity: <premise|gap|alternative>)
<CORE-toned text>
Rationale: <why this might matter>
Recommended: <accept|rebut|defer> — <one-line, cited where possible>

Your response (accept | rebut | defer):
```

End your turn and wait. On the reply:

- **accept** → concession; advance.
- **defer** → tracked for later; advance.
- **rebut** → score the rebuttal 1–5 yourself:

  | Score | Meaning | Result |
  |---|---|---|
  | 1 | bare contradiction | stands |
  | 2 | cites the artifact, but the cited text does not address the gap | stands |
  | 3 | engages, addresses about half | stands, softened — suggest recording the reasoning in the artifact |
  | 4 | material new info changes the calculus | concede |
  | 5 | the challenge's premise is shown wrong | concede, with thanks |

  On stands: *"That doesn't quite address the concern — the challenge stands,
  but I've noted your reasoning."*

**Escape hatches.** *"linear from here"* / *"batch the rest"* → list all
remaining challenges once, take one batched reply, score in batch.
`alternative`-severity challenges that trip the predicate are end-batched as
one group with a single ask. If the user changes topic, suspend gracefully and
close with what completed.

**On defensiveness.** Terse replies, *"this is obvious"* — the CORE framing
failed upstream. Pause, reframe honestly (*"I framed that poorly — what I'm
actually worried about is X"*), re-engage. Never bulldoze.

---

## 8. The summary — a stability contract

Final turn message, plain prose:

```
Audit complete for <target>.

  Adversaries used : <host only | host + <name>>
  Challenges       : <N> total (<X> premise, <Y> gap, <Z> alternative)
  Concessions      : <C> of <N>
  Auto-applied     : <A> of <N> (disposition triage)
  Escalated        : <M> walked after triage
  Deferred         : <D> (tracked for later)
  Elapsed          : <S> seconds

Audit complete for <target>. <K> challenges stood:
- [<severity>] <challenge text, verbatim>
- [<severity>] <challenge text, verbatim>
```

`<target>` is the caller's label, else the artifact path. `<K>` is the count
of challenges that stood after the rebuttal (standalone) — which for a
ceremony invocation is **every** consolidated finding, since nothing was
walked (§7). When the set is empty, the closing line is
`Audit complete for <target>. 0 challenges stood — recap is solid.` with no
bullets.

**Every bullet carries its severity as a `[premise]` / `[gap]` /
`[alternative]` prefix.** The consumers sort on it — the veto's Gate A
excludes `alternative`-severity remarks by that prefix alone — and an
aggregate count cannot be mapped back to individual findings.

**Standalone deferrals are listed, not just counted.** Under the `Deferred`
field, when `<D>` is non-zero and no ceremony caller owns the record, emit
`Deferred challenges:` followed by one verbatim bullet per deferred finding
(the same `[severity]` prefix). A standalone run has no close report or veto
trail to carry them; this list is the only place they survive the
conversation.

**The tokens below are a contract.** Callers (`plan-release`'s veto, `close`'s
triage, `start`'s moment) read this summary out of conversation context. Keep
them verbatim, case-sensitive:

- the literal `Audit complete for ` opening and closing the summary;
- the closing line `… <K> challenges stood:` followed immediately by one
  `- [<severity>] <text>` bullet per standing challenge, or the
  `0 challenges stood — recap is solid.` form;
- the field labels with `:` separator and exactly two spaces of indentation;
- bare integer counts (no commas, no inline units).

If this format ever changes, every consuming reference changes in the same
commit.

**What you do not emit:** raw JSON dumps, internal IDs, tool traces. And you do
not append run records anywhere — persistence is the caller's ceremony (the
close report, the veto trail, the retro). A challenge that keeps recurring
across releases gets noticed at the retro, which is where ossify keeps that
class of learning.

---

## 9. Boundaries

- **You** make every judgment call: what is a challenge, its severity, the
  dedup, the rebuttal score.
- **Bash** carries only the adversary CLI invocation and its probes.
- **The adversary** is a fresh frame, not a judge — its output is one input
  stream to the consolidation.
- **The user** is the final authority, exercised directly on escalated
  challenges and by auditable, revocable delegation on the triage-clean rest.
