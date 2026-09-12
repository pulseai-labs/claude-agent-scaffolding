# Deep review rubric

The eight standards, the questions to ask, what to escalate, what to recommend, and how to
write it. Applied on top of the baseline in `SKILL.md`.

## The eight standards

### 0. Be ambitious about structural simplification

- Do not stop at "this could be a bit cleaner."
- Look for opportunities to reframe the change so that whole branches, helpers, modes,
  conditionals, or layers disappear entirely.
- Prefer the solution that makes the code feel inevitable in hindsight.
- Assume there is often a **code-judo** move available: a re-organization that uses the
  existing architecture more effectively and makes the change dramatically simpler and more
  elegant.
- If you see a path to *deleting* complexity rather than rearranging it, push hard for that
  path.

### 1. Do not let a change push a file from under 1000 lines to over 1000 lines without a very strong reason

- Treat this as a strong code-quality smell by default.
- Prefer extracting helpers, subcomponents, modules, or local abstractions instead of letting
  a file sprawl past 1000 lines.
- If the diff crosses that threshold, explicitly ask whether the code should be decomposed
  first.
- Waive it only where there is a compelling structural reason **and** the resulting file is
  still clearly organized.

### 2. Do not allow random spaghetti growth in existing code

- Be highly suspicious of new ad-hoc conditionals, scattered special cases, or one-off
  branches inserted into unrelated flows.
- If a change adds weird `if` statements in random places, that is a design problem, not a
  stylistic nit.
- Prefer pushing the logic into a dedicated abstraction, helper, state machine, policy
  object, or separate module instead of tangling an existing path.
- Call out changes that make the surrounding code harder to reason about, even when they
  technically work.

### 3. Bias toward cleaning the design, not just accepting working code

- If behaviour can stay the same while the structure becomes meaningfully cleaner, push for
  the cleaner version.
- Do not rubber-stamp "it works" implementations that leave the codebase messier.
- Strongly prefer simplifications that remove moving pieces altogether over refactors that
  merely spread the same complexity around.

### 4. Prefer direct, boring, maintainable code over hacky or magical code

- Treat brittle, ad-hoc, or magic behaviour as a code-quality problem.
- Be skeptical of generic mechanisms that hide simple data-shape assumptions.
- Flag thin abstractions, identity wrappers, and pass-through helpers that add indirection
  without buying clarity.

### 5. Push hard on type and boundary cleanliness where it affects maintainability

- Question unnecessary optionality, and the language's escape hatches — `any`, `unknown`,
  casts, untyped maps, dynamic attribute access — where a clearer type boundary could exist
  instead.
- Prefer explicit typed models or shared contracts over loosely-shaped ad-hoc objects.
- If a branch relies on a silent fallback to paper over an unclear invariant, ask whether the
  boundary should be made explicit instead.

### 6. Keep logic in the canonical layer, and reuse existing helpers

- Call out feature logic leaking into shared paths, and implementation details leaking
  through interfaces.
- Prefer the existing canonical utility or helper over a bespoke one-off.
- Push code toward the right package, service, or module rather than normalizing
  architectural drift.

### 7. Treat unnecessary sequential orchestration and non-atomic updates as design smells, where the cleaner structure is obvious

- If independent work is serialized for no good reason, ask whether the flow should run in
  parallel instead.
- If related updates can leave state half-applied, push for a more atomic structure.
- Do not over-index on micro-optimizations — but do flag avoidable orchestration complexity
  that makes the implementation more brittle.

## Primary review questions

Ask these of every meaningful change:

- Is there a code-judo move that would make this dramatically simpler?
- Can this change be reframed so fewer concepts, branches, or helper layers are needed?
- Does this improve or worsen the local architecture?
- Did the diff add branching complexity where a better abstraction should exist?
- Did a previously cohesive module become more coupled, more stateful, or harder to scan?
- Is this logic living in the right file and layer?
- Did this change enlarge a file or component past a healthy size boundary?
- Are there repeated conditionals that signal a missing model or a missing helper?
- Is the implementation direct and legible, or does it rely on special cases and incidental
  control flow?
