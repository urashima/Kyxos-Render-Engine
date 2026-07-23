# Phase 04 Tasks — Temporal Scheduling, Dynamic TAA, and Static Accumulation

Phase status: **Phase Accepted**  
Branches: `agent/phase-04-temporal`, `agent/phase-04-public-verification`  
Pull requests: `#7`, `#10`  
Base: accepted Phase 3 source `6b3331251fd1a20257aeebab26a72c2f26103f0a`  
Accepted source: `a1b004d4e7862873c653478af528201a898f906b`  
Accepted tag: `phase-04-accepted`

This file is the authoritative Phase 4 task ledger. Detailed checkpoint history, Commit SHAs, CI Runs,
and Artifact digests remain in [`WORK_LOG.md`](./WORK_LOG.md); acceptance proof remains under
[`docs/acceptance/phase-04/`](../acceptance/phase-04/).

| ID    | Task                                                                                                        | Depends on        | Verification                                                                                                         | Status    |
| ----- | ----------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- | --------- |
| P4-01 | Add owner-scoped Temporal History and opt-in Interactive → Stabilizing → Accumulating → Sleeping scheduling | Phase 3 Accepted  | Deterministic scheduler transitions, dirty coalescing, convergence, suspension, and owner isolation                  | Completed |
| P4-02 | Add deterministic Halton jitter and Current/Previous temporal Camera matrix tracking                        | P4-01             | Fixed sample vectors, unjittered canonical Camera, generation/reset and prior-matrix tests                           | Completed |
| P4-03 | Freeze Dynamic TAA neighborhood clamp, depth/normal rejection, and responsive weighting CPU/WGSL parity     | P4-02             | Accepted/rejected branches and float32 WebGPU compute/readback parity                                                | Completed |
| P4-04 | Add validated offscreen Color attachments and owner-scoped `rgba16float` Dynamic TAA GPU History            | P4-01,P4-03       | Attachment validation, atomic Resize, Device Lost restoration, and exact resource release                            | Completed |
| P4-05 | Add deterministic Current-Depth Camera reprojection to Previous jittered View-Projection                    | P4-02,P4-03       | Stationary/moving/rejected/background CPU/WGSL reference parity                                                      | Completed |
| P4-06 | Add ordered MRT and complete Current plus resolved Color/Depth/Normal ping-pong target ownership            | P4-04,P4-05       | Ordered format/count validation, whole-set role swaps, rollback, Resize, recovery, and disposal                      | Completed |
| P4-07 | Implement sampled Dynamic TAA Resolve using Current and prior Color/Depth/Normal History                    | P4-03,P4-05,P4-06 | Native MRT → Resolve submissions; accepted, depth-rejected, and normal-rejected GPU pixels                           | Completed |
| P4-08 | Add opt-in forward PBR temporal MRT output while preserving the accepted direct Surface path                | P4-06,P4-07       | Exact owner/extent validation, separate HDR/Normal Pipelines, SDK composition, native cube evidence                  | Completed |
| P4-09 | Add final Present pass with Exposure, Khronos PBR Neutral, and exactly one linear-to-sRGB conversion        | P4-07,P4-08       | Real Canvas submission, CPU/GPU output parity, single Surface ownership, zero-resource cleanup                       | Completed |
| P4-10 | Add owner-scoped Static Accumulation running mean, sample/error convergence, and complete reset semantics   | P4-07,P4-09       | CPU/WGSL parity, native multi-frame readback, convergence, invalidation, Resize, recovery, disposal                  | Completed |
| P4-11 | Orchestrate PBR MRT → Dynamic TAA → optional Static Accumulation → Present → atomic commit/cancel           | P4-08,P4-09,P4-10 | Real Scheduler/WebGPU mode sequence, ordered draw counts, failure cancellation, exact lifecycle                      | Completed |
| P4-12 | Expose public Temporal PBR lifecycle, acceptance Playground, deterministic evidence, and online freeze      | P4-11             | SDK-only route, zero-diff visual, bounded lazy resources, Phase 0–4/Latest public operations, immutable accepted tag | Completed |

## Required boundaries

- The accepted Phase 3 direct Surface path remains the default and is not rewritten.
- Temporal output is opt-in; Present is the sole Canvas Surface owner in temporal mode.
- Dynamic and Static History are independent owners with atomic commit/cancel and explicit reset causes.
- Renderer Core contains no global permanent RAF; browser scheduling stays behind the injected driver.

## Final acceptance

- PR #7 merged the verified implementation as `43d510a12341cafd6cb1aeb917252d93f222b33f`.
- PR #10 merged the hardened public operation contract as `a1b004d4e7862873c653478af528201a898f906b`.
- Public Phase 0–4 and `latest=4` verification passed against that exact deployed source.
- `phase-04-accepted` resolves exactly to the deployed accepted source.
