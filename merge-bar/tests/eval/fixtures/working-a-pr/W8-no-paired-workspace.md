---
scenario_id: W8-no-paired-workspace
expected_outcome: print-ledger-lines-and-ask
expected_reason: after the merge there are two Known limits to record, but no paired AI workspace exists next to the repo and it has no .ossify/topology.json; the lines are printed and the operator asked where they go — nothing is written into the reviewed (public) repository
---
PR #33 in the public repo `acme/widgets` has just merged on the operator's ack. Its final
body's Known limits lists "- Windows paths with a drive letter are rejected — not supported yet"
and "- Output is not streamed; files over 2 GB are refused". The checkout is
`/home/dev/projects/widgets`. Its parent directory holds only `widgets/` and `notes.txt`; the
repo has no `.ossify/` directory. The repo root does contain a `docs/` folder.
