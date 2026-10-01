---
scenario_id: 04-own-idea-no-consumer-refused
expected_outcome: refuse-route-to-feature-map
expected_reason: A CSV export nobody asked for is new scope with no defect behind it and no requesting project, so it is not a patch. /ossify:patch refuses it and routes it to the feature map at the next /ossify:plan-release; a request from another project would have gone to the intake queue instead. No branch, no version bump, no PR, and nothing added to the running spine.
---
PulseDB (`pulseai-labs/PulseDB`, default branch `main`), release r3 open, spine
r3.s1 mid-round, main checkout on `main` and clean. There is no issue for this.
No other project has asked for it, and nothing that shipped is broken.

The operator says: "/ossify:patch — add a CSV export command to the CLI. Nobody's
asked for it, but it'd be handy."
