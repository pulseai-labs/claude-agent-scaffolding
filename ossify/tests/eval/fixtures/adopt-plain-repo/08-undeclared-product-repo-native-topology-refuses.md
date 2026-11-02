---
scenario_id: 08-undeclared-product-repo-native-topology-refuses
expected_outcome: refuse-undeclared-repo
expected_reason: A native .ossify/topology.json already resolves and declares only `api`, but the operator says the product also lives in `/home/dev/projects/shop-web`, which it does not name. A1 refuses and names the fix in the native spelling (a `.repos.<key>.root` entry), not a top-level {root} key, which a native topology ignores; it does not edit a declaration it did not write and does not run on with the repo left out.
---
The operator typed `/ossify:adopt` in `/home/dev/projects/shop-ai`. Its committed
`.ossify/topology.json` is `{"schema_version": 1, "repos": {"api": {"root":
"/home/dev/projects/shop-api"}}}` (a Node service, 64 commits). The skill asked
which repos hold the product; the operator answered: "`shop-api`, and the storefront
`shop-web` in `/home/dev/projects/shop-web` — a Vue app with 30 commits." `shop-web`
is in no declaration. There is no scaffold-dev stack.

The ceremony is at A1.
