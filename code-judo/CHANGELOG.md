# Changelog

All notable changes to the `code-judo` plugin.

## 0.2.1

- `design-it-twice` hands each parallel brief the vocabulary source the caller resolved under
  `domain-modeling`'s *Where the model lives*, not a hard-coded `CONTEXT.md` (#392). In a repo
  whose vocabulary has another owner (an ossify repo has no `CONTEXT.md`), every brief pointed
  at a file that does not exist.
- The frontmatter lint measures a description's parsed bytes, not its whitespace-flattened copy,
  so a long literal block can no longer pass the 1024-byte cap (#390); a parser that exits
  non-zero is a lint failure instead of empty facts that a command passed (#404); kebab-case is
  checked against an explicit ASCII class, not a locale range (#404).
- A fixture suite, `tests/test-frontmatter-lint-fixtures.sh`, runs the lint on small plugin
  trees so its failure branches run in CI: the over-cap literal, an unreadable file, invalid
  UTF-8, non-ASCII and upper-case names, a whitespace-only description, and the human-only
  branch (#404). #404's parity test against orca-crew's copy no longer applies: orca-crew was
  retired (#729).

## 0.2.0

OMP marketplace surface.

- Wrappers name the skill by `skill://` path as well as `${CLAUDE_PLUGIN_ROOT}`; skill descriptions lead with the trigger ("Use when ...") so OMP's skill match fires; Claude Code tool names carry an OMP alias where a skill names one; the README gains an OMP note. No Claude Code-only parts.

## 0.1.1

- `domain-modeling`'s ADR-format reference no longer names `scaffold-dev`'s ADR skill as an owner of
  `docs/adr/`; `scaffold-dev` left the marketplace. ossify's ceremonies remain the named owner.

## 0.1.0

Initial release. Four prose skills, no runtime library.

- `deep-review` — strict maintainability review of a diff or branch. Ports the upstream
  standards, review questions, escalation list, preferred remedies, tone, prioritized output
  order, approval bar, and presumptive blockers. Human-invoked only.
- `deepen-architecture` — proactive codebase scan for deepening opportunities, rendered as a
  single HTML report in the OS temp directory and opened in the browser. Human-invoked
  only.
- `codebase-design` — the deep-module vocabulary and principles, plus the dependency
  categories, seam discipline, and the design-it-twice parallel pattern.
- `domain-modeling` — `CONTEXT.md` glossary discipline and ADR authoring, both handed off
  where another lifecycle already owns them.

Invocation posture is declared on both surfaces, because they read different files:
`disable-model-invocation: true` in SKILL.md frontmatter for Claude Code, and
`policy.allow_implicit_invocation: false` in `skills/*/agents/openai.yaml` for Codex, which
does not read the frontmatter field. The lint asserts the two agree, in both directions.

**Deliberate departures from upstream — this list is canonical; no other file restates it.**

1. `deep-review` produces one report and one categorical disposition pass and never loops,
   and its verdict is advisory rather than a merge gate.
2. The cross-skill dependency web is internalized, with the grilling step resolving softly to
   `ossify:challenge`, then `ai-mentor:grill-me`, then an in-plugin protocol.
3. `deepen-architecture` reads path-bearing history (`git log --name-only`) for its hot-spot
   scan. Upstream specifies `--oneline`, which prints commit subjects and no file names, so it
   cannot answer the question it is asked. The requirement is ported; the command is corrected.
4. `domain-modeling` **composes** ADRs but does not file them — it names the destination and
   hands off. Upstream writes the file and mints the number by scanning the directory. An ADR
   directory is a numbered sequence with one owner, and in these repos something else already
   owns it (ossify's ceremonies, and `scaffold-dev`'s ADR skill), so two tools scanning for
   "the next number" collide silently. The guarantee is that the skill's flow never mutates a
   shared sequence at all — there is no direct-write variant, because filing safely means
   creating the numbered file atomically and a prose skill cannot, so a read-then-write loses
   silently to whatever else is numbering the directory. The same rule governs the glossary: upstream writes `CONTEXT.md` unconditionally, and this
   plugin writes it only where nothing else owns the project's vocabulary — where a lifecycle
   already assigns terms an owner, it names the owner and hands the term over.

Adopts the marketplace recommend-by-default convention
(`docs/conventions/recommendation-policy.md`) for the grilling loop, shipped as a
byte-identical copy at `skills/deepen-architecture/references/recommendation-policy.md` and
guarded by the repo-root parity test `tests/test-recommendation-policy-parity.sh`.
`references/grilling.md` carries only how the policy renders on this surface.

Deferred to a later release: the OpenCode adapter surface, eval fixtures for the two review
skills, and the upstream security/correctness review axis. Tracked on #382.
