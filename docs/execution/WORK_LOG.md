# Execution Work Log

This file is append-only. Times use America/Los_Angeles unless explicitly stated.

## 2026-07-21 02:17 PDT — Phase 0 startup

### Completed

- Read `README.md`, `DEVELOPMENT_PLAN.md`, and `PHASE_ACCEPTANCE_PLAN.md` in full.
- Verified `urashima/Kyxos-Render-Engine` is accessible and private, with `main` as its default branch.
- Verified the baseline contains four commits, no existing phase branches, and no pull requests.
- Created remote branch `agent/phase-00-foundation` from `56c4f763407f4d1e8e6fbfd7ba14bcd6ec23b8b1`.
- Reconstructed the three canonical repository documents in the validation workspace.
- Defined the Phase 0 task graph and durable recovery files.

### Validation

- GitHub repository permissions: admin, maintain, pull, push, and triage confirmed.
- Canonical document line counts: README 43, development plan 1,842, acceptance plan 936.
- Runtime inventory: Node.js 24.14.0, Corepack 0.34.6, pnpm 11.7.0, npm 11.9.0.

### Issues and resolution

- The environment does not provide GitHub CLI or private-repository credentials for conventional `git clone`.
- This is not a development blocker: authenticated GitHub app operations are used for branch, commit, PR, CI, merge, and tag-facing repository work; the local workspace is used for implementation and validation.

### Next

- Commit and verify this execution baseline.
- Initialize the pnpm monorepo and strict TypeScript/tooling configuration.

## 2026-07-21 02:25 PDT — P0-01 and P0-02 execution/toolchain checkpoint

### Completed

- Added the pnpm workspace, exact runtime constraints, shared strict TypeScript configuration, ESLint flat configuration, and Prettier policy.
- Added repository ignores and a root TypeScript solution marker.
- Generated a deterministic `pnpm-lock.yaml` from exact dependency versions.
- Moved pnpm project policy into `pnpm-workspace.yaml`, including a workspace-local store for sandbox and CI portability.

### Validation

- `pnpm install --frozen-lockfile`: PASS.
- `pnpm format:check`: PASS.
- `pnpm lint`: PASS with zero warnings.
- `pnpm typecheck`: PASS under TypeScript strict mode.

### Issues and resolution

- Initial pnpm installation attempted to create `/root/.local`, which is outside the writable workspace. A project-local pnpm store resolved the environment-specific path issue.
- The first dependency selection included packages published inside the active minimum-release-age window. They were replaced with compatible stable versions (`typescript-eslint` 8.64.0 and Prettier 3.9.5), then the lockfile was rebuilt and reverified.
- TypeScript 6 rejects an empty root `files` list; a declaration-only solution marker now keeps the root project valid until package references are added.

### Next

- Commit and remotely verify the toolchain checkpoint.
- Scaffold the package manifests, TypeScript references, and public-only export map.

## 2026-07-21 02:28 PDT — P0-03 package boundary checkpoint

### Completed

- Added independently buildable packages for core, backend-api, backend-webgpu, frame-scheduler, renderer, sdk, and testing.
- Added exact workspace dependencies and TypeScript project references matching the required one-way architecture.
- Restricted every package export map to the public root entry point; private source subpaths are not exported.
- Added root package-build orchestration and a complete TypeScript solution graph.

### Validation

- `pnpm install`: PASS across eight workspace projects.
- `pnpm format:check`: PASS.
- `pnpm lint`: PASS with zero warnings.
- `pnpm typecheck`: PASS.
- `pnpm build:packages`: PASS for all seven packages, including isolated package build scripts.
- Export-map audit: PASS; every package exposes only `.`.

### Performance

- No runtime code or GPU work was added; performance baseline is unchanged.

### Next

- Commit and remotely verify the package graph.
- Implement core ownership, lifecycle, typed event, stable error, and handle primitives with regression tests.

## 2026-07-21 03:44 PDT — P0-04 core contract checkpoint

### Completed

- Added stable engine error codes, module attribution, recovery metadata, serialization, and unknown-error wrapping.
- Added an idempotent LIFO disposal bag that attempts every cleanup and aggregates multiple failures.
- Added a synchronous typed event emitter with snapshot delivery, one-shot listeners, idempotent unsubscribe, and deterministic disposal.
- Added immutable monotonic typed handles that do not reuse IDs, plus runtime validation and stable diagnostic keys.
- Exposed only the intended public contracts through the core package root.

### Validation

