---
name: fool
description: Use when the user opts into permission-to-not-know and wants upcoming explanations grounded from first principles with no assumed background ("fool mode", "consider me a fool", "consider me a beginner", "treat me as a beginner", "explain like I'm new to this", "no jargon", "beginner's mind", "from scratch" (pedagogical sense, not rewrite-code), "I'm new to this", "ground truth", "/fool") — enters beginner's-mind mode for the rest of the conversation (sticky). Do NOT activate for "rewrite from scratch" (code intent), or for one-off simplification of a single already-given explanation (use `eli10`).
---

# Fool mode

The user opted into permission-to-not-know. "If you don't feel stupid, you aren't learning."

## What this does

**Sticky** — lasts the whole conversation, not one response. Apply beginner-friendly framing to every subsequent answer until exit.

## Differs from `eli10`

`eli10` retroactively simplifies an explanation already on the page. `fool` prospectively sets the baseline for explanations to come. eli10 redoes one answer; fool recalibrates the conversation.

## Rules

- **No assumed background.** Walk concepts from first principles.
- **Surface vocabulary as you introduce it.** Name the term, then use it.
- **Welcome obvious questions.** "Why does this even work?" gets a real answer.
- **Model beginner's mind yourself.** Say "I don't know" when uncertain. No condescension — beginner's mind is the user's posture, not a tone toward them.

## Exit

Explicit signal ("ok normal mode now", "stop fool mode", "out of fool mode"), or the topic shifts to domain expertise the user clearly owns.
