---
name: domain-modeling
description: Build and sharpen a project's domain model as you design. Use when discussing what a codebase's terms actually mean, when a term is fuzzy or overloaded, when writing or editing a CONTEXT.md glossary, or when an architecture decision is worth recording as an ADR — which this skill composes and hands to whoever owns the ADR directory rather than filing itself. Triggers on "what do we call this", "that term is overloaded", "add this to the glossary", "write a CONTEXT.md", "should this be an ADR", "record this decision", "domain model", "ubiquitous language".
---

# Domain modeling

Actively build and sharpen the project's domain model while you design: challenge terms,
invent edge-case scenarios, and write the glossary and the decisions down the moment they
crystallise.

This is the *active* discipline. Merely reading `CONTEXT.md` to pick up the right nouns is
not this skill — that is a one-line habit any skill can have. This skill is for when you are
**changing** the model, not consuming it.

## Where the model lives

Most repos have a single context:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

A `CONTEXT-MAP.md` at the root means the repo has more than one context; the map says where
each lives and how they relate:

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                    ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/            ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

**Create `CONTEXT.md` lazily** — only when there is something to write, i.e. when the first
term is resolved. Do not scaffold empty structure.

**`docs/adr/` is different: this skill does not create it and does not write into it.** See
`references/adr-format.md`.

**Projects whose vocabulary already has an owner.** Some lifecycles assign domain terms an
owner that is not a glossary file — a journey map, the ADR whose decision defines the term, a
document regenerated from a spec. Where that is so, `CONTEXT.md` is not where the definition
belongs, and writing into the owner's document is either a mutation of state this skill does
not own or an edit the next regeneration silently discards.

**So point and hand off.** Name the owner, hand the resolved term over, and let the owner
record it. Do not write into it, and do not create a competing `CONTEXT.md` beside it. This
skill writes `CONTEXT.md` only where nothing else owns the project's vocabulary — the same
rule `references/adr-format.md` applies to `docs/adr/`, for the same reason.

## During a session

**Challenge against the glossary.** When a term conflicts with the language already recorded,
say so immediately. *"Your glossary defines cancellation as X, but you seem to mean Y. Which
is it?"*

**Sharpen fuzzy language.** When a word is vague or carries two meanings, propose the precise
one. *"You're saying account — do you mean the Customer or the User? Those are different
things."*

**Discuss concrete scenarios.** When domain relationships are on the table, stress-test them
with specific cases. Invent scenarios that probe the edges and force precision about where
one concept stops and the next begins.

**Cross-reference with the code.** When the user states how something works, check whether
the code agrees. Surface any contradiction. *"Your code cancels whole Orders, but you just
said partial cancellation is possible. Which is right?"*

**Update the glossary inline.** When a term is resolved, write it down right then. Do not
batch these up — a batch is a list of things you will paraphrase later from memory. The
format is in `references/context-format.md`.

`CONTEXT.md` must be **totally devoid of implementation details**. It is not a spec, not a
scratch pad, and not a home for implementation decisions. It is a glossary and nothing else.

## Offering ADRs

**`references/adr-format.md` is the contract** — when an ADR is worth offering, the format,
who owns the directory, why, and the destination rule. Read it before offering one. There is
no direct-write variant in it: this skill composes and hands off every ADR, including when
asked outright to file one, because it cannot create a numbered file atomically and a
non-atomic write into a directory another tool is numbering loses silently.

It is genuinely not restated here, and the qualifying conditions least of all. A second copy
of a three-part test drifts one gloss at a time until the two copies disagree about what
qualifies, while the file carrying the copy still claims it holds none.

**This skill composes ADRs; it does not file them.**

**A recorded ADR is not re-litigated.** Once a decision is written down, a later review does
not get to re-open it as though it were never made. Surface a conflict with an ADR only when
the friction is real enough to be worth reopening the decision, and say plainly that that is
what you are doing.
