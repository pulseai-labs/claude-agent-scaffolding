---
scenario_id: 01-fresh-dual-repo
expected_outcome: seed
expected_reason: Nothing is occupied. The skill writes CODING_STANDARDS.md to the AI workspace root, review-ledger.md to the memory bank, and a Review section into 08-governance.md. The stub has the header, pointers to the canonical CLAUDE.md Testing section and to 03-code-patterns.md (written although its machine-checkable rules section was seeded empty by this run, because crew's verifier reads the stub instead of that file), and the one-sentence current state. No entries, no TODO, nothing copied from CLAUDE.md, and no output lands in the canonical.
---
The operator is at `/start` §13 in a dual-repo project, `ledgerline`. The AI workspace is
`/home/dev/projects/ledgerline-ai` and the canonical, at `/home/dev/projects/ledgerline`, is
declared in `.ossify/topology.json` and is private. The canonical's `CLAUDE.md` exists and has a
"Testing" section (how to run the suite, never mock the database) and a "Branches" section. The
AI workspace holds no `CODING_STANDARDS.md`, and the memory bank at
`/home/dev/projects/ledgerline-ai/.claude/memory-bank/` holds nothing before this run. Earlier in
§13, this `/start` run authored the memory bank, including `03-code-patterns.md` with its
machine-checkable rules section seeded empty; those files are this run's own writes, not
existing files. There is no `review-ledger.md`. The crew file `.crew/roles.md` names the reviewer seat. The project uses
GitHub Actions and has no CodeRabbit.

§3's occupied-destinations check, run before `oss init`, found nothing at any destination. The
reviewer-home outputs are the remaining writes.