- `pnpm format:check`: PASS.
- `pnpm lint`: PASS with zero warnings.
- `pnpm typecheck`: PASS under strict TypeScript settings.
- `pnpm test:unit`: PASS — 4 files and 12 tests.
- `pnpm build:packages`: PASS for all seven packages.

### Issues and resolution

- The previous execution ended after writing the P0-04 working files but before committing them. The remote branch remained intact at P0-03; the local snapshot was recovered and revalidated against that exact branch head.
- GitHub CLI is unavailable in the execution image. Authenticated GitHub connector Git-data operations remain the established non-blocking publish path.

### Performance

- Core primitives allocate no GPU resources and introduce no frame loop. Event delivery is synchronous and proportional to active listeners.

### Next

- Commit and remotely verify the P0-04 checkpoint.
- Implement backend capabilities, lifecycle state, resource creation/destruction contracts, and a deterministic accounting mock.

## 2026-07-21 03:51 PDT — P0-05 backend contract and mock checkpoint

### Completed

- Added a backend-neutral lifecycle and event contract that does not expose `GPUDevice`, WebGL contexts, or other native objects.
- Added immutable capability reports with explicit backend availability, conservative feature defaults, and normalized limits.
- Added opaque resource handle kinds and active/total count plus estimated-byte diagnostics.
- Added a deterministic Mock Backend with initialization, state transitions, resource ownership, idempotent destruction, loss simulation, reinitialization, and disposal.
- Added backend contract and Mock Backend regression tests, including unavailable backend and active-resource baseline checks.

### Validation

- Clean `pnpm clean` followed by `pnpm test:unit`: PASS.
- `pnpm format:check`: PASS.
- `pnpm lint`: PASS with zero warnings.
- `pnpm typecheck`: PASS for package source and test source.
- `pnpm test:unit`: PASS — 6 files and 21 tests.
- All seven packages built successfully before the test run.
- Mock resource baseline after explicit destruction, device loss, and backend disposal: 0 active resources and 0 active estimated bytes.

### Issues and resolution

- Running package compilation and unit tests concurrently allowed Vitest to resolve stale workspace `dist` output. The test command now builds packages first, and a clean-build regression run proves it has no hidden dependency on previous artifacts.

### Performance

- No frame loop or GPU work was added. Resource statistics scan active mock records only when diagnostics are requested.

### Next

- Commit and remotely verify the P0-05 checkpoint.
- Implement the dirty-driven scheduler shell, renderer registrations, and SDK-only factory/consumer flow.

## 2026-07-21 04:01 PDT — P0-06 scheduler, renderer, and SDK checkpoint

### Completed

- Added the full Dirty Flag vocabulary and a driver-injected foundation Frame Scheduler.
- Added coalesced one-frame invalidation, wake/sleep events, explicit suspension, pending-frame cancellation, and idempotent disposal without a permanent RAF loop.
- Added Renderer lifecycle, typed events, diagnostics, backend-loss handling, and resource-owning disposal.
- Added `registerRenderFeature`, `registerMaterialExtension`, `registerAssetDecoder`, and `registerPreviewPreset` with stable duplicate-ID failures and unregister/dispose ownership.
- Added the public `createKyxosRenderer` SDK factory and isolated browser frame-driver adapter.
- Added a public-entry-only SDK consumer test plus scheduler and Mock Backend renderer integration tests.

### Validation

- `pnpm format:check`: PASS.
- `pnpm lint`: PASS with zero warnings.
- `pnpm typecheck`: PASS for source and tests.
- `pnpm test:unit`: PASS — 9 files and 28 tests.
- All seven packages built successfully before the test run.
- Two invalidations before a frame produced one pending request and one emitted frame.
- Renderer returned to Sleeping after the frame; Backend Lost and Dispose both canceled pending work.
- Renderer Dispose returned Mock Backend active resource count and estimated bytes to zero.
- SDK-only fixture imported exclusively from the SDK root entry and completed create/invalidate/frame/dispose.

### Performance

- Idle state schedules zero frames. Multiple synchronous invalidations are coalesced into one frame request.
- No DOM, React, Texture Lab, or global RAF dependency entered Renderer Core.

### Next

- Commit and remotely verify the P0-06 checkpoint.
- Build the framework-independent Vite Playground and `/acceptance/phase-00` route, then run browser smoke checks.

## 2026-07-21 04:18 PDT — P0-07 Playground development checkpoint

### Completed

