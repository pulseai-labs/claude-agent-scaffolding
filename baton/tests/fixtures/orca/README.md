# Orca reply fixtures

The `--json` replies the Orca host is tested against (`tests/fake-orca` serves them).

- Recorded on draco-desk, Orca 1.4.238, 2026-10-26/27, against the `pilot-fourseat` repo.
- Token keys are redacted.
- Replies are pruned to the rows under test, so a `totalCount` may exceed the rows a reply holds.
- `*.edited.json` are hand edits of recorded replies; the tests make further edits of the same kind
  at run time, next to the replies they write.
- `repo-list.json` is hand-built in the live reply's shape.
- `terminal-read-omp-ask*.json` and `terminal-read-numbered-row3.json` were recorded on draco-desk on 2026-10-27 (omp v18.11.3) by the OpenBot-bridge spike; its record is the AI repo's `docs/superpowers/evidence/2026-10-27-openbot-bridge-spike/README.md`.
