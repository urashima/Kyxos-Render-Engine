# Phase 03 Acceptance — Basic PBR and IBL

- **Evidence status:** Automated verification, technical QA, and autonomous owner evidence review complete
- **Phase status:** Phase Accepted; post-deployment evidence is recorded in [`DEPLOYMENT_ACCEPTANCE.md`](./DEPLOYMENT_ACCEPTANCE.md)
- **Branch:** `agent/phase-03-pbr-ibl`
- **Pull request:** [#5](https://github.com/urashima/Kyxos-Render-Engine/pull/5)
- **Reviewed checkpoint:** `7e4abe7a625769cc830ee8db8d419fea8243c3ad`
- **GitHub Actions Run `29917288982`:** PASS
- **Evidence-pack Run:** [29918823067](https://github.com/urashima/Kyxos-Render-Engine/actions/runs/29918823067), job `88918945110` — PASS
- **Evidence generated:** 2026-07-22 04:58 PDT

This document preserves the immutable pre-deployment Phase 3 candidate required by
`DEVELOPMENT_PLAN.md` and `PHASE_ACCEPTANCE_PLAN.md`. At that checkpoint it deliberately did not
claim `Phase Accepted`: the final provenance Head had to pass, PR #5 had to merge, GitHub Pages had
to deploy, the public Phase 3 routes had to pass real Chromium/WebGPU interaction checks, and
`phase-03-accepted` had to be created only after that successful deployment. Those remaining gates
subsequently passed and are frozen separately in [`DEPLOYMENT_ACCEPTANCE.md`](./DEPLOYMENT_ACCEPTANCE.md).

## Acceptance surface

The independent Playground route `/acceptance/phase-03` imports only `@kyxos/render-sdk`. It
composes the public PBR Canvas lifecycle over Scene, Camera, Geometry, Material, Environment,
Renderer, Frame Scheduler, and the private WebGPU Backend without exposing native GPU objects.

The fixed 20-sphere Gallery visibly and interactively exercises:

- Metallic values 0, 0.25, 0.5, 0.75, and 1;
- Roughness values 0.05, 0.25, 0.5, 0.75, and 1;
- white dielectric, gold, copper, iron, and one continuously adjustable material;
- tangent-space Normal Y-up/Y-down, indirect-only AO, and sRGB Emission;
- sRGB Base Color versus linear Metallic-Roughness inputs;
- continuous HDR studio Diffuse Irradiance and complete prefiltered GGX Specular mips;
- split-sum BRDF LUT, HDRI rotation, EV Exposure, Khronos PBR Neutral, and clipped output;
- Orbit controls, dirty-only rendering, Device Lost recovery, disposal, and recreation.

## Required deliverables

| Requirement                   | Evidence                                                                          | Result |
| ----------------------------- | --------------------------------------------------------------------------------- | ------ |
| Metallic-Roughness BRDF       | CPU/WGSL GGX, Smith, Schlick, energy allocation, and real float32 readback        | PASS   |
| Material and texture contract | Immutable factors, UV transforms, sRGB/linear semantics, stable cache identities  | PASS   |
| Normal / AO / Emission        | Tangent handedness, asset Normal-Y metadata, indirect-only AO, sRGB Emission      | PASS   |
| Diffuse and Specular IBL      | Deterministic Hammersley oracle, Irradiance, prefiltered GGX mips, split-sum LUT  | PASS   |
| Environment lifecycle         | Three Textures, two Samplers, complete mips, shared leases, loss/recovery/dispose | PASS   |
| HDR output                    | Linear composition, EV Exposure, PBR Neutral or clamp, exactly one sRGB encode    | PASS   |
| Fixed material Gallery        | 20 Spheres, one shared GPU Mesh, 12 bounded Pipelines, complete Phase 3 rubric    | PASS   |
| Public SDK lifecycle          | Automatic Dirty Events, sleep/wake, ownership, diagnostics, and zero cleanup      | PASS   |
| Independent SDK Demo          | Lazy Phase 3 route and isolated Pages `/phase-3/` candidate                       | PASS   |

## Automated results

The authoritative command is:

```bash
pnpm verify
```

GitHub Actions Run `29917288982`, job `88914018637`, passed the complete source pipeline. Artifact
`8528484011` was independently downloaded and inspected before freezing this evidence. The
machine-readable summary is
[`test-results/phase-03/automated-summary.json`](../../../test-results/phase-03/automated-summary.json).
Evidence-pack Run `29918823067` then passed the same pipeline with the fail-closed Phase 3 Schema
enabled; Artifact `8529093758` retained all ten Phase 3 numerical records and byte-identical
Gallery visuals.

| Gate                  | Result | Evidence                                                                |
| --------------------- | ------ | ----------------------------------------------------------------------- |
| Format / lint         | PASS   | Prettier and zero-warning ESLint                                        |
| Strict types          | PASS   | Packages, tests, Playground, and both Playwright configurations         |
| Unit / integration    | PASS   | 45 files / 201 tests                                                    |
| Dependency boundaries | PASS   | Zero cycles/violations; deliberate forbidden fixture rejected           |
| Shader validation     | PASS   | Seven exact WGSL mirrors plus real browser compilation                  |
| Build                 | PASS   | 15 packages and one independent application                             |
| Bundle budget         | PASS   | 299,459 B raw / 123,673 B gzip complete output                          |
| Pages artifact        | PASS   | Isolated Phase 0/1/2/3 plus `latest` candidate builds                   |
| Browser acceptance    | PASS   | 21 / 21; 12 Phase 3 WebGPU cases including three Gallery flows          |
| Visual regression     | PASS   | Full page and Gallery Canvas; both have 0 differing pixels              |
| CPU frame time        | PASS   | p95/max 3.9 ms against 16.7 ms                                          |
| Static-to-sleep       | PASS   | p95/max 168.1 ms against 250 ms                                         |
| Resource lifecycle    | PASS   | DPR 2: 88 / 8,988,312 B ready; 0 / 0 after loss/dispose; exact recovery |

The reviewed technical evidence is in [`TECHNICAL_QA.md`](./TECHNICAL_QA.md), and the autonomous
owner review is in [`OWNER_ACCEPTANCE.md`](./OWNER_ACCEPTANCE.md).

## Architecture evidence

[`test-results/phase-03/dependency-graph.json`](../../../test-results/phase-03/dependency-graph.json)
records the verified graph. Material Core depends only on Core; Material PBR depends only on Core
and Material Core; Environment depends only on Core. Renderer consumes backend-neutral contracts
and never imports the concrete WebGPU package. SDK remains the sole concrete composition root.

Native `GPUDevice`, `GPUQueue`, `GPUCanvasContext`, Texture, Texture View, Sampler, Bind Group,
Pipeline, and Command Encoder objects remain private to `@kyxos/render-backend-webgpu`. Materials,
Textures, Environment Sources, Meshes, and public diagnostics contain no native GPU objects.

## Numerical rendering evidence

The retained browser Artifact contains every Phase 3 numerical gate, not only the Gallery:

| Contract                        | Real WebGPU evidence                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Direct GGX BRDF                 | 12 float32 compute values match the CPU reference                                |
| Direct PBR Renderer             | Pixel `[151, 73, 42, 255]` exactly matches the CPU oracle                        |
| Base Color / Metallic-Roughness | Pixel `[175, 99, 84, 64]` exactly matches sRGB/linear factor sampling            |
| Normal Y / Emission             | Y-up `[41,33,25,255]`, Y-down `[0,0,0,255]`, Emission `[13,28,255,255]`          |
| Split-sum IBL                   | 16 float32 outputs pass; meaningful maximum error is approximately `0.000006641` |
| Environment resources           | Complete Cube/LUT sampling pixel `[64, 112, 84, 255]`                            |
| Renderer indirect IBL and AO    | Pixel `[36, 31, 15, 255]`; AO affects only indirect light                        |
| Exposure / PBR Neutral / sRGB   | HDR pixel `[254, 224, 207, 255]` exactly matches the CPU output oracle           |

All WGSL compilation-message arrays are empty. The prior direct-only Shaders remain frozen
alongside the IBL and tone-mapped variants, so later functionality does not erase earlier parity
evidence.

## Visual evidence

The canonical environment is Chrome Headless Shell 149.0.7827.55 (Playwright Chromium v1228) with
SwiftShader on GitHub Actions Ubuntu 24.04, viewport 1440 × 1100, DPR 1, dark scheme, bundled Inter,
and animation disabled. Timing and commit glyphs are hidden only during capture; their behavior and
machine records remain asserted.

| Surface   | Reference                                                         | Current                                                                       | Difference                                                                          |
| --------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Full page | [reference.png](../../../visual-baselines/phase-03/reference.png) | [current.png](../../../visual-baselines/phase-03/current.png)                 | [difference.png](../../../visual-baselines/phase-03/difference.png)                 |
| Gallery   | [gallery.png](../../../visual-baselines/phase-03/gallery.png)     | [gallery-current.png](../../../visual-baselines/phase-03/gallery-current.png) | [gallery-difference.png](../../../visual-baselines/phase-03/gallery-difference.png) |

Reference and Current are hash-identical at
`71c6dac046d44b8bc979a4063ad348ced19692e82c2599c250d4513b44e33151`; the Gallery pair is
hash-identical at `91885ac007899f5845193847b4637a836f56f8633e79cca8f8bef76e77a19967`.
Both absolute Difference images contain zero non-black pixels.

The first Run `29916418182` was explicitly rejected because a face-constant Cubemap produced blocky
reflections. The corrected continuous studio source Run `29916911020` and verification Run
`29917288982` are byte-identical. Direct inspection confirms clear continuous reflections,
Metallic and Roughness directions, distinct white/gold/copper/iron materials, visible special-case
rows, and no cube-face blocks, clipping, seams, or black frame.

## Performance and resource evidence

[`benchmarks/phase-03/summary.json`](../../../benchmarks/phase-03/summary.json) compares Phase 3 with
`phase-02-accepted` without hiding the increased 20-object PBR/IBL workload.

| Metric                             | Result                                                               |
| ---------------------------------- | -------------------------------------------------------------------- |
| CPU Gallery submission, 10 samples | median 1.9 ms; p95/max 3.9 ms — PASS                                 |
| Dirty-to-sleep, 10 samples         | median 101.2 ms; p95/max 168.1 ms — PASS                             |
| Draw / triangles / visible         | 20 / 10,560 / 20                                                     |
| GPU Meshes / objects / Pipelines   | 1 / 20 / 12                                                          |
| DPR 1 resources                    | 88 active Handles / 2,743,112 estimated bytes                        |
| DPR 2 lifecycle                    | 8,988,312 B ready; 0 after loss/dispose; exact recovery and recreate |
| Phase 3 route                      | 180,095 B raw / 53,209 B gzip JavaScript — PASS                      |
| GPU frame time                     | Declared unavailable; timestamp capability is not exposed publicly   |
| Asset load time                    | Not applicable until Phase 6                                         |

CPU time measures Renderer feature execution and command submission with a monotonic clock. It is
not mislabeled as GPU execution or presentation time.

## Owner checklist status

| Operation                             | Evidence                                                             | Status |
| ------------------------------------- | -------------------------------------------------------------------- | ------ |
| Adjust Metallic and Roughness         | Live controls render once, sleep, and retain all 88 resources        | PASS   |
| Rotate HDRI                           | 0° → 90° changes reflection direction without Pipeline churn         | PASS   |
| Switch Normal Y                       | Y-up → Y-down updates Tangent-space orientation                      | PASS   |
| Toggle AO                             | On → off changes only the indirect contribution                      | PASS   |
| Adjust Exposure and Tone Mapping      | 0 → +1 EV and Neutral → clamp follow the frozen output order         | PASS   |
| Compare fixed glTF PBR reference      | Full page and Gallery match both frozen references at 0 pixels       | PASS   |
| Orbit, loss/recover, dispose/recreate | Interaction stays dirty-only; resource graph returns exactly or zero | PASS   |

Owner Acceptance Passed — Deployment Pending. These operations are also encoded in
`tests/e2e/online-pages.spec.ts` and must execute against public `/phase-3/` and `/latest/` routes
after merge.

## Known limitations

- The deterministic studio Environment is generated in memory; HDR panorama and glTF asset I/O
  arrive with Phase 6 and are not falsely claimed here.
- The Gallery freezes the opaque forward PBR quality target. Alpha Mask/Blend Pipeline contracts
  and unit coverage exist, but a separate transparent visual gallery is outside this Phase rubric.
- GPU timestamp duration is not exposed through the public diagnostics contract; no synthetic GPU
  time is reported.
- Dynamic shadows and screen-space AO begin in Phase 5. Phase 3 AO is the material occlusion map and
  intentionally affects only indirect light.
- WebGL2 cross-backend rendering begins in Phase 10.

## Continuous deployment gate

The candidate Pages artifact contains historical `/phase-0/`, `/phase-1/`, `/phase-2/`,
`/phase-3/`, and `/latest/` routes. After merge, `Deploy accepted Playgrounds` must deploy the exact
verified main commit, prove public reachability, and run the complete Phase 3 control/lifecycle
sequence in Chromium/WebGPU. Only the successful deployment may trigger the immutable
`phase-03-accepted` tag.

Deployment status at the reviewed evidence checkpoint: **PENDING**.

Phase 3 is not Accepted while this status remains pending.

The required gates subsequently passed; see
[`DEPLOYMENT_ACCEPTANCE.md`](./DEPLOYMENT_ACCEPTANCE.md) for the accepted merge source, public route
proof, online operations, and immutable Tag.

## Acceptance conclusion

Phase 3 passed source automated verification, technical QA, canonical visual review,
performance/resource budgets, and autonomous owner evidence review at checkpoint
`7e4abe7a625769cc830ee8db8d419fea8243c3ad`; evidence-pack Head
`bc3faa5ffac5d04837ba04f2382cc43bc5819d38` and final provenance Head
`b5a83cb9721c90f743184f50228f102e0ec9a5be` also passed. PR #5 then merged as
`6b3331251fd1a20257aeebab26a72c2f26103f0a`, public Pages and online interactions passed, and
`phase-03-accepted` was frozen at that exact merge source. Phase 3 is Accepted.
