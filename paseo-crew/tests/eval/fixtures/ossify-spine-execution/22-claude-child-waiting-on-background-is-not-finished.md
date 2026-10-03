---
scenario_id: 22-claude-child-waiting-on-background-is-not-finished
expected_outcome: proceed
expected_reason: 'The finish notice is a hint, never the finish. `paseo-mechanics.md`''s
  Completion section is explicit: a change that meets the `report` exit is handled as
  `report`, once, whichever of the notice, the heartbeat and the wait reaches it first;
  otherwise, do nothing — the wait is still armed. Here `w1-report.md`''s hash and identity are
  unchanged from what was noted before the dispatch, so there is no new report: the
  notice names nothing to act on, and the correct move at notice time is silence. The
  armed wait is left exactly as it is — not killed, not re-armed, not joined by a second
  wait, which would give the seat two waiters — and the seat''s words are not acted on
  here, because a seat''s message is read only on an attention exit. When that wait
  later exits `idle` (continuous idle past `SETTLE_WINDOW` with no report), the spine
  session reads the seat''s last message; "Waiting on wave 1''s three invokes" is a seat
  reporting on ITS OWN background work, which is exactly the false-wake case Completion
  names — a false wake, not a finish — and only then does it arm one fresh wait with the
  `idle` exit dropped for the rest of this dispatch, so `report`, `permission`, `error`
  and `budget` remain live but a further `idle` on this same seat cannot end the
  dispatch again. The round does not advance: the item is not accepted, no verifier is
  created, and the spine session''s own run.json record for this item is untouched. The
  wrong answers this fixture falsifies are: reading the notice itself as the item''s
  completion and advancing the round or creating the verifier; arming a second wait at
  notice time, idle-dropped or not, beside the one still armed; pinging the operator as
  though the seat had stalled, when nothing here indicates a stall — the seat spoke, on
  time, about live work; and, at the `idle` exit, re-arming an identical wait that still
  exits on the next `idle`, which reproduces exactly the false-wake gap the observed
  instance recorded (implementer `422ed5d2`, a `claude-ollama` seat: "Waiting on wave
  1''s three invokes." at 16:43:33, its real finish at 16:51:55, and no attention paid
  until an 18:11:07 operator ping — a 1h19m gap the dropped-`idle` re-arm exists to
  close)'
---

You are the spine session for `r18.s1` ("invoice batch"), with the `run.json`
you own. Round 1's `r18.s1.w1` implementer seat is a Claude-harness child on a
`claude-ollama` profile. You dispatched it with one background wait armed,
having noted `REPORT_PATH=/runs/r18.s1/w1-report.md`'s hash and identity
before the send.

At 16:43:33 the seat's turn ends with the message: *"Waiting on wave 1's
three invokes."* — it has kicked off background work of its own and is
reporting on that, not on the item. Paseo's one-shot finish notice fires at
once (the seat's first idle after running) and arrives as
`<paseo-system>Agent 422ed5d2 finished …</paseo-system>`.

You check `w1-report.md`: its hash and identity are exactly what you noted
before the dispatch — nothing new has been written. The seat's actual
background work will not finish until 16:51:55, and nothing about this item
will draw attention again until an operator ping at 18:11:07, if the notice
that just arrived is trusted as the finish.

State what the notice does and does not tell you, what you do about the wait
you have armed on this seat, and whether you advance the round. Then state
what happens when that wait next exits, and how any wait you arm then differs
from the one you would arm on an ordinary seat that had not said anything like
this.
