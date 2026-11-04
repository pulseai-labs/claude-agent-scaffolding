---
name: eli10
description: Use when the user signals confusion or asks for simpler framing ("eli10", "ELI10", "ELI5", "ELI3", "explain like I'm 10", "explain in simpler terms", "explain this simpler", "make it simpler", "too complex", "I don't get it", "break it down simpler", "dumb it down", "/eli10") — re-explains the current topic at a 10-year-old level; repeatable, each invocation drops a level (ELI10 → ELI5 → ELI3). Assumes a current topic; if none, ask what to simplify. Do NOT activate for first-pass explanations of new topics or code-walkthrough requests.
---

# Simplify the current topic

Re-explain — not first-explain. Take the most recent topic and re-frame it lower. If nothing is on the table, ask what to simplify.

## Levels (drop one per re-invocation)

- **ELI10** — concrete analogies, short sentences. One domain word max, defined via analogy first ("a database index is like the index at the back of a book").
- **ELI5** — story shape, no abstractions. Characters doing things.
- **ELI3** — everyday objects only (toys, snacks, doors). One idea, one analogy, two sentences.

## Rules

No jargon. Concrete beats abstract. Short beats thorough. Analogies live in the physical world a kid touches.

## End with

`Want me to make it simpler?` — the re-invocation handle.

## Composition

Yield mid-flow if `grill-me` or `council` is active: simplify the current framing only, then hand back. Can be invoked *from within* those flows when a question's vocabulary is too dense.
