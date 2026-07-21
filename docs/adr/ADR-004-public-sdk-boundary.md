# ADR-004: Public SDK Boundary

- **Status:** Accepted
- **Date:** 2026-07-21
- **Owners:** Public API, integration, renderer architecture

## Context

Kyxos Render Engine must serve Texture Lab and independent products without becoming a Texture Lab component. Internal packages need freedom to evolve before 1.0, while consumers need a typed, mockable, backend-neutral lifecycle that does not expose GPU implementation details.

## Decision

`@kyxos/render-sdk` is the only supported engine entry point for product applications. A product imports from its package root:

```ts
import { createKyxosRenderer } from '@kyxos/render-sdk';
```

Texture Lab will depend on `@kyxos/render-integration-texture-lab`, which in turn depends only on the public SDK. No product or adapter imports Renderer, Backend, Render Graph, Shader, Scene internals, or private package subpaths.

The SDK exposes:

- asynchronous creation with typed options;
- stable handles, descriptors, commands, and typed events;
- immutable capabilities and diagnostics;
- explicit invalidation and capture operations;
- clear error codes and recoverability;
- idempotent `dispose()` and documented ownership.

The SDK does not expose `GPUDevice`, `GPUQueue`, GPU resources, WebGL contexts, mutable Render Graphs, internal caches, or concrete backend classes.

Every workspace package publishes only its root export. Internal source layout is not API. Public API changes follow semantic versioning; a breaking change requires an ADR or accepted API proposal plus migration documentation.

## Dependency boundary

The SDK may depend downward on Renderer and public engine contracts. Renderer and lower layers may never import SDK. Testing utilities are not SDK runtime dependencies. UI frameworks and product stores are outside all engine packages.

Phase 0 proves the boundary with:

- an SDK-only consumer test;
- an independent Playground;
- package root-only `exports` maps;
- a source and manifest dependency gate;
- a deliberate Renderer-to-SDK violation that the gate must reject.

## Consequences

- Products remain insulated from backend and package refactors.
- Public operations may need command/handle wrappers instead of returning convenient native objects.
- Integration-specific batching, channel mapping, theme handling, and error translation live in adapters.
- Test code can inject backend and frame-driver contracts without adding test hooks to product APIs.
- Internal packages may move rapidly before 1.0 as long as the SDK contract and dependency direction remain intact.

## Alternatives rejected

- **Allow products to import internal packages:** creates version lockstep and makes architecture rules unenforceable.
- **Put Texture Lab mapping in the SDK or Renderer:** couples a reusable engine to one product's state model.
- **Expose native GPU objects for flexibility:** prevents backend replacement, safe recovery, and stable ownership.
- **Use a global engine singleton:** prevents isolation, multi-viewport ownership, deterministic tests, and disposal.
