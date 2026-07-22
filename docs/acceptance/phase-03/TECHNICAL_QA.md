# Phase 03 Technical QA

- **Status:** Technical QA Passed
- **Source commit:** `7e4abe7a625769cc830ee8db8d419fea8243c3ad`
- **Pull request:** [#5](https://github.com/urashima/Kyxos-Render-Engine/pull/5)
- **CI run:** [29917288982](https://github.com/urashima/Kyxos-Render-Engine/actions/runs/29917288982)
- **CI job:** `88914018637`
- **Artifact:** `8528484011`, digest `sha256:3de59e97312bf7f9432e04c0ac81f9a0a18f5ee12b33fcc8156b21cb1b22a250`
- **Evidence-pack CI:** [29918823067](https://github.com/urashima/Kyxos-Render-Engine/actions/runs/29918823067), job `88918945110` — PASS
- **Verified:** 2026-07-22 04:58 PDT

## Conclusion

Phase 3 passes source technical QA. Official Chromium creates a real WebGPU adapter/device,
compiles every canonical WGSL module, executes CPU/GPU numerical parity gates, samples real
Textures/Cubemaps/LUTs, renders the fixed 20-sphere Gallery, and completes lifecycle, interaction,
performance, and zero-pixel visual gates without console or page errors.

Evidence-pack Run `29918823067` passed with the fail-closed acceptance Schema enabled. Its Artifact
retains the same image hashes and lifecycle values; its independent CPU and dirty-to-sleep p95
samples were 4.3 ms and 175.5 ms, both within their unchanged budgets.

This result does not mark the Phase Accepted. The evidence-pack and final merge Heads must pass,
then GitHub Pages deployment, public Chromium/WebGPU interactions, and the immutable tag must
succeed.

## Automated gate review

| Gate                         | Evidence                                                                | Result |
| ---------------------------- | ----------------------------------------------------------------------- | ------ |
| Clean install                | Frozen lockfile and pinned Node/pnpm/Playwright                         | PASS   |
| Format / lint / strict types | Complete CI gate; zero warnings                                         | PASS   |
| Unit and integration         | 45 files / 201 tests                                                    | PASS   |
| Package graph                | Zero cycles/violations; deliberate negative fixture rejected            | PASS   |
| Shader                       | Seven exact WGSL mirrors and valid browser compiler diagnostics         | PASS   |
| CPU/GPU PBR parity           | BRDF, textures, Normal/Emission, IBL, environment, and output oracles   | PASS   |
| Build                        | 15 packages, standalone Playground, isolated Pages artifacts            | PASS   |
| Bundle                       | Aggregate and every Phase 0/1/2/3 route budget pass                     | PASS   |
| Browser                      | 21 / 21, including 12 Phase 3 WebGPU and 3 Gallery flows                | PASS   |
| Canonical visuals            | Full page and Gallery Canvas; 0 differing pixels across two Runs        | PASS   |
| Performance                  | CPU p95 3.9 ms; dirty-to-sleep p95 168.1 ms                             | PASS   |
| Resources                    | DPR 2: 88 / 8,988,312 B ready; 0 / 0 after loss/disposal; exact restore | PASS   |

## Architecture and ownership review

- Material Core, Material PBR, and Environment retain minimal downward dependencies and no DOM,
  Scene, Renderer, SDK, product, or concrete Backend references.
- Renderer owns GPU Bindings and Pipeline/cache lifecycles through backend-neutral Handles. SDK is
  the only concrete WebGPU composition root.
- Immutable Texture and Environment identities include shape, mip, encoding, and payload checksums;
  replacement is atomic and reference-counted.
- Device Lost destroys all device Handles while retaining logical public objects; recovery
  reconstructs the complete graph. Failed partial creation rolls back.
- Public Renderer disposal is idempotent and returns all active resource counts and estimated bytes
  to zero while preserving explicitly caller-owned registered Materials.
- The Gallery uses only public SDK imports and one immutable shared Mesh for all 20 instances.

## Rendering contract review

- The metallic-roughness equation uses GGX NDF, Smith visibility, Schlick Fresnel, and energy
  allocation with matching CPU/WGSL references.
- Base Color and Emission decode from sRGB; Metallic-Roughness, Normal, AO, HDR Environment, and
  BRDF LUT remain linear.
- Normal reconstruction uses generated `vec4` Tangents and `tangent.w`; Normal-Y correction is
  immutable asset metadata rather than arbitrary Material state.
- Diffuse IBL uses Irradiance times diffuse color divided by pi. Specular IBL uses the prefiltered
  GGX mip chain and split-sum BRDF LUT.
- AO multiplies only indirect Diffuse plus Specular. Direct light and Emission remain unoccluded.
- Output order is linear direct + indirect + Emission, EV Exposure, exactly one Tone Mapping
  operation, and exactly one sRGB encode.

## Visual and rubric review

- Metallic progression visibly removes dielectric diffuse and increases colored specular.
- Roughness progression broadens and softens the fixed Environment reflection in the correct
  direction.
- White dielectric, Gold, Copper, and Iron remain visibly distinct under one fixed light.
- Normal-Y, AO, Emission, sRGB, and linear factor cases are visible in the fixed final row.
- Continuous studio lighting has no cube-face blocks, seams, clipping, black frame, or obvious
  normal reversal.
- The rejected face-constant draft is retained in provenance so the final reference cannot conceal
  the visual correction.

## Performance and lifecycle review

- CPU p95 grows from Phase 2's six-draw 2.9 ms to 3.9 ms for 20 PBR/IBL Draws, but remains below
  the explicit 16.7 ms budget.
- Dirty-to-sleep p95 grows from 61.1 ms to 168.1 ms, but remains below 250 ms and no permanent RAF
  remains active.
- Resource accounting is 88 / 8,988,312 estimated bytes ready at DPR 2, zero counts and bytes after
  Device Lost/disposal, and the exact baseline after recovery/recreation.
- The Phase 3 route stays below its 192 KiB raw / 60 KiB gzip JavaScript budget; every frozen
  earlier-route budget remains unchanged and passes.

## Declared unavailable or pending checks

- GPU timestamp duration: unavailable in the Phase 3 public diagnostics contract.
- Asset-load timing: not applicable until Phase 6.
- WebGL2 cross-backend image: not applicable until Phase 10.
- Public GitHub Pages verification: pending until the accepted candidate merges to `main`.

## Blocking defects

No blocking numerical, rendering, interaction, lifecycle, performance, or architecture defects
remain in the reviewed source checkpoint.

## Remaining acceptance gates

Final provenance Head CI, merge to main, GitHub Pages deployment, public online interaction
verification, and immutable accepted-tag verification remain mandatory.
