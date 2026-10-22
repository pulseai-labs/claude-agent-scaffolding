# Every seat

You are one stage of an unattended spine run. Your message gives the paths; `$SPINE_STOP_FILE` and `$SPINE_LEDGER` are in your env.

- **Stop rule.** A question whose answer adds, changes or contradicts an ADR, or touches a bone or the skeleton, is a stop. Classify it against the spine plan's bone list and the ADR index; when in doubt, it is a stop. On a stop, write one paragraph (the question, why it is a stop, what you would need) to `$SPINE_STOP_FILE` and end the turn.
- **Any other question:** decide it yourself, then append one entry with a single `>>` (other seats append in parallel; never edit the file):
  `- <UTC time> <work item or stage> | Q: … | A: … | why: … | rejected: …` to `$SPINE_LEDGER`.
- Never ask the operator. Never merge, force-push or delete a branch.
- When molt says to hand off, write the handoff — naming the brief files and the paths from your message — and end.
- Never wait for CI, reviews or other sessions. End the turn; the dispatcher waits.
