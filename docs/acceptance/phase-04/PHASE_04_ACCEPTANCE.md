# Phase 04 Acceptance — Temporal Scheduling, Dynamic TAA, and Static Accumulation

- **Evidence status:** Automated verification, technical QA, and autonomous owner evidence review complete
- **Phase status:** Owner Acceptance Passed — Deployment Pending
- **Branch:** `agent/phase-04-temporal`
- **Pull request:** [#7](https://github.com/urashima/Kyxos-Render-Engine/pull/7)
- **Reviewed checkpoint:** `d11b1e4c18722d7aaf4e950b53085e9ac2d12e03`
- **Evidence generated:** 2026-07-23 01:35 PDT

This package freezes the pre-deployment Phase 4 candidate required by
[`PHASE_ACCEPTANCE_PLAN.md`](../../../PHASE_ACCEPTANCE_PLAN.md). It deliberately does not claim
`Phase Accepted`: the evidence Head must pass, PR #7 must merge without drift, GitHub Pages must
deploy the exact merge source, the public Phase 4 operations must pass in Chromium/WebGPU, and only
then may `phase-04-accepted` be created.

## Acceptance surface

The independent `/acceptance/phase-04` route imports only `@kyxos/render-sdk`. It composes one
public Temporal PBR Canvas lifecycle and exposes:

- Interactive → Stabilizing → Accumulating → Sleeping scheduling;
- RAF activity, Dirty Flags, Dynamic History validity/generation, sample count, and active passes;
- Camera, Material, Texture, explicit History reset, and animation wake/reset operations;
- sixteen-sample Static Accumulation and a deterministic sleep boundary;
- Resize, Device Lost/recovery, disposal/recreation, and exact resource diagnostics;
- CPU time, declared-unavailable GPU time, Draws, Triangles, Pipelines, and memory estimates.

The accepted Phase 3 direct Surface path remains the default. Temporal rendering is opt-in, Dynamic
and Static Histories have independent owners, and Present is the only temporal Canvas Surface
writer.

## Required deliverables

| Requirement          | Evidence                                                                              | Result |
| -------------------- | ------------------------------------------------------------------------------------- | ------ |
| Temporal Scheduler   | Exact mode order, Dirty coalescing, wake/reset, convergence, and no pending RAF       | PASS   |
| Camera reprojection  | Current Depth to previous jittered View-Projection CPU/WGSL parity                    | PASS   |
| Dynamic TAA          | Color/Depth/Normal History, sampled resolve, rejection branches, atomic commit/cancel | PASS   |
| Temporal PBR output  | Ordered MRT, HDR Color/Normal output, bounded Pipeline variants                       | PASS   |
| Present              | Exposure, Khronos PBR Neutral, one linear-to-sRGB conversion, one Surface owner       | PASS   |
| Static Accumulation  | Running mean, sample-limit convergence, complete reset and disposal                   | PASS   |
| Public SDK lifecycle | Wake, Resize, loss/recovery, disposal/recreation, stable resources                    | PASS   |
| Independent Demo     | Lazy Phase 4 route and isolated `/phase-4/` Pages candidate                           | PASS   |

## Automated results

The authoritative command is:

```bash
pnpm verify
```

The machine-readable record is
[`automated-summary.json`](../../../test-results/phase-04/automated-summary.json). Its exact GitHub
Actions provenance, Artifact digest, gate counts, and deployment requirements are retained there.

| Gate                         | Result | Evidence                                                        |
| ---------------------------- | ------ | --------------------------------------------------------------- |
| Format / lint / strict types | PASS   | Prettier, zero-warning ESLint, packages, tests, and application |
| Unit / integration           | PASS   | 62 files / 275 tests                                            |
| Dependency boundaries        | PASS   | Zero cycles/violations; deliberate forbidden fixture rejected   |
| Shader validation            | PASS   | Fourteen exact WGSL mirrors plus browser compilation            |
| Build and bundle             | PASS   | 16 packages, one app, Phase 4 route within raw/gzip budgets     |
| Pages candidate              | PASS   | Isolated Phase 0–4 and `latest` artifacts                       |
| Browser acceptance           | PASS   | 33 / 33 pinned Chromium/WebGPU cases                            |
| Visual regression            | PASS   | Fixed 1440×1600 capture; zero pixels above the frozen threshold |
| CPU frame time               | PASS   | p95/max 1.2 ms against 16.7 ms                                  |
| Static-to-sleep              | PASS   | p95/max 3827.2 ms against 10000 ms                              |
| Resource lifecycle           | PASS   | 73 ready; 0 after loss/dispose; exact recovery/recreation       |

[`TECHNICAL_QA.md`](./TECHNICAL_QA.md) reviews the numerical and lifecycle evidence.
[`OWNER_ACCEPTANCE.md`](./OWNER_ACCEPTANCE.md) records the operation and visual review.

## Numerical and lifecycle evidence

The downloaded authoritative Runtime records are promoted under
[`test-results/phase-04/`](../../../test-results/phase-04/):

- Camera reprojection and Present have exact CPU/GPU parity for their frozen cases.
- Dynamic TAA Resolve maximum absolute error is `0.000107421875...` against `0.001`.
- Static running-mean maximum absolute error is `0.000081380208...` against `0.002`.
- Native PBR temporal execution reaches Sleeping at 2/2 Static samples with no pending RAF.
- Feature disposal reaches 0 active resources with 81 created and 81 destroyed.
- The public route reaches 16/16 samples, then loss/disposal each reach 0 resources and
  recovery/recreation each return to 73.

## Fixed visual comparison

| Reference                                                         | Current                                                       | Difference                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| [reference.png](../../../visual-baselines/phase-04/reference.png) | [current.png](../../../visual-baselines/phase-04/current.png) | [difference.png](../../../visual-baselines/phase-04/difference.png) |

[`metadata.json`](../../../visual-baselines/phase-04/metadata.json) freezes browser, viewport, DPR,
font, SwiftShader adapter, files, hashes, threshold, provenance, and direct review. Reference and
Current use distinct lossless PNG encodings, while the pinned Playwright comparison reports zero
pixels above threshold and permits zero differing pixels.

## Performance and resource evidence

[`performance.json`](../../../benchmarks/phase-04/performance.json) reports the Phase 3 comparison
without disguising the new sixteen-sample temporal workload.

| Metric                            | Result                                              |
| --------------------------------- | --------------------------------------------------- |
| CPU frame, eight settled samples  | median 0.6 ms; p95/max 1.2 ms — PASS                |
| Static-to-sleep, eight operations | median 3661.2 ms; p95/max 3827.2 ms — PASS          |
| Fixed settled workload            | 6 Draws / 7,779 Triangles / 15 Pipelines            |
| Estimated GPU allocation          | 30.8 MiB Textures / 83.3 KiB Buffers                |
| Resource lifecycle                | 73 → 0 loss → 73 recovery → 0 dispose → 73 recreate |
| Phase 4 route JavaScript          | 238,195 B raw / 63,135 B gzip — PASS                |
| GPU frame time                    | Declared unavailable; no synthetic number           |

## Owner checklist status

| Operation              | Observed result                                                           | Status |
| ---------------------- | ------------------------------------------------------------------------- | ------ |
| Orbit Camera           | History generation advances, samples reset, then return to 16/Sleeping    | PASS   |
| Adjust Roughness       | Material Dirty event wakes and reaccumulates without resource churn       | PASS   |
| Replace Texture        | History resets; warmed resource cache remains bounded                     | PASS   |
| Explicit History reset | Generation advances and accumulation restarts                             | PASS   |
| Start / stop animation | Interactive RAF persists only while active; stop reaccumulates and sleeps | PASS   |
| Resize                 | Surface resizes, resets, restores, and sleeps                             | PASS   |
| Device Lost / recover  | 73 → 0 → 73 resources with an explicit unavailable Surface while lost     | PASS   |
| Dispose / recreate     | 73 → 0 → 73 resources with no runtime errors                              | PASS   |
| Fixed visual           | Temporal PBR surface and diagnostics pass direct review and regression    | PASS   |

The same operations are encoded in `tests/e2e/online-pages.spec.ts` for public `/phase-4/` and
`/latest/` execution after merge.

## Known limitations

- GPU timestamp duration is not exposed through the public diagnostics contract and remains
  `NOT_AVAILABLE`.
- Asset-loading timing is not applicable until Phase 6; the route uses deterministic generated
  material and Environment data.
- WebGL2 cross-backend rendering begins in Phase 10 and is not falsely claimed here.
- Dynamic Shadows and screen-space AO begin in Phase 5.

## Acceptance conclusion

The reviewed source passes automated verification, Technical QA, deterministic visual review,
performance/resource budgets, and the owner operation rubric. Phase 4 remains
**Owner Acceptance Passed — Deployment Pending** until the final Head, merge, public deployment,
online Chromium/WebGPU sequence, and immutable accepted tag all succeed.
