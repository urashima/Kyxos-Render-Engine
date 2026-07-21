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

## ED-005 — Keep backend capabilities and resource accounting backend-neutral

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** The backend boundary exposes immutable capability reports, opaque typed resource handles, lifecycle events, and estimated active resource counts. Concrete `GPUDevice`, WebGL contexts, and native resources stay inside backend implementations.
- **Candidates:** Expose WebGPU objects through the SDK; postpone the backend contract until Phase 1; define a minimal backend-neutral contract and executable mock in Phase 0.
- **Reason:** The renderer and tests need a real replaceable seam before WebGPU code arrives. Conservative capability defaults and active-count baselines make unsupported features and leaks observable without coupling callers to one API.
- **Impact:** WebGPU and WebGL2 may implement different capabilities behind one contract. Estimated bytes are diagnostics rather than an assertion of exact driver allocation.
- **ADR required:** Yes; ADR-002 will freeze backend abstraction and fallback responsibilities.

## ED-006 — Drive Phase 0 rendering only from explicit invalidation

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** The foundation scheduler receives an injected frame-request driver, coalesces dirty flags into one requested frame, and returns immediately to Sleeping unless the frame itself raises another invalidation. Renderer Core contains no DOM or global RAF access.
- **Candidates:** Permanent RAF loop; direct browser RAF calls inside Renderer; injected dirty-driven frame scheduling.
- **Reason:** The engine's defining temporal requirement starts at the foundation boundary. Driver injection makes scheduling deterministic in tests and keeps browser/platform behavior outside Renderer Core.
- **Impact:** Phase 0 supports Interactive and Sleeping behavior only; Stabilizing and Accumulating policies remain explicitly deferred to Phase 4. The SDK browser adapter is the sole current global RAF access point.
- **ADR required:** Yes; ADR-003 will capture scheduler ownership, sleeping guarantees, and future temporal extension points.

## ED-007 — Keep the Playground framework-independent

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Build the engine Playground as a plain TypeScript, semantic HTML, and CSS Vite application. The Phase 0 route imports the public SDK plus the development Mock Backend and contains no React or Texture Lab dependency.
- **Candidates:** React-based developer UI; reuse the Texture Lab UI; standalone plain TypeScript acceptance application.
- **Reason:** A small independent consumer is the strongest executable proof that Renderer Core has no product or UI-framework dependency.
- **Impact:** The Phase 0 bundle remains small and the Playground can later add optional framework adapters without making them engine dependencies.
- **ADR required:** No; ADR-004 and the dependency architecture document will freeze the public/package boundary.

## ED-008 — Make Phase 0 quality claims executable and capability-aware

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Use Vitest for deterministic package tests, Playwright Chromium for acceptance interactions and responsive layout, a repository-owned dependency graph gate with a deliberately forbidden fixture, explicit bundle budgets, and a Shader validator that reports `NOT_APPLICABLE` only while no Shader capability exists.
- **Candidates:** Documentation-only boundaries; a generic dependency tool without the Kyxos layer policy; executable project-specific gates integrated into one `pnpm verify` command.
- **Reason:** Phase acceptance must prove both positive behavior and rejection of prohibited architecture. An honest capability state prevents Phase 0 from claiming Shader validation before Shader sources and a compiler exist.
- **Impact:** Local and CI checks use the same command. Any future Shader source makes the placeholder fail until a real compiler-backed validator is configured. The checks are backend-neutral and do not add runtime code.
- **ADR required:** No; ADR-004 and the dependency rules document will record the stable boundary policy.

## ED-009 — Preserve visual semantics while removing wall-clock nondeterminism

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Capture Phase acceptance at a fixed browser, viewport, DPR, and color scheme with motion disabled. Hide only `.event-log time` during screenshot capture while retaining event identity, runtime state, diagnostics, controls, and dependency information. Store Reference, Current, absolute Difference, hashes, and capture metadata.
- **Candidates:** Accept time-driven pixel noise; mask the entire event panel; remove the timestamp from the product; hide only wall-clock glyphs in the test capture.
- **Reason:** Wall-clock text is not a rendering result and changes every run. Removing the entire panel would conceal useful acceptance content, while changing the product for a screenshot would be misleading.
- **Impact:** Playwright still exercises the unmodified interactive page. The fixed visual assertion permits zero differing pixels, and the black absolute Difference image communicates that result directly.
- **ADR required:** No; this is acceptance-fixture policy rather than runtime architecture.

## ED-010 — Track the current Node 24 GitHub-maintained action majors

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Use `actions/checkout@v7`, `actions/setup-node@v7`, and `actions/upload-artifact@v7`, with checkout credentials not persisted because CI is read-only.
- **Candidates:** Retain v4 while GitHub forces its Node 20 action runtime onto Node 24; use the current official v7 majors that declare `node24`.
- **Reason:** The first CI run emitted an explicit Node 20 deprecation warning for every v4 action. The official action repositories currently document v7 usage and declare the Node 24 runtime.
- **Impact:** CI remains least-privilege and removes a known runtime deprecation before Phase acceptance. Action-major upgrades remain subject to an observed workflow run.
- **ADR required:** No; this is CI maintenance, not engine architecture.
