# ADR format

## This skill does not write the file

**Compose the ADR, name where it belongs, and hand it off.** Do not create the file, do not
scan for the next number, and do not create the ADR directory. This holds however the request
arrives, including a direct instruction to write it — see below for why there is no exception.

The reason is shared mutable state. An ADR directory is a **sequence**, and a sequence has
exactly one owner. In the repos this plugin is built for, something else already owns it:
ossify's ceremonies author into `docs/adr/`, and so does `scaffold-dev`'s ADR skill. Two
tools scanning the same directory for "the highest existing number" will both find the same
answer and both write it, and the collision is silent — two ADR-0007s, discovered months
later by someone trying to cite one.

So the flow is:

1. **Compose the content** — title and the one-to-three sentences, in the format below.
2. **Name the destination.** Single context: `docs/adr/`. A repo with a `CONTEXT-MAP.md`: the
   context's own `docs/adr/`, with the root reserved for decisions that bind more than one
   context or none. If it is genuinely unclear which context owns the decision, ask — do not
   pick one, because a decision filed in the wrong context is a decision nobody finds.
3. **Hand it to whoever owns the sequence.** In an ossify repo, say which ceremony files it;
   that path registers the decision properly rather than just leaving a file behind. Where
   nothing owns the directory, hand the composed ADR to the user and say where to put it.

**This skill never files an ADR — not on its own initiative, and not on request.** If the user
reads the composed ADR and asks you to write the file, say what you can do instead: hand them
the content and the destination, or hand it to whatever owns the sequence. That is not
pedantry about permissions. Filing safely means creating the numbered file *atomically*, and
this skill has no way to do that — a read-then-write, however careful, can be overtaken
between the two steps by the other tool numbering the same directory, and the loser is
overwritten silently. A guarantee that only holds when nothing else is running is not a
guarantee.

So there is no direct-write variant to fall back to. The composed ADR and its destination are
the deliverable.

## Template

```md
# {Short title of the decision}

{One to three sentences: what the context was, what was decided, and why.}
```

That is the whole thing. An ADR can be a single paragraph. The value is in recording *that*
a decision was made and *why*, not in filling out sections.

## Optional sections

Include these only when they add something. Most ADRs need none of them.

- **Status** frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`) —
  useful once decisions start being revisited.
- **Considered options** — only when the rejected alternatives are worth remembering.
- **Consequences** — only when a non-obvious downstream effect needs calling out.

## Numbering

**Not yours to assign.** Whoever owns the directory owns its sequence. When you hand off a
composed ADR, hand over the title and the body and let the owner number it.

Do not scan for the next free number even to *suggest* one. A number read now is stale the
moment another tool writes, and a suggested number that turns out to be taken is worse than no
suggestion — it reads as authoritative and gets used.

## When to offer an ADR

All three must hold:

1. **Hard to reverse** — changing your mind later carries meaningful cost.
2. **Surprising without context** — a future reader will look at the code and wonder why on
   earth it was done this way.
3. **The result of a real trade-off** — there were genuine alternatives and one was picked
   for specific reasons.

Miss any one and skip it.

## What qualifies

- **Architectural shape.** "We use a monorepo." "The write model is event-sourced; the read
  model is projected into Postgres."
- **Integration patterns between contexts.** "Ordering and Billing communicate by domain
  events, not synchronous HTTP."
- **Technology choices carrying lock-in.** Database, message bus, auth provider, deployment
  target. Not every library — the ones that would take a quarter to swap out.
- **Boundary and scope decisions.** "Customer data is owned by the Customer context; others
  reference it by id only." The explicit no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path.** "Manual SQL instead of an ORM, because X."
  Anything a reasonable reader would assume the opposite of. These are what stop the next
  engineer from "fixing" something that was deliberate.
- **Constraints not visible in the code.** "We cannot use that provider, for compliance
  reasons." "Responses must be under 200ms, because of the partner API contract."
- **Rejected alternatives, where the rejection is non-obvious.** If GraphQL was considered
  and REST chosen for subtle reasons, record it — otherwise someone proposes GraphQL again
  in six months.

## Recording a rejection

An ADR is also the right home for a *rejected* proposal, when the reason for rejecting it
would otherwise be lost and the same proposal would come back. Frame the offer to the user
plainly: *"Want me to record this as an ADR so future architecture reviews don't re-suggest
it?"*

Only offer when the reason is one a future explorer would actually need. Skip ephemeral
reasons ("not worth it right now") and self-evident ones — neither survives contact with the
next quarter, and an ADR full of them stops being read.
