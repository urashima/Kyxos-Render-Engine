# Phase 05 Tasks — Shadows, AO, and Standard Post-Processing

Phase status: **In Development**  
Branch: `agent/phase-05-lighting-postfx`  
Pull request: `#12`  
Base: accepted Phase 4 source `a1b004d4e7862873c653478af528201a898f906b`

This file is the authoritative Phase 5 task ledger. Detailed checkpoint history, Commit SHAs, CI Runs,
and Artifact digests remain in [`WORK_LOG.md`](./WORK_LOG.md). Research rationale is consolidated in:
[`phase-05-lighting-shadow-postfx-contract.md`](../research/phase-05-lighting-shadow-postfx-contract.md).

| ID    | Task                                                                                                       | Depends on       | Verification                                                                                              | Status         |
| ----- | ---------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------- | -------------- |
| P5-01 | Freeze Lighting/Shadow/PostFX boundaries, quality matrix, Temporal resets, and Phase 5 acceptance contract | Phase 4 Accepted | One consolidated contract, package/dependency rules, quality tiers, Dirty/History rules, fail-closed plan | Completed      |
| P5-02 | Add backend-portable Directional/Spot Light contracts and Scene-owned deterministic light registry         | P5-01            | Descriptor validation, stable ordering, layer masks, mutation versions, ownership/disposal, boundaries    | In Development |
| P5-03 | Add Shadow Feature contracts, atlas allocation, render-graph resources, and complete lifecycle             | P5-02            | Portable commands, deterministic atlas layout, Resize/Device Lost/disposal and resource accounting        | Planned        |
| P5-04 | Implement Directional Shadow Map, PCF, Bias/Normal Bias, quality resolution, and Ground Shadow             | P5-03            | CPU/WGSL sampling oracle, real WebGPU depth pass, acne/peter-panning fixtures, quality tiers              | Planned        |
| P5-05 | Implement Spot Shadow Map with cone/range fitting and deterministic shadow selection                       | P5-03,P5-04      | Projection/frustum parity, real WebGPU evidence, layer masks, disabled/no-shadow paths                    | Planned        |
| P5-06 | Implement stabilized Cascaded Shadow Maps with splits, texel snapping, blending, and quality tiers         | P5-04            | Stable-motion fixtures, cascade selection/blend parity, bounded resources, Temporal compatibility         | Planned        |
| P5-07 | Add plugin-oriented PostFX Core chain with declared inputs/outputs, toggles, scale, and quality levels     | P5-01            | Dependency ordering, independent enable/disable, resource aliasing/lifecycle, no Renderer Core coupling   | Planned        |
| P5-08 | Implement GTAO with depth/normal inputs, quality tiers, denoise, and Temporal-safe invalidation            | P5-06,P5-07      | CPU/WGSL reference parity, real WebGPU pass, no TAA ghosting, independent toggle                          | Planned        |
| P5-09 | Implement HDR Bloom with threshold/knee, downsample/upsample pyramid, and bounded quality levels           | P5-07            | Energy/threshold fixtures, resource pyramid lifecycle, independent toggle and performance budget          | Planned        |
| P5-10 | Implement Depth of Field with deterministic focus model, blur tiers, and Temporal integration              | P5-07            | Near/far/focus fixtures, depth-edge protection, stable reset rules, independent toggle                    | Planned        |
| P5-11 | Implement Color Grading/LUT and Sharpen with explicit color-space/output ordering                          | P5-07            | CPU/WGSL parity, LUT identity/reference fixtures, single output encode, independent toggles               | Planned        |
| P5-12 | Expose Phase 5 public Playground, diagnostics, quality controls, evidence, deployment, and accepted tag    | P5-02–P5-11      | SDK-only operations, visual/performance/resource gates, public Pages verification, immutable tag          | Planned        |

## Required boundaries

- Lighting owns portable light data only; native GPU objects remain in Backend/Render Feature owners.
- Shadow implementation is an independent registered Feature, not hard-coded across every PBR Shader.
- PostFX declares resources and ordering through its extension contract; it does not mutate Scene state.
- Every pass has explicit quality, color-space, resolution, Temporal History, and WebGL2 capability metadata.
- Accepted Phase 0–4 routes, default direct PBR path, Temporal scheduling, and frozen baselines remain unchanged.
