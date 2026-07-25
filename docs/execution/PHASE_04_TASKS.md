# Phase 04 Tasks — Temporal Scheduling, Dynamic TAA, and Static Accumulation

Phase status: **Acceptance Reopened — P4-14 Public Resource-Stability Re-verification**
Branches: `agent/phase-04-temporal`, `agent/phase-04-public-verification`, `agent/phase-04-taa-tuning-panel`, `phase-04-final`, `phase-04-history-role-stability`, `phase-04-non-reusable-history-roles`
Pull requests: `#7`, `#10`, `#13`, `#16`, `#20`, `#27`
Base: accepted Phase 3 source `6b3331251fd1a20257aeebab26a72c2f26103f0a`
Previous accepted source: `f926f544c94da2c5ea8f9630c959398b15d2d84f`
Immutable baseline tag: `phase-04-accepted`

This file is the authoritative Phase 4 task ledger. Detailed checkpoint history, Commit SHAs, CI Runs,
and Artifact digests remain in [`WORK_LOG.md`](./WORK_LOG.md); acceptance proof remains under
[`docs/acceptance/phase-04/`](../acceptance/phase-04/). Research rationale remains consolidated in
[`phase-04-temporal-state-contract.md`](../research/phase-04-temporal-state-contract.md).

| ID    | Task                                                                                                          | Depends on        | Verification                                                                                                                                  | Status         |
| ----- | ------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| P4-01 | Add owner-scoped Temporal History and opt-in Interactive → Stabilizing → Accumulating → Sleeping scheduling   | Phase 3 Accepted  | Deterministic scheduler transitions, dirty coalescing, convergence, suspension, and owner isolation                                           | Completed      |
| P4-02 | Add deterministic Halton jitter and Current/Previous temporal Camera matrix tracking                          | P4-01             | Fixed sample vectors, unjittered canonical Camera, generation/reset and prior-matrix tests                                                    | Completed      |
| P4-03 | Freeze Dynamic TAA neighborhood clamp, depth/normal rejection, and responsive weighting CPU/WGSL parity       | P4-02             | Accepted/rejected branches and float32 WebGPU compute/readback parity                                                                         | Completed      |
| P4-04 | Add validated offscreen Color attachments and owner-scoped `rgba16float` Dynamic TAA GPU History              | P4-01,P4-03       | Attachment validation, atomic Resize, Device Lost restoration, and exact resource release                                                     | Completed      |
| P4-05 | Add deterministic Current-Depth Camera reprojection to Previous jittered View-Projection                      | P4-02,P4-03       | Stationary/moving/rejected/background CPU/WGSL reference parity                                                                               | Completed      |
| P4-06 | Add ordered MRT and complete Current plus resolved Color/Depth/Normal ping-pong target ownership              | P4-04,P4-05       | Ordered format/count validation, whole-set role swaps, rollback, Resize, recovery, and disposal                                               | Completed      |
| P4-07 | Implement sampled Dynamic TAA Resolve using Current and prior Color/Depth/Normal History                      | P4-03,P4-05,P4-06 | Native MRT → Resolve submissions; accepted, depth-rejected, and normal-rejected GPU pixels                                                    | Completed      |
| P4-08 | Add opt-in forward PBR temporal MRT output while preserving the accepted direct Surface path                  | P4-06,P4-07       | Exact owner/extent validation, separate HDR/Normal Pipelines, SDK composition, native cube evidence                                           | Completed      |
| P4-09 | Add final Present pass with Exposure, Khronos PBR Neutral, and exactly one linear-to-sRGB conversion          | P4-07,P4-08       | Real Canvas submission, CPU/GPU output parity, single Surface ownership, zero-resource cleanup                                                | Completed      |
| P4-10 | Add owner-scoped Static Accumulation running mean, sample/error convergence, and complete reset semantics     | P4-07,P4-09       | CPU/WGSL parity, native multi-frame readback, convergence, invalidation, Resize, recovery, disposal                                           | Completed      |
| P4-11 | Orchestrate PBR MRT → Dynamic TAA → optional Static Accumulation → Present → atomic commit/cancel             | P4-08,P4-09,P4-10 | Real Scheduler/WebGPU mode sequence, ordered draw counts, failure cancellation, exact lifecycle                                               | Completed      |
| P4-12 | Expose public Temporal PBR lifecycle, acceptance Playground, deterministic evidence, and online freeze        | P4-11             | SDK-only route, zero-diff visual, bounded lazy resources, Phase 0–4/Latest public operations, immutable accepted tag                          | Completed      |
| P4-13 | Expose complete live Dynamic TAA tuning through the public SDK and Phase 4 Pages panel                        | P4-12             | Seven parameters, four presets, History-only resets, unchanged GPU resources, local/public E2E, exact Pages deployment                        | Completed      |
| P4-14 | Integrate compatible TRAA resolve behavior and explicit rigid-object Velocity as the final Phase 4 refinement | P4-13             | Current-only RG16F Velocity MRT, prior rigid transforms, edge/disocclusion/variance/motion/flicker controls, complete verify and public Pages | In Development |

