---
scenario_id: 03-tooling-repo-skipped-control
expected_outcome: proceed-record-history
expected_reason: Negative control. The only repo with history and files is the one `.workspace/pairing.json` declares under `tooling_repo` (#553), so the gate skips it. The product repo has no commits and nothing at HEAD. The gate proceeds; no refusal and no adopt route.
---
The operator typed `/start` in `/home/dev/projects/ferrite-ai`, whose
`.workspace/pairing.json` declares `canonical` at `/home/dev/projects/ferrite`
and `tooling_repo` at `/home/dev/projects/ferrite-tools`. `ferrite` holds a
`.git` with no commits. `ferrite-tools` has 220 commits and a `scripts/`
directory of release tooling at `HEAD`.

The ceremony is at §3's canonical-content gate.
