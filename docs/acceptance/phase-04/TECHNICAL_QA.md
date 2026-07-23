# Phase 04 Technical QA

- **Status:** Technical QA Passed
- **Source commit:** `d11b1e4c18722d7aaf4e950b53085e9ac2d12e03`
- **Pull request:** [#7](https://github.com/urashima/Kyxos-Render-Engine/pull/7)
- **Verified:** 2026-07-23 01:35 PDT

## Conclusion

Phase 4 passes source Technical QA. Pinned Chromium creates a real WebGPU adapter/device, compiles
all fourteen canonical WGSL modules, executes the CPU/GPU temporal parity gates, submits native
MRT → TAA → Static Accumulation → Present frames, and completes the public route lifecycle with no
runtime errors.

The exact CI, job, Artifact, digest, and gate inventory are frozen in
[`automated-summary.json`](../../../test-results/phase-04/automated-summary.json). This result does
not mark the Phase Accepted; public deployment and online verification remain mandatory.

## Gate review

| Gate                         | Evidence                                                       | Result |
| ---------------------------- | -------------------------------------------------------------- | ------ |
| Clean install                | Frozen lockfile and pinned Node/pnpm/Playwright                | PASS   |
| Format / lint / strict types | Complete repository gate with zero warnings                    | PASS   |
| Unit and integration         | 62 files / 275 tests                                           | PASS   |
| Package graph                | Zero cycles/violations; negative fixture rejected              | PASS   |
| Shader                       | Fourteen exact mirrors and browser compiler diagnostics        | PASS   |
| Temporal numerical parity    | Reprojection, TAA Resolve, Present, and Static Accumulation    | PASS   |
| Native orchestration         | PBR MRT → Resolve → Static → Present with atomic commit/cancel | PASS   |
| Build and bundle             | Standalone app and every Phase route within budget             | PASS   |
| Browser                      | 33 / 33 pinned Chromium/WebGPU cases                           | PASS   |
| Canonical visual             | Zero pixels above threshold with zero allowed                  | PASS   |
| Performance                  | CPU p95 1.2 ms; Static-to-sleep p95 3827.2 ms                  | PASS   |
| Resources                    | Exact zero after loss/disposal and exact restoration           | PASS   |

## Architecture and ownership

- Core retains backend-neutral Handles; native GPU objects stay in the concrete WebGPU Backend.
- Camera depends downward on Temporal only for the public jitter/reprojection contract.
- Renderer owns Dynamic TAA targets, Static Accumulation, and Present resources; SDK remains the
  only concrete composition root.
- Dynamic and Static Histories have distinct owner IDs and commit only successful frame results.
- Present is the sole temporal Canvas Surface owner. The accepted Phase 3 direct path is unchanged.
- The injected Scheduler driver is the only RAF boundary; Sleeping has no pending callback.
- Device Lost and disposal release complete graphs; recovery/recreation reconstruct exact counts.
- The Playground route imports only the public SDK and has no Texture Lab or UI-framework coupling.

## Numerical review

- Camera reprojection frozen cases match exactly under a `0.00001` tolerance.
- Dynamic TAA CPU/WGSL reference cases remain below `0.000001`.
- Native sampled TAA Resolve accepts History or rejects it by Depth/Normal as expected; maximum
  float16 error is `0.000107421875...`, below `0.001`.
- Present applies Exposure, Khronos PBR Neutral, and one sRGB conversion with exact reference
  pixels; the Surface path owns one Canvas Surface.
- Static running mean produces `[0.5, 0.5, 0.416748046875, 1]`; maximum float16 error is
  `0.000081380208...`, below `0.002`.
- Native orchestration records three Draws / fourteen Triangles before Static accumulation and
  four Draws / fifteen Triangles while accumulating, then reaches Sleeping at 2/2.

## Performance and lifecycle

- Eight settled CPU samples have 0.6 ms median and 1.2 ms p95/max against 16.7 ms.
- Eight complete sixteen-sample wake/reset operations have 3661.2 ms median and 3827.2 ms p95/max
  against the explicit 10000 ms SwiftShader budget.
- The public route has 73 active resources at rest, allows two bounded warmed Texture resources,
  and returns to 73 after the second replacement.
- Device Lost and disposal reach zero active resources synchronously; recovery and recreation
  return exactly to 73.
- Native pipeline disposal has 81 created and 81 destroyed Handles with zero active bytes.
- Phase 4 route JavaScript is 238,195 B raw / 63,135 B gzip, below 256 KiB / 80 KiB.

## Declared unavailable or pending

- GPU timestamp duration: unavailable through the public Phase 4 diagnostics contract.
- Asset-load timing: not applicable until Phase 6.
- WebGL2 cross-backend image: not applicable until Phase 10.
- Public GitHub Pages verification: pending until the verified candidate merges to `main`.

No blocking numerical, rendering, interaction, lifecycle, performance, or architecture defect
remains in the reviewed source checkpoint.