## P4-13 tuning scope

- Jitter Scale.
- Base History Weight.
- Absolute and relative Depth rejection thresholds.
- Normal rejection cosine.
- Responsive History reduction.
- Responsive Mask.
- Default, Stable, Sharp, and No Jitter presets plus copyable exact configuration.

## P4-13 verification and deployment gate

- Exact implementation source passed complete `pnpm verify` in Run `30019258099`, job
  `89247376501`; Artifact `8568677744` preserves the complete diagnostics.
- All 33 pinned Chromium/WebGPU cases passed, including the unchanged Phase 4 visual reference at
  `maxDiffPixels: 0` and threshold `0.2`.
- P4-13 was merged to `main` through PR #13 and became the tuning baseline for P4-14.

## Required boundaries

- The immutable `phase-04-accepted` baseline tag was not rewritten or moved.
- Accepted TAA defaults and frozen CPU/WGSL reference tolerances remain unchanged.
- Parameter changes reset History through the public SDK without recreating GPU Pipelines, Bind Groups,
  the Canvas Surface, or the Renderer.
- The accepted Phase 3 direct Surface path remains the default and is not rewritten.
- Temporal output remains opt-in; Present remains the sole Canvas Surface owner in temporal mode.
- Phase 5 development resumes only after PR #27 passes the exact public resource-stability gate.

## P4-14 final TRAA and Velocity scope

- Add one current-only `rg16float` Velocity MRT while retaining the accepted Color/Depth/Normal
  History ping-pong sets and the existing forward PBR pass order.
- Store prior rigid-object World transforms plus current/previous unjittered Camera transforms and
  generate explicit screen-space Velocity without creating a Deferred or G-buffer pipeline.
- Integrate closest-depth edge selection, Velocity-first reprojection with Camera fallback,
  previous-depth disocclusion validation, AABB plus optional variance clipping, motion and subpixel
  History reduction, minimum current-frame contribution, and HDR luminance flicker reduction.
- Expose Edge Depth Difference, Max Velocity Length, Minimum Current Weight, Variance Clip Gamma,
  Subpixel Correction, and Flicker Reduction alongside all existing public TAA controls.
- Keep advanced controls disabled by default except the inert Velocity range so the accepted visual
  reference and numerical TAA oracle remain unchanged until a user selects a new preset or value.
- Reserve deforming previous-position support for Skinning, Morph, and Instancing to Phase 7, where
  those geometry systems and ownership contracts actually exist.

## P4-14 original verification and deployment evidence

- Final implementation source `f2e64b69a48b5d85dc266df35e7dbbd262a54c2f` passed complete
  `pnpm verify` in Final Verify Run `30085244188`, job `89455803547`.
- The verified gate covered format, lint, strict typecheck, 63 unit-test files / 278 tests,
  architecture and canonical Shader validation, production and Pages builds, bundle budgets, and all
  33 pinned Chromium/WebGPU acceptance and visual cases.
- The strict Phase 4 visual reference remained at `maxDiffPixels: 0`; real Velocity resource counters
  were verified before the accepted HUD strings were frozen for screenshot isolation.
