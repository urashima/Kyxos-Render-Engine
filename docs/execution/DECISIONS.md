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

## ED-017 — Submit complete backend-neutral frames through single-use Command Encoders

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Renderer-side code describes complete Render Passes with opaque Pipeline/Buffer/Surface Handles and portable Draw fields. The concrete backend validates the full submission before native encoding, consumes the Command Encoder after any encode attempt, submits one finished Command Buffer, and returns immutable aggregate statistics. Buffer uploads use a separate typed queue operation.
- **Candidates:** Expose a stateful native-like Render Pass API; expose `GPUCommandEncoder`; submit immutable backend-neutral frame descriptions.
- **Reason:** A stateful or native API would leak WebGPU ordering and object types into Renderer Core and complicate WebGL2 mapping. Complete descriptions can be validated deterministically before mutation, mocked without a GPU, and translated by each backend.
- **Impact:** Phase 1 supports clear, non-indexed, and indexed geometry while preserving backend isolation. Command Encoders cannot be accidentally resubmitted; failed pre-encode validation leaves them explicitly disposable. Later Render Graph compilation can emit the same contract without changing product integrations.
- **ADR required:** No; this extends the portable Backend API under ADR-004 without changing dependency direction.

## ED-018 — Give Render Features explicit backend lifecycle hooks

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** A Render Feature may asynchronously initialize backend-neutral resources after the backend is ready, synchronously emit a frame submission, and discard invalid Handle state on Device Lost. Renderer initializes registered features, aggregates their immutable statistics, disposes features before the backend, and reinitializes them after backend recovery.
- **Candidates:** Hard-code basic geometry in one Renderer method; let every product own resources and issue backend commands; use registered features with explicit lifecycle hooks.
- **Reason:** A monolithic Renderer would make later SSDO, SSR, SSS, and indoor mapping invasive, while product-owned resources would break the SDK boundary. Lifecycle-aware features preserve registration-based extensibility and deterministic ownership without exposing native GPU objects.
- **Impact:** Phase 1 basic geometry is a replaceable feature. Zero-area surfaces return zero statistics without submitting work; unexpected feature errors become typed Renderer events; Device Lost clears stale handles and recovery creates a fresh resource set. WebGL2 features can implement the same contract in Phase 10.
- **ADR required:** No; this realizes the registration architecture already mandated by the development plan.

## ED-019 — Keep concrete backend selection in the public SDK composition root

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** `@kyxos/render-sdk` may import concrete backend packages only to instantiate the caller-selected implementation. It passes the result to Renderer as `GraphicsBackend`; SDK return types, Renderer, features, and product callers receive no native GPU objects. Existing explicit backend injection remains supported for tests and custom hosts.
- **Candidates:** Require every product to import a concrete backend; make Renderer import WebGPU; compose concrete backends only inside the public SDK factory.
- **Reason:** Product-side composition would violate the single public entry policy, while Renderer-side selection would invert the backend contract. The SDK already owns public options and is the narrow place where `auto` policy and actionable fallback errors belong.
- **Impact:** Phase 1 `auto` and explicit `webgpu` both choose WebGPU; unavailable devices return a stable recoverable error until the accepted WebGL2 backend is added in Phase 10. The dependency checker records the concrete edge and will reject native/private subpath imports.
- **ADR required:** No; ADR-004 defines SDK as the product boundary and this implements its composition role without exposing a new lower-level API.

## ED-020 — Lazy-load Phase 1 while freezing the accepted Phase 0 entry budget

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Route `/acceptance/phase-01` through a dynamic import and use the Vite manifest to measure the static Phase 0 entry closure separately from all emitted JavaScript and the complete Playground output.
- **Candidates:** Bundle every acceptance phase into the initial entry; raise the Phase 0 budget; lazy-load Phase 1 and preserve both the accepted entry budget and a new whole-Playground budget.
- **Reason:** The real WebGPU backend and diagnostic Playground are intentionally larger than the mock Phase 0 surface, but a new acceptance route must not silently regress the already accepted Phase 0 initial download.
- **Impact:** Phase 0 remains below its original 24 KiB gzip JavaScript and 64 KiB gzip total budgets. Phase 1 receives explicit 32 KiB gzip JavaScript and 96 KiB gzip total Playground budgets. The check follows only static manifest imports, so lazy route chunks are not misreported as initial work while still counting toward the whole application.
- **ADR required:** No; this is an acceptance-application delivery and performance policy, not a public engine API decision.