- Added a framework-independent Vite Playground under `apps/playground`.
- Added the direct `/acceptance/phase-00` route with public SDK initialization and Mock Backend diagnostics.
- Added interactive controls for dirty wake, texture allocation/release, device loss, recovery, event trace, and renderer disposal.
- Added explicit Phase 0 capability messaging instead of pretending a GPU surface, CPU/GPU timer, draw call, or triangle result exists before Phase 1.
- Added responsive and reduced-motion presentation without React, Texture Lab, a business store, or analytics.
- Extended root build and typecheck orchestration to include applications.

### Validation

- `pnpm format:check`: PASS.
- `pnpm lint`: PASS with zero warnings.
- `pnpm typecheck`: PASS for packages, tests, and the Playground.
- `pnpm build`: PASS for all seven packages and the Playground production bundle.
- Vite production output: HTML 0.55 kB, CSS 7.84 kB / 2.51 kB gzip, JavaScript 20.29 kB / 6.55 kB gzip.
- Dependency inspection: Playground imports SDK and testing support only; no Texture Lab, React, Next.js, Zustand, or product route dependency exists.

### Browser verification status

- Cloud browser navigation to the workspace loopback URL returned `ERR_BLOCKED_BY_CLIENT`; this is a network-isolation result, not a page failure.
- Browser smoke remains open and is not marked PASS. P0-08 will add repository-owned Playwright startup and interaction checks and attempt a local Chromium runtime.

### Performance

- Idle runtime reports Sleeping with zero scheduled engine frames.
- Phase 0 production JavaScript is 6.55 kB gzip.

### Next

- Commit and remotely verify the P0-07 development checkpoint.
- Add Playwright, dependency/bundle/shader gates, then complete the outstanding browser smoke test.

## 2026-07-21 04:28 PDT — P0-08 automated quality gate checkpoint

### Completed

- Added repository-owned Playwright acceptance tests for the Phase 0 Playground lifecycle flow and compact viewport behavior.
- Added a package dependency and source-import boundary checker with cycle detection, private-subpath rejection, product/framework isolation, and an intentionally forbidden Renderer-to-SDK fixture that must be rejected.
- Added byte-accurate raw and gzip Playground bundle budgets by asset category and total output.
- Added an honest Shader validation entry point: it reports `NOT_APPLICABLE` while Phase 0 contains no Shader capability and fails if Shader sources appear before a compiler-backed validator is configured.
- Unified format, lint, strict typecheck, unit tests, architecture gates, Shader status, production build, bundle budgets, and browser acceptance under `pnpm verify`.
- Added an optional Chromium executable override so constrained local environments can run the same Playwright suite without changing CI behavior.

### Validation

- Full `pnpm verify`: PASS.
- `pnpm format:check`: PASS.
- `pnpm lint`: PASS with zero warnings.
- `pnpm typecheck`: PASS for packages, tests, configuration, and the Playground.
- `pnpm test:unit`: PASS — 9 files and 28 tests.
- Dependency graph: PASS; no cycles or prohibited production edges.
- Deliberate Renderer-to-SDK fixture: PASS by being rejected with the expected layer violation.
- Shader gate: `NOT_APPLICABLE` with zero Shader files, as required for the current capability set.
- Production build: PASS for seven packages and the Playground.
- Bundle budget: PASS — 28,705 raw bytes and 9,371 gzip bytes total.
- Playwright Chromium 149: PASS — 2 tests covering SDK startup, sleeping/wake, resource allocation and release, device loss and recovery, disposal baseline, console errors, and 390 × 844 layout overflow.

### Issues and resolution

- The environment could not write Playwright's default `/root/.cache` path; the temporary browser cache was moved to a writable location.
- The Playwright CDN response was blocked at zero bytes. An exact-version Chromium 149 binary was obtained temporarily through the permitted npm registry, and the actual suite passed against it. This environmental download restriction is not recorded as a project blocker; standard CI installation will be verified by GitHub Actions.

### Performance

- Phase 0 production JavaScript remains 20,299 raw bytes and 6,530 gzip bytes.
- Total Playground output uses 21.9% of the 131,072-byte raw budget and 19.1% of the 49,152-byte gzip budget.

### Next

- Commit and remotely verify the P0-08 checkpoint.
- Add GitHub Actions and freeze ADR-001 through ADR-005 plus the architecture and dependency rules.

## 2026-07-21 04:31 PDT — P0-09 CI workflow implementation

### Completed

- Added a least-privilege GitHub Actions workflow for pushes to `main`, Phase branches, and pull requests targeting `main`.
- Pinned the repository's Node.js 24.14.0 and lockfile-controlled pnpm 11.7.0 toolchain.
- Configured one authoritative CI gate to install Chromium and run the same complete `pnpm verify` pipeline used locally.
- Added concurrency cancellation and seven-day browser diagnostic artifact upload without weakening a failed gate.

