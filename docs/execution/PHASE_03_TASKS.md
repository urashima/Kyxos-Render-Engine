# Phase 03 Tasks — Basic PBR, IBL, and HDR Output

Phase status: **Phase Accepted**  
Branch: `agent/phase-03-pbr-ibl`  
Pull request: `#5`  
Accepted source: `6b3331251fd1a20257aeebab26a72c2f26103f0a`  
Accepted tag: `phase-03-accepted`

This file is the authoritative Phase 3 task ledger. Detailed checkpoint history, Commit SHAs, CI Runs,
and Artifact digests remain in [`WORK_LOG.md`](./WORK_LOG.md); acceptance proof remains under
[`docs/acceptance/phase-03/`](../acceptance/phase-03/).

| ID    | Task                                                                                                       | Depends on       | Verification                                                                                      | Status    |
| ----- | ---------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- | --------- |
| P3-01 | Define immutable Material Core/PBR contracts, color spaces, texture semantics, feature keys, and ownership | Phase 2 Accepted | Public package boundaries, lifecycle tests, glTF-aligned semantics, SDK-only consumer             | Completed |
| P3-02 | Freeze GGX/Smith/Schlick metallic-roughness BRDF CPU/WGSL parity                                           | P3-01            | Float32 WebGPU compute/readback parity and deterministic reference vectors                        | Completed |
| P3-03 | Add direct-light metallic-roughness PBR rendering, bounded variants, GPU cache ownership, and recovery     | P3-01,P3-02      | Exact GPU pixel oracle, pipeline/cache transition tests, loss/recovery and zero-resource disposal | Completed |
| P3-04 | Bind sampled sRGB Base Color and linear Metallic-Roughness maps with UV transforms                         | P3-03            | Distinct texel selection, transfer-function parity, stable pipeline ownership                     | Completed |
| P3-05 | Add deterministic tangents, Normal-Y metadata, tangent-space Normal, and sRGB Emission                     | P3-04            | Tangent/handedness tests plus exact Normal Y-up/Y-down and Emission GPU pixels                    | Completed |
| P3-06 | Build deterministic Diffuse Irradiance, GGX Specular Prefilter, and BRDF LUT CPU/WGSL IBL oracle           | P3-02,P3-05      | Hammersley sampling and split-sum CPU/GPU parity under frozen tolerances                          | Completed |
| P3-07 | Implement Environment identity, Cubemap/LUT GPU resource sharing, mip lifecycle, recovery, and disposal    | P3-06            | Complete face/mip uploads, lease identity tests, atomic restore, exact cleanup                    | Completed |
| P3-08 | Bind indirect IBL, roughness LOD, indirect-only AO, environment rotation, and intensity                    | P3-07            | CPU/GPU final-pixel parity with nontrivial AO, LUT, rotation, intensity, and direct light         | Completed |
| P3-09 | Add deterministic HDR Exposure, Khronos PBR Neutral/clipped Tone Mapping, and one sRGB encode              | P3-08            | CPU/WGSL output-transform parity and exact `rgba8unorm` readback                                  | Completed |
| P3-10 | Expose the public PBR Canvas lifecycle and fixed interactive 20-sphere acceptance gallery                  | P3-09            | SDK-only route, controls, visual snapshots, diagnostics, lifecycle, performance, and bundle gates | Completed |
| P3-11 | Freeze automated evidence, Technical QA, autonomous Owner Acceptance, and deployment candidate             | P3-10            | Fail-closed Phase 3 checker, canonical images, performance/resource reports, final PR-head CI     | Completed |
| P3-12 | Merge exact verified source, deploy public Phase 0–3 Playgrounds, verify online WebGPU, and freeze tag     | P3-11            | Public `/phase-3/` and `/latest/`, online operation suite, immutable `phase-03-accepted` target   | Completed |

## Required boundaries

- Material packages do not depend on Renderer, Scene, Backend implementations, DOM, or Texture Lab.
- Native GPU resources remain inside the WebGPU backend; public APIs expose only portable contracts.
- Direct Phase 2 rendering and its accepted baselines remain unchanged.
- Environment, material, texture, renderer, and SDK ownership have explicit Device Lost and Dispose paths.
- HDR panorama/glTF asset loading, shadows, screen-space AO, and WebGL2 parity remain later-phase scope.

## Final acceptance

- PR #5 merged as `6b3331251fd1a20257aeebab26a72c2f26103f0a`.
- Public Phase 0–3 and `latest=3` verification passed.
- `phase-03-accepted` resolves exactly to the deployed accepted source.
