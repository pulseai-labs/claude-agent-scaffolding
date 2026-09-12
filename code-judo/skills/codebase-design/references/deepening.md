# Deepening

How to deepen a cluster of shallow modules safely, given what the cluster depends on. Uses
the vocabulary in `SKILL.md`: **module**, **interface**, **seam**, **adapter**.

## Dependency categories

Classify a deepening candidate's dependencies before proposing anything. The category
decides how the deepened module gets tested across its seam, and it is the tag that belongs
on the candidate when one is written up.

### 1. In-process

Pure computation, in-memory state, no I/O. Always deepenable: merge the modules and test
straight through the new interface. No adapter needed.

### 2. Local-substitutable

Dependencies with a local stand-in that behaves like the real thing — an embedded Postgres,
an in-memory filesystem. Deepenable when the stand-in exists. The deepened module is tested
with the stand-in running inside the test suite. The seam here is **internal**; no port
appears at the module's external interface.

### 3. Remote but owned — ports and adapters

Your own services across a network: microservices, internal APIs. Define a **port** at the
seam. The deep module owns the logic; the transport is injected as an **adapter**. Tests use
an in-memory adapter, production uses an HTTP, gRPC, or queue adapter.

The recommendation, in the shape it should be written: *"Define a port at the seam, implement
an HTTP adapter for production and an in-memory adapter for testing, so the logic sits in one
deep module even though it is deployed across a network."*

### 4. True external — mock

Third-party services you do not control. The deepened module takes the dependency as an
injected port; tests supply a mock adapter.

## Seam discipline

**One adapter is a hypothetical seam. Two adapters is a real one.** Do not introduce a port
unless at least two adapters are justified — typically production plus test. A single-adapter
seam is just indirection.

**Internal seams are not external seams.** A deep module may have internal seams, private to
its implementation and used by its own tests. Do not expose one through the module's
interface merely because a test reaches for it.

## Testing strategy: replace, don't layer

- Old unit tests against the shallow modules become waste once tests exist at the deepened
  module's interface. Delete them; do not keep both.
- Write the new tests at the deepened module's interface. **The interface is the test
  surface.**
- Assert on observable outcomes through the interface, never on internal state.
- Tests written this way survive internal refactors, because they describe behaviour rather
  than implementation. A test that has to change when the implementation changes is testing
  past the interface.