## ED-021 — Correct basic geometry aspect in Renderer-owned vertex uploads

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Keep canonical generated geometry backend-neutral, create aspect-corrected vertex copies when a Surface is initialized or its aspect changes, and upload them through the existing opaque Buffer contract. Scale only the longer viewport axis in NDC so pixel-space X and Y radii match without clipping.
- **Candidates:** Accept stretched clip-space geometry; expose viewport uniforms and Bind Groups before their planned phase; make Backend mutate vertex data; project Renderer-owned vertex uploads for the current Surface.
- **Reason:** The first official WebGPU evidence image revealed a visibly horizontal sphere even though behavior tests passed. Backend mutation would violate responsibility boundaries, while adding an early public binding model would expand Phase 1 scope. Renderer already owns the generated vertices and Resize event.
- **Impact:** Triangle and sphere remain proportionally correct across landscape, portrait, DPR, clamping, hidden/restore, and recovery. Resize with an unchanged aspect performs no upload; an aspect change rewrites two existing Buffers without allocating resources. WebGPU and future WebGL2 receive identical corrected data.
- **ADR required:** No; this fixes Phase 1 viewport projection within the accepted Renderer/Backend boundary and does not change public product scope.

## ED-022 — Measure CPU submission time and declare unavailable GPU timing

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Measure CPU frame time around Renderer feature execution and command submission with a monotonic injectable clock. Report ten CPU samples separately from dirty-to-sleep latency. Copy the adapter `timestamp-query` capability into evidence and mark GPU frame time unavailable until a query-based timing path exists.
- **Candidates:** Omit frame timing; mislabel wall-clock dirty-to-sleep as CPU/GPU time; infer GPU time from queue completion; measure CPU submission precisely and declare the missing GPU metric with capability evidence.
- **Reason:** CPU command construction is measurable without exposing native objects. Queue completion includes scheduling and driver latency and is not a trustworthy GPU execution timer. The acceptance record must distinguish measured values from unavailable capabilities.
- **Impact:** Renderer diagnostics gain `lastCpuFrameTimeMs`; tests inject a deterministic clock, while production defaults to `performance.now()`. The canonical 16.7 ms CPU budget and 250 ms dirty-to-sleep budget are independent. Future timestamp-query support can add GPU timing without changing the current measurement's meaning.
- **ADR required:** No; this is additive diagnostics and acceptance instrumentation, not a rendering or public dependency-boundary change.

## ED-023 — Establish immutable dependency-free scene math

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Place finite-checked vectors, normalized quaternions, column-major matrices, zero-to-one projections, bounds, planes, and frusta in a dependency-free `@kyxos/render-math` package. Return readonly frozen values and keep DOM, Scene, Renderer, and backend types outside the package.
- **Candidates:** Use mutable arrays inside Scene; adopt a general third-party math library; create the smallest convention-specific engine Math package.
- **Reason:** Phase 2 Scene, Geometry, Camera, and Visibility must share the exact ADR-002 convention without introducing an upward dependency or backend-specific NDC branch. A focused owned implementation makes every transform and culling invariant directly testable and avoids exposing a third-party public type contract before 1.0.
- **Impact:** Public constructors reject NaN, Infinity, zero-length normalization, reversed bounds, and invalid projections. Values allocate immutable tuples in this correctness-first layer; later profiling may add internal destination-buffer variants without changing the public value API. WebGPU consumes canonical zero-to-one depth directly, while WebGL2 remains responsible for its Phase 10 conversion.
- **ADR required:** No; ADR-002 already freezes all affected conventions, and this decision implements it without changing the product boundary.