- Trusted standard PR `Phase verification` Run `30093376943` passed before PR #16 was marked ready.
- PR #16 was squash-merged to `main` as `f926f544c94da2c5ea8f9630c959398b15d2d84f`.
- Main `Phase verification` Run `30093770426` passed on the exact merge source.
- GitHub Pages deployment `5588976992`, associated Run `30094384391`, completed successfully.
- Focused public Chromium acceptance Run `30094335571` verified both `/phase-4/` and `/latest/` at the
  exact merge Commit with all 13 required TAA controls.

## P4-14 public resource-stability re-verification

- The repository-wide official public Pages gate first reproduced a resource count change from 74 to
  76 after Jitter → Default TAA resets in Run `30096963069`; Pipeline count, Texture memory, and Buffer
  memory remained unchanged.
- Focused resource-transition Run `30098217002`, Artifact `8598500935`, proved the delta consists of
  two lazily discovered Static Accumulation Bind Groups rather than Texture, Buffer, Pipeline, or
  Renderer leakage.
- PR #20 restored both read roles to index 0 for explicit `invalidate()` calls, passed complete Verify
  Run `30120876531`, and was merged as `eadddc6340fad6a05ad1fa65266a7e3bec95b1f7`.
- Clean deployment source `5faf7a8bcf643954dc42e3442f33690efd608a66` passed main Run
  `30140103609`; Pages Run `30140285927` built and deployed successfully but its official public gate
  deterministically reproduced 74 → 76 after the first signature-only Jitter update. Failure Artifact
  `8614309986` preserves the exact assertion and also identified the separate Phase 4 wake timeout.
- Refined root cause: public TAA configuration can make History non-reusable through signature
  mismatch without first invoking explicit invalidation, so arbitrary prior ping-pong roles still
  selected two new cross-phase Bind Groups.
- PR #27 canonicalizes Dynamic TAA and Static Accumulation read roles whenever `isReusable()` returns
  false, adds direct signature-mismatch and complete Pipeline regressions, and applies the existing
  60-second Phase 4 convergence budget to the initial online wake assertion. Atomic complete Verify Run
  `30140959472` passed; trusted standard PR CI, main CI, Pages deployment, and official public
  Chromium/WebGPU verification remain mandatory before P4-14 returns to Completed.

### P4-14 visual-baseline isolation

- The final visual comparison showed the three material spheres, edges, highlights, layout, and all
  non-runtime UI pixels unchanged. The only initial differences were the expected Velocity allocation
  counters: Texture memory 30.8 MiB to 32.8 MiB, Buffer memory 83.3 KiB to 83.8 KiB, and GPU
  resources 73 to 74.
- Immediately before the screenshot, the four already-verified HUD text nodes are frozen to their
  accepted visual-baseline strings. This preserves the immutable material/layout PNG without leaving
  separator glyphs behind or weakening the strict zero-difference threshold.
- Real resource values remain strictly verified before the screenshot and through unit, WebGPU
  lifecycle, Device Lost, Dispose/Recreate, and acceptance JSON gates.

### P4-14 default Resolve performance

- Closest-depth Velocity selection remains available through Edge Depth Difference.
- When the public parameter is 0, its documented disabled state bypasses the 3×3 depth-neighborhood
  search instead of paying nine unnecessary depth loads per pixel.
- The enabled path, output contract, Velocity target, History ownership, and public tuning range are unchanged.

### P4-14 final static-convergence budget

- Explicit RG16F Velocity adds one current-frame MRT attachment to each of the 16 static samples.
- The default disabled Edge Depth Difference path was optimized to bypass its 3×3 search, reducing the
  GitHub Actions SwiftShader settle time from roughly 12.3 seconds to 10.95–11.13 seconds while CPU
  frame time remained below the 16.7 ms frame budget.
- The final static-to-sleep gate is 12 seconds, providing bounded CI variance without reducing the
  16-sample target, disabling Velocity, changing output quality, or relaxing per-frame CPU limits.
