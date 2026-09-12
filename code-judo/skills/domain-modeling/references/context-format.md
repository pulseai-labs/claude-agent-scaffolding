# CONTEXT.md format

## Structure

```md
# {Context name}

{One or two sentences: what this context is, and why it exists.}

## Language

**Order**:
A request from a Customer to buy goods, accepted and tracked to fulfilment.
_Avoid_: purchase, transaction

**Invoice**:
A request for payment sent to a Customer after delivery.
_Avoid_: bill, payment request

**Customer**:
A person or organization that places Orders.
_Avoid_: client, buyer, account
```

## Rules

**Be opinionated.** When several words exist for one concept, pick the best one and list the
rest under `_Avoid_`. A glossary that records the ambiguity instead of resolving it has done
nothing.

**Keep definitions tight.** One or two sentences at most. Define what the thing **is**, not
what it does.

**Only terms specific to this context.** General programming concepts — timeouts, error
types, utility patterns — do not belong, however heavily the project uses them. Before adding
a term, ask: is this a concept unique to this context, or a general programming concept? Only
the first kind belongs.

**Group under subheadings** when natural clusters appear. If every term belongs to one
cohesive area, a flat list is fine.

## Single context versus several

**Single context**, which is most repos: one `CONTEXT.md` at the repo root.

**Several contexts**: a `CONTEXT-MAP.md` at the root lists them, says where each lives, and
describes how they relate.

```md
# Context map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md): receives and tracks customer orders
- [Billing](./src/billing/CONTEXT.md): generates invoices and processes payments
- [Fulfillment](./src/fulfillment/CONTEXT.md): manages warehouse picking and shipping

## Relationships

- **Ordering → Fulfillment**: Ordering emits `OrderPlaced`; Fulfillment consumes it to start picking
- **Fulfillment → Billing**: Fulfillment emits `ShipmentDispatched`; Billing invoices from it
- **Ordering ↔ Billing**: shared types for `CustomerId` and `Money`
```

Infer which structure applies:

- `CONTEXT-MAP.md` exists → read it to find the contexts.
- Only a root `CONTEXT.md` exists → single context.
- Neither exists → single context; create the root `CONTEXT.md` lazily, when the first term
  is resolved.

When several contexts exist, infer which one the current topic belongs to. If that is
genuinely unclear, ask.

## Flagged ambiguities

A context may carry a short closing section recording ambiguities that were found and
resolved — which word used to mean two things, and which meaning won. It stops the resolved
ambiguity from being re-introduced by someone who only remembers the old usage.
