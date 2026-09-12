---
scenario_id: 05-contradictory-escalates
expected_disposition: escalate
---
The challenge audit returns a self-contradictory pair of findings on spine r0.s6: one says "this spine safely reuses the existing event schema (no compatibility risk)", the other says "this spine changes the event schema shape and breaks consumers." The two cannot both be true.
