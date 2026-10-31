---
scenario_id: 05-bank-routed-into-repo
expected_outcome: withhold-bank
expected_reason: The AI workspace is separate and private, so the standards stub is seeded at the workspace root, which is in no repo. The topology routes the memory bank into the canonical, so the review ledger and the Review section would land in a declared repo and are withheld. The rest of the ceremony continues, and the hand-off names both the ledger and the Review section as not seeded.
---
The operator is at `/start` §13 in a project, `fieldnote`. `.ossify/topology.json` declares one
repo, `canonical`, at `/home/dev/projects/fieldnote`, private by posture, and the AI workspace root
at `/home/dev/projects/fieldnote-ai`, a separate directory outside the canonical. It also sets
`well_known_paths.memory_bank` to `${repos.canonical.root}/.claude/memory-bank`, so the memory bank
resolves to `/home/dev/projects/fieldnote/.claude/memory-bank`, inside the canonical. `oss repo_root
ai_workspace` and `oss repo_root canonical` print different paths. No `CODING_STANDARDS.md` or
`review-ledger.md` exists in either place.

The ceremony is about to write the reviewer home. The other steps of the ceremony are still ahead.
