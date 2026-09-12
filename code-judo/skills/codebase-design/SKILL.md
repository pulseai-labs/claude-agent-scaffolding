---
name: codebase-design
description: Shared vocabulary and principles for designing deep modules. Use when designing or improving a module's interface, deciding where a seam goes, judging whether an abstraction earns its keep, making code more testable or easier for an agent to navigate, exploring two competing interfaces for the same problem, or when another skill needs the deep-module vocabulary. Triggers on "design this module", "where should the seam go", "is this abstraction earning its keep", "explain this codebase's seams", "design it twice", "deep module", "shallow module", "deletion test".
---

# Codebase design

Design **deep modules**: a lot of behaviour behind a small interface, sitting at a clean
seam, testable through that interface. Use this language and these principles anywhere code
is being designed or restructured. What you are buying is leverage for callers, locality for
maintainers, and testability for both.

## Glossary

Use these words exactly. Do not substitute "component", "service", "API", or "boundary" —
the consistency is the whole point, because a design conversation that drifts between four
words for one idea stops being able to tell two ideas apart.

**Module** — anything with an interface and an implementation. Scale-agnostic on purpose: a
function is a module, so is a class, a package, or a slice that spans tiers.
*Avoid*: unit, component, service.

**Interface** — everything a caller has to know to use the module correctly. The type
signature, yes, but also its invariants, its ordering constraints, its error modes, the
configuration it requires, and its performance characteristics.
*Avoid*: API, signature — both are too narrow, naming only the type-level surface.

**Implementation** — what is inside the module. Distinct from **adapter**: a thing can be a
small adapter with a large implementation (a Postgres repository) or a large adapter with a
small implementation (an in-memory fake). Say "adapter" when the seam is what you are talking
about, "implementation" otherwise.

**Depth** — leverage at the interface. How much behaviour a caller, or a test, can reach per
unit of interface it has to learn. A module is **deep** when a lot of behaviour sits behind a
small interface, and **shallow** when the interface is nearly as complicated as the thing
behind it.

**Seam** (Michael Feathers) — a place where behaviour can be altered without editing in that
place. It is the *location* at which a module's interface lives, and where to put it is a
design decision separate from what goes behind it.
*Avoid*: boundary — overloaded by DDD's bounded context.

**Adapter** — a concrete thing satisfying an interface at a seam. It names a *role*, the slot
being filled, not a substance.

**Leverage** — what callers get out of depth: more capability per unit of interface learned.
One implementation pays back across N call sites and M tests.

**Locality** — what maintainers get out of depth: change, bugs, knowledge, and verification
concentrate in one place instead of spreading across callers. Fix once, fixed everywhere.

## Deep and shallow

A deep module is a small interface over a large implementation:

```text
┌─────────────────────┐
│   small interface   │  few entry points, simple parameters
├─────────────────────┤
│                     │
│ deep implementation │  the complexity, hidden
│                     │
└─────────────────────┘
```

A shallow module is a large interface over a thin implementation, and is the thing to avoid:

```text
┌─────────────────────────────────┐
│        large interface          │  many entry points, complex parameters
├─────────────────────────────────┤
│      thin implementation        │  mostly passing through
└─────────────────────────────────┘
```

Three questions to ask of any interface you are designing:

- Can this have fewer entry points?
- Can the parameters be simpler?
- Can more of the complexity move inside?

## Principles

**Depth is a property of the interface, not the implementation.** A deep module can be built
internally out of small, swappable, individually testable pieces — those pieces just are not
part of its interface. A module can have **internal seams**, private to its implementation
and used by its own tests, as well as the **external seam** at its interface.

**The deletion test.** Imagine deleting the module. If the complexity vanishes with it, it
was a pass-through and it was not earning its keep. If the complexity reappears, scattered
across every caller that used to go through it, it was.

**The interface is the test surface.** Callers and tests cross the same seam. Wanting to test
*past* the interface is evidence that the module is the wrong shape, not evidence that you
need a back door.

**One adapter is a hypothetical seam. Two adapters is a real one.** Do not introduce a seam
unless something actually varies across it. A seam with a single adapter behind it is
indirection wearing a design's clothes.

## Designing for testability

Good interfaces make testing fall out naturally rather than requiring scaffolding.

**Accept dependencies, don't create them.** A module that constructs its own collaborators
decides for its callers, and for its tests, what those collaborators are.

```text
  testable:      process_order(order, payment_gateway)
  hard to test:  process_order(order)        # constructs a real gateway inside
```

**Return results, don't produce side effects.** A function that computes and returns can be
asserted on directly; one that reaches out and mutates has to be observed indirectly.

```text
  testable:      calculate_discount(cart) -> Discount
  hard to test:  apply_discount(cart)             # mutates cart in place
```

**Keep the surface small.** Fewer entry points means fewer tests. Fewer parameters means
less setup per test.

## How the terms relate

- A **module** has exactly one **interface** — the surface it presents to callers and to tests.
- **Depth** is a property of a **module**, measured against its **interface**.
- A **seam** is where a **module**'s **interface** lives.
- An **adapter** sits at a **seam** and satisfies the **interface**.
- **Depth** produces **leverage** for callers and **locality** for maintainers.

## Framings this skill rejects

**Depth as a ratio of implementation lines to interface lines** (Ousterhout's formulation).
It rewards padding the implementation, which is not the thing we want more of. Depth here is
leverage at the interface instead.

**"Interface" as a language keyword, or as a class's public methods.** Far too narrow.
Interface here is every fact a caller must know, most of which no type system records.

**"Boundary."** Overloaded with DDD's bounded context, so it carries a meaning you did not
intend. Say **seam**, or say **interface**.

## Going deeper

- **Deepening a cluster of shallow modules, given what it depends on** — read
  `references/deepening.md`: the four dependency categories, seam discipline, and
  replace-don't-layer testing.
- **Exploring several radically different interfaces for the same module** — read
  `references/design-it-twice.md`: the parallel sub-agent pattern, and how to compare what
  comes back.
