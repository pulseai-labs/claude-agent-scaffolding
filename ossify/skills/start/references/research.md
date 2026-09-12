# Research

Depth for SKILL.md §9. This is what you read when spec-core hits a tech claim
that a smoke test cannot answer — not because the claim is hard to test, but
because it is not a *test-shaped* question. "Does this crate parse our file?"
is a smoke test. "Which of these three queue brokers survives our delivery
guarantees, and at what operational cost?" is research.

**The bone's soundness depends on facts you do not have.** A smoke test
verifies one claim by running 20-50 lines. Research answers a question by
reading — across official docs, specs, and source — and its output is a cited
file another reader can audit, not a green exit code.

---

## 1. When this file applies, and when it does not

**Read this when the question is one of:**

- **Comparison** — "which of these approaches fits our constraints?" No single
  script answers a ranking.
- **Behavioural fact beyond a script's reach** — rate limits, SLA terms, an
  auth flow's token lifetimes, a framework's concurrency model under load you
  cannot cheaply generate.
- **Constraint discovery** — "what does this API *not* let us do?" Absence
  does not show up in a passing test.

**Do not read this when** a 20-50 line isolated script can answer the claim —
that is `references/smoke-test-pass.md`, it is cheaper, and its answer is
stronger (a run beats a read). If you catch yourself researching a question a
script could settle, stop and write the script.

### Its neighbours

| | Answers | By |
|---|---|---|
| **Smoke test** (`smoke-test-pass.md`) | *"is this one claim true?"* | Running a throwaway script |
| **This file** | *"which facts govern this decision?"* | Reading primary sources, with citations |
| **Feasibility spike** (`spike-contract.md`) | *"can this architecture work at all?"* | Building a disposable falsifier |

Research often *precedes* a smoke test: the reading narrows three candidates
to one, and the script then verifies the survivor's load-bearing claim.

---

## 2. The discipline

1. **State the question so an answer could be wrong.** *"What are the real
   trade-offs between X and Y for our write pattern?"* — not *"look into X."*
   An unfalsifiable question produces a summary, not an answer.
2. **Read down the trust ladder, and stop at the lowest rung you needed:**
   official documentation → the RFC/spec itself → the source code → maintainer
   statements (issues, changelogs) → published benchmarks with method shown.
   **Blog aggregators and secondhand tutorials are not sources** — they are
   where stale claims go to look current. When a claim matters, trace it to
   the rung that owns it.
3. **Attach a confidence to every claim, and date it.** `verified` (read in
   the primary source, quoted), `probable` (consistent across two independent
   rungs), `unverified` (needed but not confirmed — say what would confirm
   it). An undated claim about a moving target is stale the day it is written.
4. **Record what would change the answer.** Version pins, pricing pages,
   rate-limit tables — name the thing that, if it shifts, reopens the
   question. This is the research file's revisit trigger, the same shape the
   bones registry uses.

---

## 3. The artifact

The output is a Markdown file in the **AI workspace** (process record, not
product): `docs/research/<question-slug>.md`. Structure:

- **Question** — one sentence, as posed.
- **Answer** — the decision-ready summary, first.
- **Claims** — one per bullet: the claim, the source (linked or pathed), the
  confidence, the date read.
- **Would reopen this** — the revisit conditions from §2.4.

The file cites inline so a reader can audit the chain without re-doing the
reading. **Research is dispatch-friendly**: the question and this contract are
the whole briefing, and the artifact is the whole return — a background agent
can run it while spec-core continues, and the bone conversation resumes when
the file lands.

---

## 4. How it feeds the bone

Research does not decide; the bone conversation does. The file's claims flow
into the ADR the same way §9's smoke-test outcomes do: load-bearing claims the
research **verified** go in the ADR's `### Verified claims` **with the
primary-source citation inline** — the ADR lives in a declared repo and must
stand alone for a reader who has no access to the AI workspace; cite the
research file as provenance, never as the only evidence. Claims still
**unverified** go in `### Unverified claims` with a revisit trigger. Silence is the defect, not the
uncertainty — an ADR resting on a fact nobody checked is how a bone rots
invisibly.

Time-box it. A question eating hours of reading without converging is usually
architectural uncertainty wearing a research costume — that is §9a's spike,
and building the falsifier will answer more than the next hour of reading.

---

## 5. Anti-patterns

- **Answering from memory without a source.** A model's recollection of an
  API is a rumour with good grammar. If no source was read, the claim is
  `unverified` — label it.
- **Aggregator laundering.** Citing a blog that cites a doc is citing the
  blog. Walk to the doc.
- **Confidence-free claims.** A file where every claim reads equally certain
  hides exactly the claim that will bite.
- **Research as procrastination.** The question was script-shaped, the script
  was 30 lines, and the reading took the afternoon.
- **Scope creep.** One question per file. The interesting tangent is a new
  question — name it and decide whether it earns its own reading.

---

*Prior art: mattpocock `research` (high-trust sources, cited Markdown,
background-capable). Lineage, not source — this doc is ossify's own.*
