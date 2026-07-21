# Execution Decisions

## ED-001 — GitHub app is the remote write path in this execution environment

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Use the authenticated GitHub app for remote branch creation, commits, pull requests, CI inspection, merges, and repository metadata. Use the reconstructed local workspace for implementation and tests.
- **Candidates:** Conventional `gh` plus local `git`; unauthenticated HTTPS Git; GitHub app.
- **Reason:** `gh` is absent and HTTPS Git has no private-repository credential, while the requested GitHub app has administrator access.
- **Impact:** Remote commit SHAs are authoritative. Every remote write is verified by fetching the resulting branch files or commit metadata. This does not affect engine architecture, WebGPU, or WebGL2.
- **ADR required:** No; this is an execution-environment decision, not a product architecture decision.

## ED-002 — Pin a mutually supported Node, TypeScript, and lint toolchain

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Use Node.js 24.14.0, pnpm 11.7.0, TypeScript 6.0.3, ESLint 10.7.0, and typescript-eslint 8.64.0 with exact versions and a frozen lockfile.
- **Candidates:** TypeScript 7.0.2 with the latest packages; TypeScript 6.0.3 with compatible stable lint packages.
- **Reason:** Current typescript-eslint declares TypeScript support below 6.1.0. The selected versions are mutually compatible and older than the active supply-chain minimum-release-age window.
- **Impact:** Reproducible CI and strict typing without unsupported parser behavior. No WebGPU or WebGL2 runtime impact.
- **ADR required:** No; upgrades remain routine dependency maintenance while strictness rules stay stable.

## ED-003 — Establish explicit Phase 0 package layers before runtime implementation

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Start with seven independently buildable packages: core, backend-api, backend-webgpu, frame-scheduler, renderer, sdk, and testing. Every package exposes only its root entry point.
- **Candidates:** One renderer package split later; the complete long-term package tree immediately; a minimal dependency-directed Phase 0 graph.
- **Reason:** The selected graph proves ownership and dependency direction without creating dozens of empty packages or a monolith that would be costly to split.
- **Impact:** Core has no engine dependency; backend-api depends only on core; renderer sees the backend contract but no concrete GPU API; sdk stays above renderer; testing cannot enter production packages. WebGPU and future WebGL2 remain replaceable implementations.
- **ADR required:** Yes; ADR-004 will freeze the public SDK boundary and the architecture overview will record all allowed edges.

## ED-004 — Use deterministic synchronous core ownership primitives

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Core cleanup is idempotent and LIFO, event delivery is synchronous over a listener snapshot, and typed resource handles use immutable monotonically increasing IDs that are never reused within an allocator.
- **Candidates:** Async global lifecycle manager; mutable numeric IDs with a free list; deterministic package-local primitives.
- **Reason:** GPU resource owners need predictable cleanup order, safe subscription mutation, and stale-handle protection without introducing a global singleton or asynchronous teardown into every API.
- **Impact:** Resource destruction can be audited and tested independently. Long-running allocators consume a monotonically increasing safe-integer space, whose practical limit is far beyond a browser session. The policy is backend-neutral.
- **ADR required:** No; the public lifecycle contract will be captured by ADR-003 while these are internal deterministic primitives.
