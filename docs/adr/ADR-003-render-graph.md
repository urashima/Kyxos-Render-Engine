# ADR-003: Declarative Render Graph

- **Status:** Accepted
- **Date:** 2026-07-21
- **Owners:** Renderer architecture, graphics backends

## Context

The target renderer contains shadows, depth, opaque and transparent lighting, temporal resolve, post-processing, optional SSDO/SSR/SSS, debug views, and future plugins. Encoding all work in one ordered `render()` function would hide dependencies, prevent safe resource reuse, and make optional features expensive to disable.

## Decision

Frame construction uses a declarative Render Graph. A pass declares a stable ID, stage, input resources, output resources, quality/capability requirements, and an execute callback that records commands only through a backend-neutral context.

The graph compiler:

1. Resolves producers and consumers.
2. Rejects missing producers, duplicate writers without an explicit policy, and dependency cycles.
3. Topologically orders enabled passes.
4. Computes transient resource lifetimes.
5. Reuses or aliases compatible transient allocations when lifetimes do not overlap.
6. Produces diagnostics for pass order, disabled reasons, resources, lifetimes, and memory estimates.

Resource ownership is explicit:

| Resource type | Owner            | Lifetime and disposal                                                                      |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| Imported      | Caller           | Valid for the declared frame/graph scope; never destroyed by the graph                     |
| Persistent    | Feature/renderer | Retained across frames; explicitly reset/recreated/disposed by its owner                   |
| Transient     | Render Graph     | Created or pooled for compiled lifetimes; returned or destroyed when the graph releases it |

Pass execution cannot directly discover or mutate Scene, product state, or UI. Scene extraction and feature preparation produce immutable frame data before graph execution.

Optional behavior enters through registration and stage contracts. Disabling a feature removes its passes and unneeded transient resources; no hidden per-frame work remains.

## Phase delivery

- Phase 0 freezes the architectural contract and extension direction.
- Phase 1 implements the minimal graph needed for clear and basic geometry.
- Later phases add lifetime aliasing, pass inspection, temporal resources, and plugin stages without replacing the contract.

Public SDK consumers do not receive the mutable Render Graph. Diagnostics may expose immutable snapshots and named timings.

## Consequences

- Passes become independently testable and capability-gated.
- Resource lifetime and memory accounting can be verified mechanically.
- Features pay a graph declaration/compilation cost, which is amortized and invalidated only when topology or relevant capabilities change.
- Graph compilation errors must use stable engine error codes and identify passes/resources.
- Backend implementations receive a validated command schedule rather than product or Scene objects.

## Alternatives rejected

- **One fixed render function:** creates a monolith and prevents safe feature insertion or removal.
- **Passes mutating a global resource map:** obscures ownership and allows order-dependent bugs.
- **A public mutable graph API for products:** leaks renderer internals and makes compatibility guarantees impractical.
- **Rebuild every resource every frame:** violates performance and ownership requirements.
