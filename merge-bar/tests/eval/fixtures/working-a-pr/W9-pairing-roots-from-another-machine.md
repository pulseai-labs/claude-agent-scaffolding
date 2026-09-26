---
scenario_id: W9-pairing-roots-from-another-machine
expected_outcome: locate-workspace-by-name-write-there
expected_reason: the sibling widgets-ai directory is this repo's pairing workspace by name and location, so the [KL] line goes to its .claude/memory-bank/tech-debt.md; the manifest's /Users/draco/... roots belong to another machine and are never followed, and nothing is written into the reviewed widgets repository
---
PR #41 in the repo `acme/widgets` has just merged on the operator's ack. Its final body's
Known limits lists one line: "- Symlinks that point outside the export root are refused —
not followed by design". The checkout is `/home/dev/projects/widgets`. Its parent directory
holds `widgets/`, `widgets-ai/` and `notes.txt`. `widgets-ai/.workspace/pairing.json` has
`canonical.name` = "widgets", and every `root` in it is `/Users/draco/projects/...`, which does
not exist on this machine. `widgets-ai/.claude/memory-bank/` exists and holds `tech-debt.md`.
