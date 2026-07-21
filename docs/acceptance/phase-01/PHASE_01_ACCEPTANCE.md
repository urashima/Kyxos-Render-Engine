# Phase 01 Acceptance — WebGPU Core and Basic Geometry

- **Evidence status:** Automated verification, technical QA, and autonomous owner evidence review complete
- **Phase status:** Owner Acceptance Passed; freeze-head CI, merge, and accepted tag pending
- **Branch:** `agent/phase-01-webgpu-core`
- **Pull request:** [#2](https://github.com/urashima/Kyxos-Render-Engine/pull/2)
- **Reviewed checkpoint:** `02373b17c1ed4b334b6b6279208364f38ecc54e7`
- **CI run:** [29840589848](https://github.com/urashima/Kyxos-Render-Engine/actions/runs/29840589848)
- **Evidence-pack CI:** [29841668634](https://github.com/urashima/Kyxos-Render-Engine/actions/runs/29841668634) — PASS
- **Evidence generated:** 2026-07-21 07:48 PDT

This document proves the Phase 1 scope defined by `DEVELOPMENT_PLAN.md` and `PHASE_ACCEPTANCE_PLAN.md`. The complete evidence commit passed Run `29841668634`. It does not claim `Phase Accepted`: the immutable freeze head must pass, PR #2 must merge, and `phase-01-accepted` must resolve to that accepted merge.

## Acceptance surface

The independent Vite Playground serves `/acceptance/phase-01` and imports only the public SDK. The SDK selects WebGPU, while native adapter, device, queue, context, and GPU resources remain private to `@kyxos/render-backend-webgpu`.

The route visibly exercises:

- WebGPU adapter/device initialization and canonical WGSL compilation;
- clear, non-indexed triangle, and indexed generated sphere paths;
- Canvas Resize, DPR 2, zero-area suspension, restore, and multiple Canvas switching;
- dirty-only frame submission and immediate return to `sleeping`;
- Device Lost simulation, explicit recovery, disposal, and recreation;
- Draw, triangle, submitted-vertex, Pipeline, resource, Buffer-memory, Surface, and scheduler diagnostics.

## Required deliverables

| Requirement                                    | Evidence                                                                                | Result |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| Backend API and opaque handles                 | Typed descriptors/commands; ownership tests; no native type crosses Renderer/SDK        | PASS   |
| WebGPU Device / Queue / Surface                | Official Chromium SwiftShader initialization and live Canvas submissions                | PASS   |
| Buffer / Texture / Sampler / Shader / Pipeline | Native translation, validation, accounting, destruction, and compiler diagnostics       | PASS   |
| Command Encoder                                | Backend-neutral complete frame descriptions translated to one native submission         | PASS   |
| Clear / triangle / sphere                      | Three strict canonical snapshots plus exact Draw statistics                             | PASS   |
| Resize / DPR / aspect                          | DPR 2 lifecycle flow and landscape/portrait aspect-projection regression tests          | PASS   |
| Resource disposal                              | 6 ready resources; 0 after loss and disposal; 6 after recovery/recreation               | PASS   |
| Device Lost                                    | Native diagnostic loss, observable `lost`, zero resources, explicit successful recovery | PASS   |
| Independent public SDK Demo                    | `/acceptance/phase-01`; no Texture Lab or UI framework dependency                       | PASS   |

## Automated results

The authoritative command is:

```bash
pnpm verify
```

GitHub Actions Run `29840589848`, job `88668170176`, passed the complete pipeline at the reviewed implementation checkpoint. Evidence-pack Run `29841668634`, job `88671836231`, then passed the same pipeline with the fail-closed Phase 1 acceptance schema enabled. The machine-readable record is [`test-results/phase-01/automated-summary.json`](../../../test-results/phase-01/automated-summary.json).

| Gate                  | Result | Evidence                                                      |
| --------------------- | ------ | ------------------------------------------------------------- |
| Format / lint         | PASS   | Prettier and zero-warning ESLint                              |
| Strict types          | PASS   | Packages, tests, Playground, and Playwright configuration     |
| Unit / integration    | PASS   | 15 files / 62 tests                                           |
| Dependency boundaries | PASS   | Zero cycles/violations; deliberate forbidden fixture rejected |
| Shader validation     | PASS   | Static mirror gate plus real browser `getCompilationInfo()`   |
| Build                 | PASS   | 7 packages and 1 independent application                      |
| Bundle budget         | PASS   | 136,457 B raw / 74,945 B gzip complete output                 |
| Browser acceptance    | PASS   | 7 / 7; 2 real WebGPU flows                                    |
| Visual regression     | PASS   | 3 snapshots; 0 differing pixels                               |
| CPU frame time        | PASS   | p95 2.3 ms against 16.7 ms                                    |
| Static-to-sleep       | PASS   | p95 59.9 ms against 250 ms                                    |
| Resource lifecycle    | PASS   | 6 ready; 0 after loss/dispose; 6 after recreate               |

The reviewed technical evidence is in [`TECHNICAL_QA.md`](./TECHNICAL_QA.md), and the autonomous owner review is in [`OWNER_ACCEPTANCE.md`](./OWNER_ACCEPTANCE.md).

## Architecture evidence

[`test-results/phase-01/dependency-graph.json`](../../../test-results/phase-01/dependency-graph.json) records the accepted graph. Renderer Core imports only Backend API, Core, and Frame Scheduler. The one concrete WebGPU edge exists only in the public SDK composition root. Native `GPUDevice`, `GPUQueue`, `GPUCanvasContext`, Pipeline, Buffer, Texture, and Command Encoder objects never enter public types.

Every resource is registered to one backend instance by opaque-handle object identity. Explicit disposal calls native destruction where applicable; Device Lost drops invalid native records without attempting stale destruction. Both paths return diagnostics to zero.

## Visual evidence

The canonical environment is Chrome Headless Shell 149.0.7827.55 (Playwright Chromium v1228) with SwiftShader on GitHub Actions Ubuntu 24.04, viewport 1440 × 1000, DPR 1, dark scheme, bundled Inter, and animation disabled. Only wall-clock glyphs are hidden.

| Reference                                                         | Current                                                       | Difference                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| [reference.png](../../../visual-baselines/phase-01/reference.png) | [current.png](../../../visual-baselines/phase-01/current.png) | [difference.png](../../../visual-baselines/phase-01/difference.png) |

Reference and Current have identical SHA-256 `779ddfa68939fbacfe8120825abdd69661e18c0d046579e33ac9ce4669d87440`; the absolute Difference is 0 pixels. The full page, [triangle](../../../visual-baselines/phase-01/triangle.png), and [sphere](../../../visual-baselines/phase-01/sphere.png) snapshots each enforce `maxDiffPixels: 0`. Three official CI attempts were byte-identical.

The first evidence image was rejected before baseline creation because the sphere was horizontally stretched. [`rejected-aspect-stretched.png`](../../../visual-baselines/phase-01/rejected-aspect-stretched.png) and the [fix Difference](../../../visual-baselines/phase-01/aspect-fix-difference.png) retain the 208,525 changed pixels. Renderer-owned vertex uploads now correct landscape and portrait aspect without new resources or redundant same-aspect writes.

## Performance and resource evidence

[`benchmarks/phase-01/summary.json`](../../../benchmarks/phase-01/summary.json) compares this phase with `phase-00-accepted`.

| Metric                             | Result                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| CPU command submission, 10 samples | median 0.3 ms; p95/max 2.3 ms — PASS                                                            |
| Static-to-sleep, 10 samples        | median 24.9 ms; p95/max 59.9 ms — PASS                                                          |
| Phase 0 static-to-sleep comparison | 66.2 → 59.9 ms p95, 9.517% faster                                                               |
| Sphere Draw / triangles / vertices | 1 / 1,024 / 3,072                                                                               |
| Pipeline / ready resources         | 1 / 6                                                                                           |
| Active Buffer estimate             | 26,448 B                                                                                        |
| After Device Lost / Dispose        | 0 / 0 active resources — PASS                                                                   |
| Phase 0 initial entry              | 29,059 B raw / 9,669 B gzip JavaScript; frozen budget PASS                                      |
| Complete Playground                | 136,457 B raw / 74,945 B gzip; Phase 1 budget PASS                                              |
| GPU frame time                     | Declared unavailable; adapter capability is present but query instrumentation is not yet public |
| Asset load time                    | Not applicable until Phase 6                                                                    |

The CPU metric measures Renderer feature execution and command submission with a monotonic clock. It is intentionally separate from dirty-to-sleep latency. Queue completion is not mislabeled as GPU execution time.

## Owner checklist status

| Operation                              | Evidence                                                                | Status |
| -------------------------------------- | ----------------------------------------------------------------------- | ------ |
| Adjust window size and DPR             | DPR 2 context, live Surface resize, landscape/portrait projection tests | PASS   |
| Repeatedly create and dispose Renderer | Browser dispose/recreate plus idempotent unit lifecycle                 | PASS   |
| Hide and restore Canvas                | 0 × 0 suspension, no Draw, restore and Draw                             | PASS   |
| Switch multiple Canvas elements        | A → B reconstruction with six-resource baseline                         | PASS   |
| Run Device Lost simulation             | Native device loss, `lost`, zero resources, successful recovery         | PASS   |
| Inspect Dispose resource counts        | 6 → 0; final dispose also 0                                             | PASS   |

Owner Acceptance Passed — Autonomous Evidence Review. The corrected Reference/Current/Difference and individual geometry captures were inspected directly: the sphere is circular, the triangle is proportionate, both are centered and fully visible, and no black frame, clipping, persistent error, or obvious deformation remains.

## Known limitations

- Phase 1 uses generated clip-space geometry and fixed lighting; Scene, Camera, framing, and render queues begin in Phase 2.
- GPU timestamp instrumentation is not exposed in Phase 1 even though the canonical adapter reports `timestamp-query`; no synthetic GPU time is claimed.
- WebGL2 fallback implementation and cross-backend images begin in Phase 10. Until then an unavailable WebGPU environment returns a stable recoverable error with an explicit recommendation.
- Temporal History does not exist until Phase 4, so reset evidence is not applicable here.
- Asset loading does not exist until Phase 6, so asset-load time is not applicable here.

## Acceptance conclusion

Phase 1 passes automated verification, technical QA, and autonomous owner evidence review at checkpoint `02373b17c1ed4b334b6b6279208364f38ecc54e7`; the evidence-pack head `5193ca3c4800f48f53d387789edc1295c001e52d` also passed. Require the immutable freeze head to pass the same pipeline before merge, then merge PR #2 and create tag `phase-01-accepted` at the accepted main commit without moving any existing tag.