## ED-024 — Keep CPU mesh data immutable and renderer-neutral

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Store Phase 2 Mesh positions, normalized normals, UV0, and triangle indices as copied frozen numeric arrays in `@kyxos/render-geometry`. Derive AABB and Bounding Sphere at construction, select 16/32-bit index format from the largest addressed vertex, and keep GPU Buffers and material/render state outside the package.
- **Candidates:** Let callers retain mutable typed arrays; make Geometry own GPU Buffer uploads; copy validated CPU data into a backend-neutral immutable Mesh value.
- **Reason:** Caller mutation after validation would invalidate bounds and culling, while GPU ownership in Geometry would create a concrete-backend dependency. Frozen CPU values provide deterministic Custom Mesh behavior and allow Scene/Visibility to operate without Renderer or GPU access.
- **Impact:** Construction intentionally copies and validates data; primitive meshes are small and deterministic. Later dynamic geometry will require an explicit versioned update API rather than mutating this value. Both WebGPU and WebGL2 can upload the same data and choose native index representations behind their backend boundaries.
- **ADR required:** No; this adds a downward Geometry-to-Math edge under existing architecture rules and does not alter the public SDK boundary.

## ED-025 — Scope Entity identity and transform caches to one Scene

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Allocate non-reused opaque Entity Handles per Scene and resolve them by object identity. Store local TRS and cached local/world matrices in Scene records, propagate world dirtiness iteratively through descendants, and recompute parent-before-child on demand without recursive call stacks.
- **Candidates:** Globally mutable Entity registry; recursive Node objects with public parent mutation; Scene-owned records with opaque identity and controlled hierarchy methods.
- **Reason:** A global registry would couple engine instances and tests, while public mutable nodes could create cycles and bypass dirty propagation. Scene ownership rejects foreign/stale handles, centralizes cycle checks, and gives visibility, bounds, scheduling, and diagnostics one reliable revision source.
- **Impact:** Reparenting preserves local TRS and intentionally changes world placement; a future preserve-world option requires an explicit matrix-decomposition contract. Transform reads are cached, unchanged trees cause no recomputation, and deep trees avoid stack overflow. The design is backend-neutral and adds no GPU ownership.
- **ADR required:** No; this implements the lightweight Entity + Component Handle direction already accepted in the development plan without changing a public product boundary.

## ED-026 — Frame conservatively and keep Orbit input-independent

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Use a finite-far Perspective Camera with cached ADR-002 view/projection matrices. Frame an AABB through its padded Bounding Sphere and the smaller vertical/horizontal half-angle, preserving the current viewing direction. Keep Orbit as clamped target/yaw/pitch/distance state with numeric orbit, dolly, and camera-plane pan methods; DOM event mapping remains outside the package.
- **Candidates:** Fit only the projected AABB height; expose browser pointer events in Camera; conservatively fit a sphere and adapt inputs at SDK/Playground boundaries.
- **Reason:** Height-only fitting clips wide objects in portrait viewports, while DOM types in Camera would block Worker, test, touch, and alternate-host integrations. A sphere fit is deliberately conservative but guarantees every AABB corner remains inside the frustum at any valid aspect.
- **Impact:** Auto framing sets positive finite near/far planes around the fitted volume and emits normal Camera changes so scheduling can wake. Orbit behavior is deterministic in unit tests and reusable by products; later input adapters may change gesture scaling without changing Camera math. WebGPU receives canonical zero-to-one projection, and WebGL2 conversion remains backend-owned.
- **ADR required:** No; ADR-002 already fixes camera and projection conventions, and this decision adds policy without changing the public dependency direction.

