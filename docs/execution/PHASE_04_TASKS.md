# Phase 04 Tasks — Temporal Scheduling, Dynamic TAA, and Static Accumulation

Phase status: **Phase Accepted — Post-Acceptance Tuning Hotfix Deployment Pending**
Branches: `agent/phase-04-temporal`, `agent/phase-04-public-verification`, `agent/phase-04-taa-tuning-panel`
Pull requests: `#7`, `#10`, `#13`
Base: accepted Phase 3 source `6b3331251fd1a20257aeebab26a72c2f26103f0a`
Accepted source: `a1b004d4e7862873c653478af528201a898f906b`
Accepted tag: `phase-04-accepted`

This file is the authoritative Phase 4 task ledger. Detailed checkpoint history, Commit SHAs, CI Runs,
and Artifact digests remain in [`WORK_LOG.md`](./WORK_LOG.md); acceptance proof remains under
[`docs/acceptance/phase-04/`](../acceptance/phase-04/). Research rationale remains consolidated in
[`phase-04-temporal-state-contract.md`](../research/phase-04-temporal-state-contract.md).

| ID    | Task                                                                                                        | Depends on        | Verification                                                                                                           | Status         |
| ----- | ----------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------- |
| P4-01 | Add owner-scoped Temporal History and opt-in Interactive → Stabilizing → Accumulating → Sleeping scheduling | Phase 3 Accepted  | Deterministic scheduler transitions, dirty coalescing, convergence, suspension, and owner isolation                    | Completed      |
| P4-02 | Add deterministic Halton jitter and Current/Previous temporal Camera matrix tracking                        | P4-01             | Fixed sample vectors, unjittered canonical Camera, generation/reset and prior-matrix tests                             | Completed      |
| P4-03 | Freeze Dynamic TAA neighborhood clamp, depth/normal rejection, and responsive weighting CPU/WGSL parity     | P4-02             | Accepted/rejected branches and float32 WebGPU compute/readback parity                                                  | Completed      |
| P4-04 | Add validated offscreen Color attachments and owner-scoped `rgba16float` Dynamic TAA GPU History            | P4-01,P4-03       | Attachment validation, atomic Resize, Device Lost restoration, and exact resource release                              | Completed      |
| P4-05 | Add deterministic Current-Depth Camera reprojection to Previous jittered View-Projection                    | P4-02,P4-03       | Stationary/moving/rejected/background CPU/WGSL reference parity                                                        | Completed      |
| P4-06 | Add ordered MRT and complete Current plus resolved Color/Depth/Normal ping-pong target ownership            | P4-04,P4-05       | Ordered format/count validation, whole-set role swaps, rollback, Resize, recovery, and disposal                        | Completed      |
| P4-07 | Implement sampled Dynamic TAA Resolve using Current and prior Color/Depth/Normal History                    | P4-03,P4-05,P4-06 | Native MRT → Resolve submissions; accepted, depth-rejected, and normal-rejected GPU pixels                             | Completed      |
| P4-08 | Add opt-in forward PBR temporal MRT output while preserving the accepted direct Surface path                | P4-06,P4-07       | Exact owner/extent validation, separate HDR/Normal Pipelines, SDK composition, native cube evidence                    | Completed      |
| P4-09 | Add final Present pass with Exposure, Khronos PBR Neutral, and exactly one linear-to-sRGB conversion        | P4-07,P4-08       | Real Canvas submission, CPU/GPU output parity, single Surface ownership, zero-resource cleanup                         | Completed      |
| P4-10 | Add owner-scoped Static Accumulation running mean, sample/error convergence, and complete reset semantics   | P4-07,P4-09       | CPU/WGSL parity, native multi-frame readback, convergence, invalidation, Resize, recovery, disposal                    | Completed      |
| P4-11 | Orchestrate PBR MRT → Dynamic TAA → optional Static Accumulation → Present → atomic commit/cancel           | P4-08,P4-09,P4-10 | Real Scheduler/WebGPU mode sequence, ordered draw counts, failure cancellation, exact lifecycle                        | Completed      |
| P4-12 | Expose public Temporal PBR lifecycle, acceptance Playground, deterministic evidence, and online freeze      | P4-11             | SDK-only route, zero-diff visual, bounded lazy resources, Phase 0–4/Latest public operations, immutable accepted tag   | Completed      |
| P4-13 | Expose complete live Dynamic TAA tuning through the public SDK and Phase 4 Pages panel                      | P4-12             | Seven parameters, four presets, History-only resets, unchanged GPU resources, local/public E2E, exact Pages deployment | In Development |

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
- The verified source is committed and the append-only WORK_LOG checkpoint is synchronized.
- The final user-authored governance Head must pass the standard read-only CI before PR #13 may be
  marked ready or merged.
- P4-13 remains In Development until exact Pages deployment exposes the panel on `/phase-4/` and
  `/latest/`, and the public online gate verifies the controls through WebGPU.

## Required boundaries

- The accepted source and immutable `phase-04-accepted` tag are not rewritten or moved.
- Accepted TAA defaults and frozen CPU/WGSL reference tolerances remain unchanged.
- Parameter changes reset History through the public SDK without recreating GPU Pipelines, Bind Groups,
  the Canvas Surface, or the Renderer.
- The accepted Phase 3 direct Surface path remains the default and is not rewritten.
- Temporal output remains opt-in; Present remains the sole Canvas Surface owner in temporal mode.
- Phase 5 feature development remains isolated in Draft PR #12 while this public tuning hotfix is verified.
