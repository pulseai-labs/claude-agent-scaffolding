# Changelog

## 0.2.0 — 2026-10-13

- Add the `implementer` agent: autoload ossify's `work-item`, stage changes, return JSON, never commit or push.
- Add the `reviewer` agent: read the brief and diff, write one report recording HEAD and correctness findings.
- `omp-seat` guards these children with seat-mods' verifier and reviewer profiles respectively.
