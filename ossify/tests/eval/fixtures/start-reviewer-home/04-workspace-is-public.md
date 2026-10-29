---
scenario_id: 04-workspace-is-public
expected_outcome: refuse
expected_reason: The topology declares the AI workspace root equal to the root of the public canonical, so a standards file and a ledger written there would land in a public repo. The skill refuses to write the reviewer home, says why, and writes nothing, to the canonical or anywhere else.
---
The operator is at `/start` §13 in a project, `openlathe`, that kept its working notes in the same
repository as its code. `.ossify/topology.json` declares one repo, `canonical`, at
`/home/dev/projects/openlathe`, marked public by posture, and declares the AI workspace root at the
same path, `/home/dev/projects/openlathe`. `oss repo_root ai_workspace` and
`oss repo_root canonical` print the same path. No `CODING_STANDARDS.md` or `review-ledger.md`
exists there.

The ceremony is about to write the reviewer home.
