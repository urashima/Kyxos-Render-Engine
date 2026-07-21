# Phase 02 Acceptance — Scene, Camera, Geometry, and Basic Rendering

- **Evidence status:** Automated verification, technical QA, and autonomous owner evidence review complete
- **Phase status:** Owner Acceptance Passed; GitHub Pages deployment and public verification pending
- **Branch:** `agent/phase-02-scene-camera`
- **Pull request:** [#3](https://github.com/urashima/Kyxos-Render-Engine/pull/3)
- **Reviewed checkpoint:** `390b1ecc3bfb1e94c5155470b6abec7b1fc4202c`
- **CI run:** [29854505862](https://github.com/urashima/Kyxos-Render-Engine/actions/runs/29854505862) — PASS
- **Evidence generated:** 2026-07-21 10:55 PDT

This document proves the Phase 2 implementation scope defined by `DEVELOPMENT_PLAN.md` and `PHASE_ACCEPTANCE_PLAN.md`. It deliberately does **not** claim `Phase Accepted`: the evidence-pack head must pass, PR #3 must merge, GitHub Pages must deploy, the public routes must pass Chromium/WebGPU interaction checks, and `phase-02-accepted` must resolve to that deployed main commit.

## Acceptance surface

The independent Playground route `/acceptance/phase-02` imports only the public SDK. It composes Scene, Camera, Geometry, Visibility, Renderer, and the private WebGPU backend without exposing native GPU objects.

The route visibly and interactively exercises:

- Plane, Cube, UV Sphere, and validated Custom tetrahedron Geometry;
- a Root → Child Scene Graph and parent Transform dirty propagation;
- pointer-drag Orbit, wheel/button dolly, and automatic Scene framing;
- Frustum/layer/hidden/disabled visibility decisions;
- stable opaque and far-to-near transparent Render Queues;
- Renderer-owned Mesh, Uniform, Pipeline, depth Texture, and Surface resources;
- dirty-only frame submission, Device Lost recovery, disposal, and recreation;
- FPS, CPU Frame Time, Draw Calls, GPU timing availability, memory, and queue diagnostics.

## Required deliverables

| Requirement                     | Evidence                                                                             | Result |
| ------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| Scene Graph and Transform Dirty | Root/Child hierarchy, deep-tree/unit coverage, parent move/rotate browser operations | PASS   |
| Camera, Orbit, and framing      | Reference math, pointer drag, wheel/button dolly, fitted visible cluster             | PASS   |
| Plane / Cube / Sphere / Custom  | Exact per-Geometry triangle counts and directly inspected Scene capture              | PASS   |
| Frustum and layer visibility    | Offscreen hierarchy changes visible/Draw counts from 6 to 4 and back                 | PASS   |
| Opaque / Transparent queues     | 4 opaque + 2 transparent; reported `Glass Far → Glass Near`; order swap              | PASS   |
| Scene GPU submission            | 6 Draws, 690 triangles, 2,070 submitted vertices, depth and alpha pipelines          | PASS   |
| Resource lifecycle              | DPR 2: 25 / 7,658,788 B ready; counts/bytes zero after loss/disposal; exact recovery | PASS   |
| Independent SDK Demo            | Lazy Phase 2 route and isolated Pages `/phase-2/` artifact                           | PASS   |

## Automated results

The authoritative command is:

```bash
pnpm verify
```

GitHub Actions Run `29854505862`, job `88715390559`, passed the complete pipeline at the reviewed checkpoint. The machine-readable record is [`test-results/phase-02/automated-summary.json`](../../../test-results/phase-02/automated-summary.json).

| Gate                  | Result | Evidence                                                                |
| --------------------- | ------ | ----------------------------------------------------------------------- |
| Format / lint         | PASS   | Prettier and zero-warning ESLint                                        |
| Strict types          | PASS   | Packages, tests, Playground, and both Playwright configurations         |
| Unit / integration    | PASS   | 31 files / 136 tests                                                    |
| Dependency boundaries | PASS   | Zero cycles/violations; deliberate forbidden fixture rejected           |
| Shader validation     | PASS   | Two exact WGSL mirrors plus real browser compilation                    |
| Build                 | PASS   | 12 packages and 1 independent application                               |
| Bundle budget         | PASS   | 208,453 B raw / 97,066 B gzip complete output                           |
| Pages artifact        | PASS   | Isolated Phase 0/1/2 and `latest` builds with closed asset paths        |
| Browser acceptance    | PASS   | 10 / 10; 3 real Phase 2 WebGPU flows                                    |
| Visual regression     | PASS   | Full page and Scene Canvas; 0 differing pixels                          |
| CPU frame time        | PASS   | p95 2.9 ms against 16.7 ms                                              |
| Static-to-sleep       | PASS   | p95 61.1 ms against 250 ms                                              |
| Resource lifecycle    | PASS   | DPR 2: 25 / 7,658,788 B ready; 0 / 0 after loss/dispose; exact recovery |

The reviewed technical evidence is in [`TECHNICAL_QA.md`](./TECHNICAL_QA.md), and the autonomous owner review is in [`OWNER_ACCEPTANCE.md`](./OWNER_ACCEPTANCE.md).

## Architecture evidence

[`test-results/phase-02/dependency-graph.json`](../../../test-results/phase-02/dependency-graph.json) records the verified graph. Math is dependency-free. Geometry depends only on Math. Scene owns hierarchy but cannot import Renderer. Visibility consumes Camera/Geometry/Scene contracts and emits backend-neutral Render Items. Renderer owns GPU resources and consumes those items. The SDK is the only concrete-backend composition root.

Native `GPUDevice`, `GPUQueue`, `GPUCanvasContext`, Buffer, Texture, Bind Group, Pipeline, and Command Encoder objects remain private to `@kyxos/render-backend-webgpu`. Scene and Geometry retain no GPU objects.

## Visual evidence

The canonical environment is Chrome Headless Shell 149.0.7827.55 (Playwright Chromium v1228) with SwiftShader on GitHub Actions Ubuntu 24.04.4, viewport 1440 × 1000, DPR 1, dark scheme, bundled Inter, and animation disabled. Only wall-clock and timing glyphs are hidden during capture; their behavior and numeric records remain asserted.

| Reference                                                         | Current                                                       | Difference                                                          | Scene                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| [reference.png](../../../visual-baselines/phase-02/reference.png) | [current.png](../../../visual-baselines/phase-02/current.png) | [difference.png](../../../visual-baselines/phase-02/difference.png) | [scene.png](../../../visual-baselines/phase-02/scene.png) |

Reference and Current have identical SHA-256 `54ab5abb306a6cfd1acbe5488f9fd724a45a1bc960bf08a5515f20070dc14142`; the absolute Difference is 0 pixels. The independently captured Scene has SHA-256 `75a126186da2136835c2c6adb13f877a2a379b8ea0182a77ce7341fc971f1f1e`. Runs `29852642508`, `29853253312`, and `29854505862` produced byte-identical images.

Direct inspection confirmed that the four required Geometry types and both transparent objects are distinguishable, the Sphere is not stretched, depth occlusion is coherent, framing retains the complete Scene, and no clipping, black frame, or obvious normal reversal remains.

## Performance and resource evidence

[`benchmarks/phase-02/summary.json`](../../../benchmarks/phase-02/summary.json) compares Phase 2 with `phase-01-accepted` without hiding the increased Scene workload.

| Metric                                   | Result                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| CPU Scene submission, 10 samples         | median 0.5 ms; p95/max 2.9 ms — PASS                                               |
| Static-to-sleep, 10 samples              | median 42.0 ms; p95/max 61.1 ms — PASS                                             |
| Phase 1 CPU p95 comparison               | 2.3 → 2.9 ms; six Draws plus Scene/queue/depth work; still below 16.7 ms           |
| Phase 1 sleep p95 comparison             | 59.9 → 61.1 ms; +2.003%; still below 250 ms                                        |
| Draw / triangles / vertices              | 6 / 690 / 2,070                                                                    |
| Meshes / objects / pipelines / materials | 4 / 6 / 2 / 4                                                                      |
| Ready resources / Buffer / depth memory  | 25 / 6,948 B / 2,271,360 B                                                         |
| DPR 2 lifecycle memory                   | 7,658,788 B ready; 0 after Device Lost/Dispose; exact recovery — PASS              |
| Phase 2 route                            | 125,160 B raw / 37,668 B gzip JavaScript; 185,176 / 89,642 B total — PASS          |
| GPU frame time                           | Declared unavailable; adapter capability present, query instrumentation not public |
| Asset load time                          | Not applicable until Phase 6                                                       |

The CPU metric measures Renderer feature execution and command submission with a monotonic clock. It is not mislabeled as GPU execution or presentation time.

## Owner checklist status

| Operation                       | Evidence                                                                     | Status |
| ------------------------------- | ---------------------------------------------------------------------------- | ------ |
| Cycle every basic Geometry      | Plane 2, Cube 12, Sphere 224, Custom 4 triangles, then complete Scene        | PASS   |
| Drag, zoom, and rotate Camera   | Pointer drag, wheel/button dolly, Orbit controls, and automatic framing      | PASS   |
| Modify parent Transform         | Parent rotation increments frame; hierarchy move culls both parent and child | PASS   |
| Move objects outside Frustum    | Visible/Draw 6 → 4; Frustum-culled 1 → 3; restore reverses it                | PASS   |
| Change transparent order        | Glass distances swap and far-to-near diagnostics update predictably          | PASS   |
| Inspect Draw and visible counts | Live HUD and machine record agree at 6 / 6 baseline                          | PASS   |

Owner Acceptance Passed — Deployment Pending. These same operations are encoded in `tests/e2e/online-pages.spec.ts` and must execute against the public `/phase-2/` and `/latest/` routes after merge.

## Known limitations

- Phase 2 uses deterministic normal-direction shading; PBR/IBL material fidelity begins in Phase 3.
- GPU timestamp instrumentation is not exposed even though the canonical adapter reports `timestamp-query`; no synthetic GPU duration is claimed.
- Generated Geometry avoids asset I/O; glTF, compressed textures, and asset-load timing begin in Phase 6.
- WebGL2 cross-backend rendering begins in Phase 10.

## Continuous deployment gate

The repository builds isolated historical Playgrounds at `/phase-0/`, `/phase-1/`, `/phase-2/`, and `/latest/`. The post-merge `Deploy accepted Playgrounds` workflow must deploy them to GitHub Pages, prove public reachability, run Chromium/WebGPU interactions on every route, and only then allow the immutable `phase-02-accepted` tag.

Current deployment status: **PENDING**. Phase 2 is not Accepted while this status remains pending.

## Acceptance conclusion

Phase 2 passes automated verification, technical QA, canonical visual review, performance/resource budgets, and autonomous owner evidence review at checkpoint `390b1ecc3bfb1e94c5155470b6abec7b1fc4202c`. Require the evidence-pack head and final freeze head to pass, merge PR #3, deploy GitHub Pages, pass all public interactions, and verify `phase-02-accepted` at the deployed main commit before changing the Phase status to Accepted.
