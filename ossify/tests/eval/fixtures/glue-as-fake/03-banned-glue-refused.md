---
scenario_id: 03-banned-glue-refused
expected_outcome: refuse-banned-glue
expected_reason: Glue that turns any read error into an empty window hides the provider's failure signals, which is a banned fake whether or not it is glue. It is refused. The admissible alternative is glue that propagates errors; if none can be built, the request is a can't-fake request to PulseDB (/ossify:patch there), filed as a from:pulse-guard-ai issue. It is not a longer wait and not an unrecorded workaround.
---
pulse-guard-ai, release r2 open, spine r2.s3 ("anomaly windows") being planned.
PulseDB 0.8.2 has only `Db::get`. PulseDB issue #160, labelled
`from:pulse-guard-ai`, already requests batch reads.

The proposed glue: a `get_many` that loops over `Db::get` and, if any single get
returns an error, returns an empty `Vec` "so the window just has no data and the
detector moves on". The operator says: "Record it as a fake and move on —
/ossify:plan-spine r2.s3."
