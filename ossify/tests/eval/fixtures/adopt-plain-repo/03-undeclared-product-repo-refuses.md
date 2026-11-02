---
scenario_id: 03-undeclared-product-repo-refuses
expected_outcome: refuse-undeclared-repo
expected_reason: A topology already resolves (a /pair-workspace workspace declaring only `canonical`), but the operator says the product also lives in `/home/dev/projects/ledger-web`, which the declaration does not name. A1 refuses and names the fix in the pairing manifest's spelling (a top-level {"root": "<absolute path>"} entry under a fresh key); it does not edit a declaration it did not write and does not run on with the repo left out.
---
The operator typed `/ossify:adopt` in `/home/dev/projects/ledger-ai`. Its
`.workspace/pairing.json` declares `canonical` at `/home/dev/projects/ledger`
(Go service, 40 commits). The skill asked which repos hold the product; the
operator answered: "`ledger`, and the front end `ledger-web` — a React app with
its own 22 commits, in `/home/dev/projects/ledger-web`." `ledger-web` is in no
declaration. There is no scaffold-dev stack.

The ceremony is at A1.
