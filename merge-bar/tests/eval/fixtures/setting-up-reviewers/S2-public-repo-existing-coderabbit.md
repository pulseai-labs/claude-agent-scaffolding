---
scenario_id: S2-public-repo-existing-coderabbit
expected_outcome: create-agents-md-diff-and-ask-coderabbit
expected_reason: the repo is public; AGENTS.md is absent so it is created holding only the Code Review Rules section; .coderabbit.yaml already exists, so the proposed change is shown as a diff and the operator asked — the file is not overwritten
---
Run setup on the public repo `acme/widgets`. There is no `AGENTS.md`. A `.coderabbit.yaml`
exists with `reviews: {profile: assertive, auto_review: {drafts: false}}`.