- Is this abstraction actually earning its keep, or is it just a wrapper?
- Did the diff introduce casts, optionality, or ad-hoc object shapes that obscure the real
  invariant?
- Is this logic in the canonical layer, or did the diff leak details across a boundary?
- Is this orchestration more sequential, or less atomic, than it needs to be?

## What to flag aggressively

Escalate when you see:

- A complicated implementation where a cleaner reframing could delete whole categories of
  complexity.
- Refactors that move code around but fail to reduce the number of concepts a reader must
  hold in their head.
- A file crossing 1000 lines because of this change, especially where the new code could be
  split out.
- New conditionals bolted onto unrelated code paths.
- One-off booleans, nullable modes, or flags that complicate existing control flow.
- Feature-specific logic leaking into general-purpose modules.
- Generic "magic" handling that hides simple structure and makes the code harder to reason
  about.
- Thin wrappers or identity abstractions that add indirection without simplifying anything.
- Unnecessary casts, escape hatches, or optional parameters that muddy the real contract.
- Copy-pasted logic instead of an extracted helper.
- Narrow edge-case handling implemented in the middle of an already busy function.
- Refactors that technically pass tests but leave the code less modular or less readable.
- "Temporary" branching that is likely to become permanent debt.
- Bespoke helpers where the codebase already has a canonical utility for the job.
- Logic added in the wrong layer or package, when it should live somewhere more central.
- Sequential async flow where obviously independent work would be simpler and clearer run in
  parallel.
- Partial-update logic that leaves state less atomic than it needs to be.

## Preferred remedies

When you identify a problem, prefer recommendations of this shape:

- Delete a whole layer of indirection rather than polishing it.
- Reframe the state model so the conditionals disappear instead of being centralized.
- Change the ownership boundary so the feature becomes a natural extension of an existing
  abstraction.
- Turn special-case logic into a simpler default flow with fewer exceptions.
- Extract a helper or a pure function.
- Split a large file into smaller focused modules.
- Move feature-specific logic behind a dedicated abstraction.
- Replace condition chains with a typed model or an explicit dispatcher.
- Separate orchestration from business logic.
- Collapse duplicate branches into a single clearer flow.
- Delete wrappers that do not meaningfully clarify the interface.
- Reuse the existing canonical helper instead of introducing a near-duplicate.
- Make type boundaries explicit, so the control flow gets simpler.
- Move the logic to the package, module, or layer that already owns the concept.
- Parallelize independent work, where that also simplifies the orchestration.
- Restructure related updates into a more atomic flow, where partial state would be harder to
  reason about.

**Do not be satisfied with "maybe rename this" feedback when the real issue is structural.**

**Do not be satisfied with a merely cleaner version of the same messy idea, when there is a
plausible path to a much simpler idea.**

## Tone

Be direct, serious, and demanding about quality. Do not be rude, but do not soften a major
maintainability issue into a mild suggestion. If the code is making the codebase messier, say
so clearly. If the implementation missed an opportunity for a dramatic simplification, say
that clearly too.

Phrases that carry the right register:

- `this pushes the file past 1k lines. can we decompose this first?`
- `this adds another special-case branch into an already busy flow. can we move this behind its own abstraction?`
- `this works, but it makes the surrounding code more spaghetti. let's keep the behavior and restructure the implementation.`
- `this feels like feature logic leaking into a shared path. can we isolate it?`
- `this abstraction seems unnecessary. can we just keep the direct flow?`
- `why does this need a cast / optional here? can we make the boundary more explicit instead?`
- `this looks like a bespoke helper for something we already have elsewhere. can we reuse the canonical one?`
- `i think there's a code-judo move here that makes this much simpler. can we reframe this so these branches disappear?`
- `this refactor moves complexity around, but doesn't really delete it. is there a way to make the model itself simpler?`