## ED-027 — Emit immutable Render Items before backend submission

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Keep Mesh Renderer components in a Scene-bound store above Geometry. Attachments own Entity local bounds and refer to immutable Mesh data, material/pipeline keys, alpha mode, explicit order, and stable sequence. Visibility consumes Scene and Camera state, performs enabled/inherited-visibility/layer/Frustum gates, and emits immutable opaque and transparent queues without issuing graphics commands.
- **Candidates:** Submit WebGPU commands directly while traversing Scene; store GPU state inside Entity records; build backend-neutral Render Items and sort before Renderer submission.
- **Reason:** Traversal-time submission would entangle Scene, culling, sorting, and one backend. A separate Draw List makes offscreen exclusion objectively testable, preserves Scene/Backend isolation, and lets future Render Graph, WebGL2, instancing, and batching consume one prepared contract.
- **Impact:** Opaque items sort by explicit order, pipeline, material, front-to-back distance, and stable sequence. Transparent items sort by explicit order then back-to-front distance with deterministic tie breakers. Results cache by Scene, Camera, Store, and option revisions; disabled features and unchanged frames perform no unnecessary rebuild. GPU resources remain Renderer/Backend-owned.
- **ADR required:** No; this implements the visibility output boundary mandated by the development plan and keeps all accepted dependency directions intact.

## ED-028 — Extend the backend contract with portable binding and depth state

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Represent Phase 2 object Uniforms as pipeline-derived backend Bind Groups, depth testing as an owned depth Texture attachment plus pipeline state, and transparency as portable color-target Blend components. Only opaque Handles and scalar descriptors cross the public backend boundary.
- **Candidates:** CPU-bake every object's camera transform into vertex data; expose native WebGPU binding/layout objects; add minimal backend-neutral Bind Group, depth, and blend descriptors.
- **Reason:** Per-frame CPU vertex rewriting would scale with geometry size and hard-code Camera behavior into resource uploads. Native objects would break WebGL2 portability and the no-leak public contract. Pipeline-derived Bind Groups preserve WebGPU automatic layouts now while keeping room for a WebGL2 Uniform implementation behind the same API.
- **Impact:** Backends validate Buffer usage and ranges, group uniqueness and pipeline ownership, depth format and dimensions, and resource lifecycle. Phase 2 can submit one immutable Mesh upload with per-object transforms and colors; later material layouts can extend the descriptor without Scene or Camera importing a backend. WebGPU maps directly to native Bind Groups and depth attachments; WebGL2 Phase 10 will translate the same contract to program Uniform state and depth/blend state.
- **ADR required:** No; this is an additive implementation contract inside the already accepted backend abstraction and does not change product scope or global rendering conventions.

## ED-029 — Cache GPU Meshes by immutable value identity and object state by Entity

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Let the Scene Render Feature own one vertex/index allocation per immutable Mesh object and one Uniform Buffer plus pipeline-derived Bind Group per submitted Entity. Retain resources for attached but temporarily culled objects, and release them when the component or last Mesh reference disappears.
- **Candidates:** Upload every Mesh on every frame; let Geometry own backend resources; allocate duplicate Mesh Buffers per Entity; cache immutable Mesh uploads in Renderer and keep only per-object Uniform state per Entity.
- **Reason:** Immutable Geometry makes object identity a safe cache key. Sharing avoids duplicate static geometry memory, while Entity-local Uniform state preserves independent transforms and colors. Releasing on culling would churn resources during normal camera motion; releasing on attachment changes gives deterministic ownership without hidden global caches.
- **Impact:** Resource counts are predictable, multiple Entities can share one Mesh allocation, and Dispose/Device Lost returns all backend counters to baseline. Dynamic geometry will need an explicit versioned resource path later. WebGPU uses Bind Groups now; WebGL2 can preserve the same cache ownership while translating object Uniforms internally.
- **ADR required:** No; this refines the Renderer-owned resource policy already mandated by the development plan without changing product scope or dependency direction.

