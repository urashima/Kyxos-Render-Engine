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

## ED-011 — Bundle the acceptance typeface as a licensed deterministic input

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Pin `@fontsource-variable/inter@5.2.8`, emit only `inter-latin-wght-normal.woff2`, wait for loaded fonts before visual capture, and account for the font in explicit asset and total bundle budgets.
- **Candidates:** Keep environment-dependent `system-ui`; allow a nonzero text-pixel threshold; commit a CI-generated reference; bundle a versioned WebFont and retain the zero-pixel gate.
- **Reason:** The second clean CI run passed every nonvisual gate and produced the same 2,763 text-edge differences on both attempts. Artifact inspection showed identical layout, colors, panels, and vector content; only glyph rasterization differed because the original local fallback resolved to DejaVu Sans while the GitHub runner supplied another system typeface. A versioned OFL font removes that undeclared input without hiding differences.
- **Impact:** The Playground output grows by 48,256 raw bytes and 48,254 gzip bytes. Total output remains below a recorded 128 KiB raw / 64 KiB gzip budget. The reference is regenerated because the previous reference encoded an unspecified system font; the zero-pixel maximum and image threshold remain unchanged. No engine runtime package gains a font dependency.
- **ADR required:** No; this is an acceptance-fixture and asset-provenance decision.

## ED-012 — Make official Playwright CI the canonical pixel environment

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Use the pinned Playwright Chromium v1228 browser on GitHub Actions Ubuntu as the canonical Phase 0 pixel environment. Keep the network-restricted sandbox Chromium 149 build as an explicitly selected development profile with its own versioned exact reference. Both profiles use `maxDiffPixels: 0` and the same image threshold.
- **Candidates:** Silently replace the reference; raise the pixel allowance; require a sandbox-specific browser in CI; define one canonical acceptance profile plus a strict, disclosed development profile.
- **Reason:** The acceptance plan requires a fixed environment and rejects results that work only on a developer machine. After the WebFont fix, both official CI attempts were byte-identical, while the remaining cross-profile Difference was confined to glyph antialiasing from different Chromium builds. Layout, controls, panels, colors, and vector geometry were unchanged.
- **Impact:** `reference.png`, `current.png`, and `difference.png` represent only the canonical CI profile. The previous sandbox reference and the 2,983-pixel Playwright / 20,028-pixel absolute environment Difference remain versioned migration evidence. The sandbox profile must be opted into by name and cannot update canonical evidence. No test is skipped, and no visual threshold is widened.
- **ADR required:** No; this is acceptance-environment policy rather than runtime architecture.

## ED-013 — Freeze Phase 0 with a phase-specific main-push workflow

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Add a Phase 0-only GitHub Actions workflow that runs when the accepted Phase 0 evidence reaches `main`, receives only `contents: write`, and creates the fixed annotated tag `phase-00-accepted` at that main commit. If the tag already exists, the workflow exits successfully without moving it.
- **Candidates:** Pause for a manual tag because the active connector has no tag-ref mutation; create a branch that merely resembles a tag; use a broad reusable write workflow; use a narrowly triggered immutable phase-freeze workflow.
- **Reason:** A real Git tag is a mandatory acceptance gate, while a similarly named branch would be false evidence. The repository's own post-merge workflow can use GitHub's short-lived token without exposing credentials or granting write access to the read-only PR verification job.
- **Impact:** Only the phase-freeze job has `contents: write`, only on `main`, with no pull-request or user-controlled input. The fixed tag cannot be overwritten or moved. The tag target is verified after merge by reading repository content through that ref.
- **ADR required:** No; this is release automation for one acceptance checkpoint.

## ED-014 — Scope resource ownership to a backend instance by handle identity

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Each backend owns a private resource registry keyed by the opaque handle object's identity, not only its serializable `kind` and numeric `id`. Native destroy callbacks never cross the backend package. Device loss clears invalid native records without invoking their destroy methods; explicit backend disposal attempts native cleanup, destroys the device, and returns diagnostic counts to baseline. The backend-neutral `waitForIdle()` contract waits for queue completion without exposing the queue.
- **Candidates:** Globally unique numeric handles; per-backend numeric lookup; object-identity ownership with per-backend monotonic IDs.
- **Reason:** Separate Canvas/backend instances legitimately allocate equal-looking first handles. Numeric lookup alone lets one backend accidentally destroy another backend's resource. Object identity rejects foreign handles while preserving compact immutable public handles and deterministic stale-handle behavior.
- **Impact:** Handles are transferable as opaque references within one renderer but are intentionally not reconstructible from JSON. WebGPU and Mock Backend now enforce the same ownership rule; WebGL2 must follow it. Resource statistics retain lifetime totals across device recovery.
- **ADR required:** No; this strengthens the already accepted opaque-handle and resource-lifetime boundary without changing the public dependency direction.

## ED-015 — Size Canvas surfaces from explicit logical inputs and suspend zero area

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Surface sizing consumes explicit CSS width, CSS height, DPR, and optional render scale. Physical dimensions are rounded once, uniformly scaled down when either device limit would be exceeded, and never inferred by a backend-owned layout observer. A zero width or height produces a suspended 0 × 0 surface and unconfigures the context; a later nonzero resize reconfigures it.
- **Candidates:** Independently clamp width and height; query layout and poll inside Backend; use explicit inputs with aspect-preserving uniform clamp and zero-area suspension.
- **Reason:** Independent clamping can deform geometry, while backend-owned DOM observation would couple graphics code to page layout and invite permanent work. Explicit inputs are deterministic for Canvas, OffscreenCanvas, tests, multiple viewports, and future Worker adapters.
- **Impact:** SDK/platform adapters own ResizeObserver and DPR change detection. WebGPU and future WebGL2 implementations share identical physical-size math. Hidden Canvas instances allocate no swapchain size until restored.
- **ADR required:** No; this refines the existing Canvas/backend responsibility without changing public product scope.

## ED-016 — Translate portable resource descriptors only inside a concrete backend

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Backend API represents Buffer/Texture usages, formats, Sampler state, vertex layouts, WGSL modules, Pipeline state, and Command Encoders as immutable string/data descriptors plus opaque handles. Only `backend-webgpu` translates those values to native flags and objects. Shader compilation diagnostics are copied into immutable backend-neutral messages, and Render Pipeline creation is asynchronous.
- **Candidates:** Expose WebGPU descriptors and native resources through SDK; use untyped `unknown` descriptors; define a portable typed subset and translate per backend.
- **Reason:** Native WebGPU objects would bind Renderer and products to one backend, while untyped descriptors would defer errors and make WebGL2 mapping untestable. The Phase 1 subset covers actual draws and can expand deliberately as later material/render-graph phases require it.
- **Impact:** Buffer and Texture byte estimates are tracked by kind; destructive resources call native `destroy()`, while immutable Shader/Pipeline/Sampler objects release by dropping registry ownership. WebGL2 can map the same descriptors to its distinct implementation in Phase 10 without emulating WebGPU objects.
- **ADR required:** No; this implements the accepted Backend API boundary. A future public descriptor compatibility change may require an ADR before 1.0.
