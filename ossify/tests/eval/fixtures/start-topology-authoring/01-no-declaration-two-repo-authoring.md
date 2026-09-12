---
scenario_id: 01-no-declaration-two-repo-authoring
expected_outcome: author-and-proceed
expected_reason: the probe refuses, the refusal is printed verbatim, the topology file is authored with both named repos, and the re-probe resolves for both before the ceremony continues
---
A fresh AI workspace is running `/start` for the first time. Walking up from
the workspace root finds neither `.ossify/topology.json` nor
`.workspace/pairing.json` anywhere on the path, so `oss state_path` refuses at
rc 2.

The operator is at the pre-flight step (§3), immediately before the
journey-map/product-vision station, and has already told the assistant that
the product spans two repositories: `svc-billing` at the absolute path
`/Users/ops/repos/svc-billing`, and `web-console` at the absolute path
`/Users/ops/repos/web-console`. Neither repo is named `canonical`.