### Validation

- Workflow YAML parses and is formatted by the repository toolchain.
- Complete local `pnpm verify` remains PASS before the workflow commit.

### Next

- Push the workflow and inspect the resulting GitHub Actions run.
- Write and validate ADR-001 through ADR-005 plus the architecture and dependency rules.

## 2026-07-21 04:36 PDT — P0-09 architecture baseline checkpoint

### Completed

- Accepted ADR-001 WebGPU First / WebGL2 Fallback, ADR-002 Coordinate and Color Conventions, ADR-003 Render Graph, ADR-004 Public SDK Boundary, and ADR-005 Temporal Accumulation and Sleep.
- Added the current package graph, runtime ownership, backend policy, extensibility, product isolation, and verification contract to the architecture overview.
- Added an exact allowed-edge table, forbidden dependencies, root-entry policy, negative-fixture enforcement, and package-change procedure to the dependency rules.
- Added a documentation gate that requires all five accepted ADRs, their required sections, both architecture documents, and valid relative Markdown links.
- Added local development and recovery entry points to the README and created the contribution/architecture review guide.
- Extended `pnpm verify` so architecture documentation is checked in local and GitHub Actions gates.

### Validation

- Full `pnpm verify`: PASS after all architecture and documentation changes.
- Architecture documentation gate: PASS — 5 ADRs and 2 architecture documents.
- Dependency graph and deliberate forbidden fixture: PASS.
- Unit tests: PASS — 9 files and 28 tests.
- Chromium acceptance: PASS — 2 tests.
- Production build and bundle budget: PASS — 28,705 raw bytes and 9,371 gzip bytes.
- The workflow file was accepted into the remote branch. The available connector exposes pull-request-triggered runs but not the branch-only push run, so remote CI is intentionally left pending until the Phase PR exists.

### Architecture impact

- WebGPU/WebGL2 selection, coordinate/color semantics, Render Graph ownership, SDK isolation, and temporal sleep/reset rules now have accepted decision records before their dependent phases begin.
- No runtime package edge or production bundle content changed.

### Next

- Commit and remotely verify the P0-09 architecture checkpoint.
- Generate the Phase 0 acceptance document, machine-readable summary, performance record, and deterministic visual baseline/difference evidence.

## 2026-07-21 04:47 PDT — P0-10 acceptance evidence checkpoint

### Completed

- Added the Phase 0 acceptance document with required deliverables, automated results, dependency evidence, owner checklist state, limitations, and an explicit non-acceptance conclusion pending CI and QA.
- Added machine-readable automated, dependency-graph, bundle, performance, and visual metadata records.
- Added fixed Chromium Reference and Current captures plus a standard absolute Difference image.
- Added a zero-pixel Playwright visual assertion with fixed viewport, DPR, color scheme, disabled motion, and only wall-clock glyphs hidden.
- Added a browser static-to-sleep benchmark over ten dirty-only frames and a 250 ms Phase 0 budget.
- Added an acceptance schema gate that validates required files, JSON states, bundle/performance budgets, resource deltas, PNG headers/dimensions/bytes/hashes, and mandatory acceptance sections.
- Integrated the acceptance schema gate into `pnpm verify`.

### Validation

- Full `pnpm verify`: PASS.
- Unit tests: PASS — 9 files and 28 tests.
- Chromium acceptance: PASS — 4 tests covering lifecycle, compact layout, deterministic visual regression, and static-to-sleep.
- Visual comparison: PASS — Reference and Current are byte-identical; absolute error is 0 pixels; Difference is all black.
- Acceptance evidence gate: PASS — 10 required evidence files.
- Static-to-sleep: 10 samples; median 16.7 ms; p95/max 49.2 ms; budget 250 ms.
- Dispose resource delta: 0 active resources and 0 active estimated bytes.
- Bundle: PASS — 28,705 raw bytes and 9,371 gzip bytes.
- GPU frame time, CPU frame time, Shader validation, and asset loading remain explicitly not applicable to Phase 0.

### Issues and resolution

- The first screenshot exposed a wall-clock timestamp in the event trace. The visual test now hides only those glyphs during capture, preserves the panel's semantic content, and passes on a second independent run.
- The first zero-difference visualization used a white no-difference convention. It was replaced with a standard absolute-difference composite, where black represents no difference.

### Next

- Commit and remotely verify the P0-10 acceptance checkpoint.
- Open the draft Phase PR, inspect the pull-request GitHub Actions run, repair failures, and complete technical QA.
