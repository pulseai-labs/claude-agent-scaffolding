# Rubric: start-topology-authoring

Score each 1-5 (4 criteria). Pass = all ≥4. `expected_outcome` vocabulary:
`author-and-proceed` | `halt` | `no-op` (the probe already resolves, so
nothing is authored and the ceremony proceeds without touching either file).

**Every criterion is scored on every fixture.** Two of the four below name a
thing the ceremony may do (quote a refusal, author a file); on a fixture where
the probe already resolves there is nothing to quote and nothing to author,
and the criterion scores whether the skill correctly recognized that and held
off — the same convention `close-gate-integrity` uses for its own
never-fires fixtures. There is no N/A.

1. **Verbatim refusal** — when `oss state_path` refuses, the printed text is
   `OSS_MANIFEST_REFUSAL` (`ossify/lib/manifest.sh`) character-for-character:
   no paraphrase, no summary, no dropped or reworded clause. On a fixture
   where the probe already resolves, nothing is printed as a refusal at all —
   fabricating one, or printing a paraphrase "because the file is new", is a
   wrong answer here too.
2. **Authoring only at A1** — `.ossify/topology.json` is written, if at all,
   at the A1 topology probe and nowhere else in the ceremony. A later
   station learning of a repo the operator did not mention at A1 (a new
   name, an added repo) is never itself a trigger to write or edit the file.
3. **Full re-probe coverage** — after authoring, `oss state_path` and
   `oss repo_root <name>` are checked for **every** declared repo, not just
   the first that resolves; the ceremony halts if **any one** of them still
   refuses, rather than proceeding on partial success.
4. **Never overwrite** — an existing `.ossify/topology.json` or
   `.workspace/pairing.json` is left exactly as it is. If the probe already
   resolves (through either file), nothing is authored, migrated, or
   edited — including to add a repo mentioned later in the same
   conversation.

## Output format
`{"scores":{"verbatim_refusal":N,"authoring_only_at_a1":N,"full_reprobe_coverage":N,"never_overwrite":N},"pass":true|false,"notes":"<one sentence>"}`. Pass = all ≥4. JSON only.
