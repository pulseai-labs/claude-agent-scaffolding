---
scenario_id: 03-no-project-docs
expected_outcome: seed
expected_reason: Nothing is occupied. The canonical has no CLAUDE.md, no style guide, and no other docs to point at, so the stub carries only the 03-code-patterns.md pointer (the file exists, seeded empty by this run, and crew's verifier reads the stub instead of it) and no 'no such docs yet' sentence. It still has the header and the one-sentence current state, no TODO, no empty rule heading, and no invented pointer to a file that does not exist.
---
The operator is at `/start` §13 in a dual-repo project, `quillbase`. The AI workspace is
`/home/dev/projects/quillbase-ai` and the private canonical is `/home/dev/projects/quillbase`.
The canonical holds a `README.md` and a `.git` and nothing else: no `CLAUDE.md`, no `AGENTS.md`,
no `docs/` directory. The memory bank, authored earlier in §13 by this run, seeded `03-code-patterns.md` with an empty
machine-checkable rules section. No `CODING_STANDARDS.md` or `review-ledger.md` exists. The
operator has told the ceremony the project has no CI review.

§3's occupied-destinations check found nothing. The ceremony is about to write the reviewer home.

The memory bank resolves to `/home/dev/projects/quillbase-ai/.claude/memory-bank`.
