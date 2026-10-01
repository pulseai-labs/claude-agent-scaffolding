---
scenario_id: 01-consumer-builds-glue
expected_outcome: glue-recorded-as-fake
expected_reason: pulse-guard-ai does not wait for PulseDB. It builds the looped-single-get glue behind SampleStore (errors propagated, so it is admissible) and files the batch-read request on PulseDB as an issue labelled from:pulse-guard-ai. It records the glue with fake_add channel fake; the reason names PulseDB and that issue; the trigger is "PulseDB <version or #issue> ships batch reads" (a condition, not a date); the expiry release is r3, the pulse-guard-ai release that must adopt it. It adds the fake-replacement feature entry.
---
pulse-guard-ai (`pulseai-labs/pulse-guard-ai`), release r2 open. Spine r2.s3
("anomaly windows") is being planned. It needs to read 500–2000 samples per
window. PulseDB 0.8.2, which pulse-guard-ai depends on, has only single-key
`Db::get`. PulseDB's maintainers intend batch reads "in a later release" with no
version or date. pulse-guard-ai has **not** filed a request on PulseDB.

The proposed glue: a `get_many` inside pulse-guard-ai's own `SampleStore` interface
that loops over `Db::get` and returns the first error it meets. The operator
states: "pulse-guard-ai must be on real batch reads by its r3."

The operator says: "We can't wait for PulseDB. /ossify:plan-spine r2.s3."