## ED-030 — Budget each lazy acceptance route independently

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Preserve the frozen Phase 0 initial closure and Phase 1 route limits, measure Phase 2 as the initial entry plus only its selected dynamic entry and static imports, and retain a separate cap for all emitted Playground assets.
- **Candidates:** Keep treating every historical lazy route as one user download; remove the whole-application cap; raise only the old aggregate threshold; enforce immutable per-route closures plus a bounded aggregate allowance for each added acceptance phase.
- **Reason:** A visitor loads one acceptance route, not every dynamic phase chunk. Summing all historical routes misrepresents transfer cost and eventually makes a multi-phase acceptance application impossible, while raising only that sum could hide regressions in Phase 0 or Phase 1. Manifest closures give both an accurate user path and explicit regression isolation.
- **Impact:** Phase 0 retains 24 KiB gzip JavaScript / 64 KiB gzip total limits; Phase 1 retains 32 KiB / 96 KiB; Phase 2 remains capped at 40 KiB gzip JavaScript / 96 KiB gzip total. Phase 3 adds an independently measured 60 KiB gzip JavaScript / 112 KiB gzip total route cap. The bounded four-route aggregate is 80 KiB gzip / 256 KiB raw JavaScript and 128 KiB gzip / 320 KiB raw complete output. Later phases must add their own route closure instead of consuming an unmeasured global increase.
- **ADR required:** No; this changes acceptance delivery accounting only and does not affect engine runtime APIs, dependency direction, or rendering behavior.

## ED-031 — Deploy isolated accepted Playgrounds before freezing a Phase

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision:** Build every accepted acceptance route into its own GitHub Pages directory, rebuild `latest` from only the highest contiguous Owner-Acceptance PASS record, and deploy through the official Pages artifact pipeline. After deployment, run public Chromium/WebGPU interaction smoke tests against every historical URL and `latest`; only a successful public-deployment workflow may create the next immutable accepted tag.
- **Candidates:** Publish one mutable root bundle for every URL; deploy screenshots or CI artifacts only; deploy isolated route builds but freeze before checking the public site; deploy isolated route builds and make the public check a fail-closed predecessor of tag creation.
- **Reason:** A shared root bundle can silently change historical routes, while a local or downloadable artifact does not prove that a reviewer can open and operate the milestone from another device. The acceptance tag must represent code, CI, deployment, public reachability, and browser interaction together rather than code alone.
- **Impact:** `/phase-0/` through the latest accepted `/phase-N/` remain explicit regression surfaces, `/latest/` never selects an in-development phase, and each directory owns its hashed assets under the repository Pages base path. The deployment workflow has only `contents: read`, `pages: write`, and `id-token: write`; the separate post-deployment freeze workflow alone receives `contents: write`. A repository must have GitHub Pages configured to use GitHub Actions before the deployment can pass.
- **ADR required:** No; this governs acceptance delivery and release automation without changing engine runtime architecture or public APIs.

## ED-036 — Keep temporal PBR output opt-in, offscreen, and caller-owned

- **Status:** Accepted
- **Date:** 2026-07-22
- **Decision:** Add a separate opt-in forward PBR Shader/Pipeline family that writes linear-HDR Color,
  encoded world-space Normal, and Depth into a caller-prepared `DynamicTaaGpuFrame`. Keep the accepted
  direct Surface Pipeline as the default and leave History commit, resize, recovery, and disposal with
  the temporal owner.
- **Candidates:** Replace the direct Surface path globally; make PBR own Dynamic TAA History; add an
  explicit offscreen output contract with separate Pipelines and caller ownership.
- **Reason:** Replacing the accepted path would create an unnecessary regression surface, while PBR
  ownership would entangle scene rendering with temporal scheduling and prevent independent Resolve,
  Present, accumulation, and future Render Graph composition. An explicit opt-in seam preserves public
  behavior and makes resource roles mechanically testable.
- **Impact:** WebGPU uses `rgba16float` Color/Normal MRT plus `depth32float` only when temporal output is
  supplied. The default Pipeline and resource budget are unchanged. WebGL2 may later advertise a
  downgraded compatible format set behind the same owner-neutral contract. Final output transform must
  occur in Present exactly once.
- **ADR required:** No; this is an internal composition decision within the existing backend-neutral,
  owner-scoped temporal architecture.
