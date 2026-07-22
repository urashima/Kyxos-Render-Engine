# Phase 03 Owner Acceptance

- **Status:** Owner Acceptance Passed — Deployment Pending
- **Reviewed checkpoint:** `7e4abe7a625769cc830ee8db8d419fea8243c3ad`
- **Pull request:** [#5](https://github.com/urashima/Kyxos-Render-Engine/pull/5)
- **Reviewed CI:** [29917288982](https://github.com/urashima/Kyxos-Render-Engine/actions/runs/29917288982)
- **Evidence-pack CI:** [29918823067](https://github.com/urashima/Kyxos-Render-Engine/actions/runs/29918823067), job `88918945110` — PASS
- **Method:** Autonomous evidence review with mechanical operations and direct canonical-image inspection
- **Reviewed:** 2026-07-22 04:58 PDT

## Conclusion

The reviewed Phase 3 checkpoint passes the complete Basic PBR and IBL owner rubric. The fixed
Gallery exposes every required material/color/output case, the public controls take effect without
resource churn, the visual result is product-usable, and loss/disposal paths are exact.

This is a deployment-pending conclusion. It does not mark Phase 3 Accepted and does not authorize
an accepted tag before public deployment and online verification succeed.

## Required Phase 3 operations

| Operation                          | Observed evidence                                                           | Status |
| ---------------------------------- | --------------------------------------------------------------------------- | ------ |
| Adjust Metallic                    | 0.50 → 0.85 renders once; resource count stays 88                           | PASS   |
| Adjust Roughness                   | 0.50 → 0.20 renders once; resource count stays 88                           | PASS   |
| Rotate HDRI                        | 0° → 90° changes the reflected studio direction without Pipeline churn      | PASS   |
| Switch Normal Y                    | Y-up → Y-down changes Tangent-space orientation                             | PASS   |
| Toggle AO                          | On → off changes only the indirect contribution                             | PASS   |
| Adjust Exposure                    | 0 → +1 EV applies before Tone Mapping and sRGB output                       | PASS   |
| Toggle Tone Mapping                | PBR Neutral → clamp uses the same bounded Pipeline set                      | PASS   |
| Compare fixed glTF PBR reference   | Full page and Gallery each match the frozen reference with 0 changed pixels | PASS   |
| Orbit and wake                     | Camera buttons and render-once return to Sleeping                           | PASS   |
| Device Lost / recover              | 88 → 0 → 88 Handles; 8,988,312 → 0 → 8,988,312 B at DPR 2                   | PASS   |
| Dispose / recreate / final dispose | 88 → 0 → 88 → 0 Handles with exact bytes                                    | PASS   |

## General acceptance checklist

| Check                               | Evidence                                                                    | Status |
| ----------------------------------- | --------------------------------------------------------------------------- | ------ |
| Page opens normally                 | Independent `/acceptance/phase-03`; WebGPU ready and Shader pass            | PASS   |
| Phase functionality is visible      | 20-sphere fixed matrix exposes every required Phase 3 contract              | PASS   |
| Controls take effect immediately    | Every Material, Environment, Camera, and output change increments one frame | PASS   |
| Refresh / Resize / DPR              | Standard route startup plus DPR 2 lifecycle and 390 px overflow gate        | PASS   |
| No sustained console errors         | All three Gallery browser flows retain an empty error list                  | PASS   |
| Visual result has no obvious defect | No reversed Roughness, cube blocks, seams, clipping, or black frame         | PASS   |
| Performance meets budget            | CPU p95 3.9 ms; dirty-to-sleep p95 168.1 ms                                 | PASS   |
| Error path is understandable        | Lost, Recover, Dispose, and Recreate states are explicit                    | PASS   |
| Playground is independent           | Route imports only the public SDK; no Texture Lab or UI framework           | PASS   |

## Direct visual review

The canonical full-page and Gallery images were inspected at native dimensions. The review found:

- a stable left-to-right Metallic response with decreasing diffuse and increasing colored
  Specular response;
- a stable sharp-to-broad Roughness response;
- distinct white dielectric, Gold, Copper, and Iron surfaces;
- visible Normal-Y, indirect AO, Emission, sRGB Base Color, and linear Metallic-Roughness cases;
- continuous cyan/warm studio reflections without cube-face boundaries;
- coherent Sphere silhouettes, framing, spacing, and responsive layout.

The first face-constant reference attempt was rejected rather than frozen. Only the corrected
continuous-light source and its byte-identical verification are accepted as evidence.

## Fixed visual comparison

| Surface   | Reference hash                                                     | Current hash                                                       | Changed pixels |
| --------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------- |
| Full page | `71c6dac046d44b8bc979a4063ad348ced19692e82c2599c250d4513b44e33151` | `71c6dac046d44b8bc979a4063ad348ced19692e82c2599c250d4513b44e33151` | 0              |
| Gallery   | `91885ac007899f5845193847b4637a836f56f8633e79cca8f8bef76e77a19967` | `91885ac007899f5845193847b4637a836f56f8633e79cca8f8bef76e77a19967` | 0              |

## Performance and resource review

- Ten CPU samples: 1.9 ms median, 3.9 ms p95/max against 16.7 ms.
- Ten dirty-to-sleep samples: 101.2 ms median, 168.1 ms p95/max against 250 ms.
- Fixed workload: 20 Draw Calls, 10,560 triangles, 20 Materials, 12 Pipelines, one GPU Mesh.
- Continuous controls do not replace the 88 active GPU Handles.
- DPR 2 Device Lost and disposal both reach zero active Handles and zero estimated bytes.
- Recovery and recreation return to exactly 88 Handles and 8,988,312 estimated bytes.

## Public deployment operations

`tests/e2e/online-pages.spec.ts` encodes the same material, Environment, output, Orbit,
Device-Lost, recovery, disposal, and recreation sequence. After merge it must pass on both public
`/phase-3/` and `/latest/` against the exact deployed commit SHA.

Current public deployment status: **PENDING**.

## Blocking defects

No blocking defects remain in the reviewed source checkpoint.

## Remaining gates

1. The final provenance Head passes the complete CI pipeline.
2. PR #5 merges to `main` without Head drift.
3. The verified main commit deploys to GitHub Pages.
4. Public `/phase-3/` and `/latest/` pass the full Chromium/WebGPU interaction sequence.
5. The post-deployment workflow creates immutable `phase-03-accepted` at the deployed merge commit.

Until all five succeed, the authoritative state remains **Owner Acceptance Passed — Deployment
Pending**, not `Phase Accepted`.
