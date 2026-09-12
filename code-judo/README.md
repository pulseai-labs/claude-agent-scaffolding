# code-judo

Strict quality review and architecture deepening. Four prose skills, no runtime library.

The name is the thesis. A **code-judo move** is a restructuring that uses the existing
architecture more effectively and makes a change dramatically simpler — one that *deletes*
complexity rather than rearranging it. Both review surfaces here are built to hunt for those,
not to collect nits.

## Skills

| Skill | Scope | What it does |
|---|---|---|
| `deep-review` | diff / branch | An unusually strict maintainability review. The code-judo ambition standard, the 1000-line rule, spaghetti-growth suspicion, wrapper/cast/boundary rules, prioritized output, and a categorical approval bar. **Human-invoked only.** |
| `deepen-architecture` | codebase | A proactive scan for deepening opportunities, presented as a single HTML report opened in your browser, then a grilling loop on the candidate you pick. **Human-invoked only.** |
| `codebase-design` | any | The design vocabulary the other two speak: module, interface, depth, seam, adapter, leverage, locality. The deletion test, "the interface is the test surface", seam discipline, and the design-it-twice pattern. |
| `domain-modeling` | any | The project's domain glossary (`CONTEXT.md`), written where nothing else owns the project's vocabulary. Adds terms as concepts get named and sharpens fuzzy ones in place. ADRs are different: it offers one only when a decision is hard to reverse, surprising, and a real trade-off, and then **composes it and hands it off** to whoever owns the ADR directory — it never files one itself, including on a direct request. |

## Commands

| Command | Skill |
|---|---|
| `/code-judo:deep-review [base-ref]` | `deep-review` |
| `/code-judo:deepen-architecture [direction]` | `deepen-architecture` |
| `/code-judo:codebase-design [module or question]` | `codebase-design` |
| `/code-judo:domain-modeling [term or decision]` | `domain-modeling` |

## What `deep-review` is not

It is not a correctness review and not a security review. This plugin looks for nothing about
bugs, breaking changes, or vulnerabilities, and ships nothing that does. That is a separate
review with separate questions, and mixing the two into one pass makes both worse. Run
whatever your project already uses for that axis — `claude-security-audit`, in this
marketplace, covers agent *configuration* rather than the product code under review.

It produces **one report and one disposition pass, and never re-reviews its own fixes.** A
second review is a new human decision. Its verdict is **advisory** and has two outcomes — the
bar is met, or "the bar is not met, because …" naming the clauses it fails. Either way it is
never a merge gate.

Why it is built that way, and how findings are sorted, is in
`skills/deep-review/references/disposition.md`. That file is the only place the reasoning is
written down; everywhere else states the rule and points here, because one rule in two files
drifts by construction.

## The report

`deepen-architecture` writes a single HTML file to the OS temp directory and opens it
in your browser, telling you the absolute path. Nothing lands in the repo and nothing is
published anywhere; the file may name private code and it stays on your machine. Rendering it
is not entirely local, though: Tailwind and Mermaid load from a CDN — pinned to exact versions
and checked against a subresource-integrity hash — so the report needs a network connection,
and opening it tells that CDN a report was rendered. Nothing from your repository is sent.

## Dependencies

None that are hard. The grilling step resolves softly: `ossify:challenge` when ossify is
installed, else `ai-mentor:grill-me` when present, else a complete grill protocol the plugin
carries itself. Nothing about correctness changes when neither is installed.

This plugin never runs `oss` verbs and never writes to another plugin's state.

## Lineage

Adapted, with thanks, from two upstreams:

- Cursor's `thermo-nuclear-code-quality-review` (`cursor/plugins`) — the review posture, the
  standards, the flags and remedies, the approval bar.
- Matt Pocock's `improve-codebase-architecture`, `codebase-design`, `domain-modeling`, and
  `grilling` (`mattpocock/skills`) — hot-spot scoping, the deletion test, the HTML report
  format, the grilling loop, and the ADR side effects.

Several things were deliberately changed rather than ported — the stopping discipline above is
one. `CHANGELOG.md` carries the canonical list of departures; issue #382 carries the full port
record, including what was knowingly left out and why. Neither is restated here, because a
count kept in two places is a count that drifts.
