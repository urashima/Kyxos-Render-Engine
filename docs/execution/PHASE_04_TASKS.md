# Phase 04 Tasks — Temporal Scheduling, Dynamic TAA, and Static Accumulation

Phase status: **Deployment Pending**  
Branch: `agent/phase-04-public-verification`  
Pull request: `#10`  
Base: accepted Phase 3 source `6b3331251fd1a20257aeebab26a72c2f26103f0a`

This file is the authoritative Phase 4 task ledger. It records scope, dependencies, verification, and
status only. Detailed checkpoint history, Commit SHAs, CI Runs, and Artifact digests remain in
[`WORK_LOG.md`](./WORK_LOG.md). Research rationale is consolidated in one Phase 4 document:
[`phase-04-temporal-state-contract.md`](../research/phase-04-temporal-state-contract.md).

| ID    | Task                                                                                                        | Depends on        | Verification                                                                                                                           | Status         |
| ----- | ----------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| P4-01 | Add owner-scoped Temporal History and opt-in Interactive → Stabilizing → Accumulating → Sleeping scheduling | Phase 3 Accepted  | Deterministic scheduler transitions, dirty coalescing, convergence, suspension, and owner isolation                                    | Completed      |
| P4-02 | Add deterministic Halton jitter and Current/Previous temporal Camera matrix tracking                        | P4-01             | Fixed sample vectors, unjittered canonical Camera, generation/reset and prior-matrix tests                                             | Completed      |
| P4-03 | Freeze Dynamic TAA neighborhood clamp, depth/normal rejection, and responsive weighting CPU/WGSL parity     | P4-02             | Accepted/rejected branches and float32 WebGPU compute/readback parity                                                                  | Completed      |
| P4-04 | Add validated offscreen Color attachments and owner-scoped `rgba16float` Dynamic TAA GPU History            | P4-01,P4-03       | Attachment validation, atomic Resize, Device Lost restoration, and exact resource release                                              | Completed      |
| P4-05 | Add deterministic Current-Depth Camera reprojection to Previous jittered View-Projection                    | P4-02,P4-03       | Stationary/moving/rejected/background CPU/WGSL reference parity                                                                        | Completed      |
| P4-06 | Add ordered MRT and complete Current plus resolved Color/Depth/Normal ping-pong target ownership            | P4-04,P4-05       | Ordered format/count validation, whole-set role swaps, rollback, Resize, recovery, and disposal                                        | Completed      |
| P4-07 | Implement sampled Dynamic TAA Resolve using Current and prior Color/Depth/Normal History                    | P4-03,P4-05,P4-06 | Native MRT → Resolve submissions; accepted, depth-rejected, and normal-rejected GPU pixels                                             | Completed      |
| P4-08 | Add opt-in forward PBR temporal MRT output while preserving the accepted direct Surface path                | P4-06,P4-07       | Exact owner/extent validation, separate HDR/Normal Pipelines, SDK composition, native cube evidence                                    | Completed      |
| P4-09 | Add final Present pass with Exposure, Khronos PBR Neutral, and exactly one linear-to-sRGB conversion        | P4-07,P4-08       | Real Canvas submission, CPU/GPU output parity, single Surface ownership, zero-resource cleanup                                         | Completed      |
| P4-10 | Add owner-scoped Static Accumulation running mean, sample/error convergence, and complete reset semantics   | P4-07,P4-09       | CPU/WGSL parity, native multi-frame readback, convergence, invalidation, Resize, recovery, disposal                                    | Completed      |
| P4-11 | Orchestrate PBR MRT → Dynamic TAA → optional Static Accumulation → Present → atomic commit/cancel           | P4-08,P4-09,P4-10 | Real Scheduler/WebGPU mode sequence, ordered draw counts, failure cancellation, exact lifecycle                                        | Completed      |
| P4-12 | Expose public Temporal PBR Canvas lifecycle and independent Phase 4 acceptance Playground                   | P4-11             | SDK-only route, deterministic post-animation reset, reviewed zero-diff visual, lazy-resource lifecycle, fail-closed local/public gates | In Development |

## Deployment and acceptance gate

P4-12 implementation and pre-deployment evidence are complete. The visual gate now rebuilds one fixed
public state after animation so a variable RAF count cannot leak into the frozen screenshot. P4-12
remains **In Development** and Phase 4 remains **Deployment Pending** until all of the following are
true:

- the deterministic visual and final implementation Heads passed the complete pinned CI gate;
- PR #7 merged with expected-Head protection as `43d510a12341cafd6cb1aeb917252d93f222b33f`;
- GitHub Pages deployed that exact merge source and independent Run `30004176537` passed Phase 0–4 plus Latest Chromium/WebGPU operations;
- PR #10 merges the corrected online contract for Phase 4 Temporal HUD and lazy/recovered resource watermarks;
- the PR #10 merge source passes main CI, Pages redeployment, and the built-in public operation gate;
- immutable `phase-04-accepted` targets the deployed accepted source.

## Required boundaries

- The accepted Phase 3 direct Surface path remains the default and is not rewritten.
- Temporal output is opt-in; Present is the sole Canvas Surface owner in temporal mode.
- Dynamic and Static History are independent owners with atomic commit/cancel and explicit reset causes.
- Renderer Core contains no global permanent RAF; browser scheduling stays behind the injected driver.
- No Phase 4 acceptance, deployment, or tag may be claimed before the complete public gate passes.
