# Design it twice

When the user wants to explore alternative interfaces for a chosen module, use this parallel
sub-agent pattern. The premise, from Ousterhout: your first idea is unlikely to be your best
one, and you cannot tell without a second to compare it against.

Uses the vocabulary in `SKILL.md`: **module**, **interface**, **seam**, **adapter**,
**leverage**.

## 1. Frame the problem space

Before spawning anything, write a user-facing explanation of the problem space for the
chosen candidate:

- The constraints any new interface would have to satisfy.
- The dependencies it would rely on, and which category each falls into — see
  `deepening.md`.
- A rough illustrative sketch, to make the constraints concrete. Not a proposal. A way of
  grounding the constraints in something you can point at.

Show this to the user, then move straight to step 2. The user reads and thinks while the
sub-agents work.

## 2. Spawn sub-agents

Spawn three or more in parallel. Each one must produce a **radically different** interface
for the module — not three variations on the same idea.

Give each a separate technical brief: file paths, the coupling that exists today, the
dependency category from `deepening.md`, and what would sit behind the seam. The brief is
independent of the user-facing explanation from step 1. Then give each a different design
constraint:

- **Minimize the interface.** One to three entry points at most. Maximise leverage per entry
  point.
- **Maximise flexibility.** Support many use cases and future extension.
- **Optimise for the most common caller.** Make the default case trivial.
- **Design around ports and adapters**, where cross-seam dependencies make that relevant.

Include both this skill's vocabulary and the project's domain vocabulary (`CONTEXT.md`) in
each brief, so every agent names things consistently with the architecture language *and*
the domain language.

Each sub-agent returns:

1. The interface — types, entry points, parameters, plus invariants, ordering, error modes.
2. A usage example showing how a caller uses it.
3. What the implementation hides behind the seam.
4. Its dependency strategy and adapters, per `deepening.md`.
5. Trade-offs: where leverage is high, and where it is thin.

## 3. Present and compare

Present the designs one at a time so the user can absorb each before the next. Then compare
them in prose, contrasting on **depth** (leverage at the interface), **locality** (where
change concentrates), and **seam placement**.

Finish with your own recommendation: which design is strongest, and why. If elements from
two designs would combine well, propose the hybrid. Be opinionated — the user wants a strong
read, not a menu.
