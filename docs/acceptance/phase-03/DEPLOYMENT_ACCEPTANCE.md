# Phase 03 Deployment Acceptance

- **Status:** Phase Accepted
- **Accepted source:** `6b3331251fd1a20257aeebab26a72c2f26103f0a`
- **Accepted tag:** `phase-03-accepted`
- **Source pull request:** [#5](https://github.com/urashima/Kyxos-Render-Engine/pull/5) — MERGED
- **Final PR-head verification:** [Run 29919316277](https://github.com/urashima/Kyxos-Render-Engine/actions/runs/29919316277) — PASS
- **Public workflow chain:** Main verification → Build → Deploy → Public Chromium/WebGPU verification → Freeze — PASS
- **Verified:** 2026-07-22 05:35 PDT

This record completes the deployment-only gates that intentionally remained pending in the frozen
Phase 3 implementation, technical-QA, and owner-evidence pack. It does not replace or mutate the
canonical numerical, visual, performance, lifecycle, or autonomous owner evidence.

## Fail-closed workflow proof

The immutable `phase-03-accepted` tag was created by the repository's
`Freeze deployed accepted phase` workflow and resolves to the exact Phase 3 merge commit. The
workflow can run only after `Deploy accepted Playgrounds` completes successfully on `main`.
Deployment can complete only after all of these jobs pass:

| Gate                       | Required result                           | Result |
| -------------------------- | ----------------------------------------- | ------ |
| Main Phase verification    | Success on exact merge Head               | PASS   |
| Build accepted history     | Phases 0–3, `latest=3`                    | PASS   |
| Deploy public Playground   | GitHub Pages deployment                   | PASS   |
| Wait for public routes     | Every declared route returns successfully | PASS   |
| Verify public interactions | Pinned Chromium and real WebGPU suite     | PASS   |
| Create immutable tag       | Post-deployment target equals merge Head  | PASS   |

The tag did not exist immediately after merge and was observed only after this complete workflow
chain finished. It was not created manually.

## Public acceptance surface

| Route                                                              | Workflow result |
| ------------------------------------------------------------------ | --------------- |
| [Root](https://urashima.github.io/Kyxos-Render-Engine/)            | PASS            |
| [Latest](https://urashima.github.io/Kyxos-Render-Engine/latest/)   | PASS            |
| [Phase 0](https://urashima.github.io/Kyxos-Render-Engine/phase-0/) | PASS            |
| [Phase 1](https://urashima.github.io/Kyxos-Render-Engine/phase-1/) | PASS            |
| [Phase 2](https://urashima.github.io/Kyxos-Render-Engine/phase-2/) | PASS            |
| [Phase 3](https://urashima.github.io/Kyxos-Render-Engine/phase-3/) | PASS            |

The public interaction job checked out the accepted merge commit, verified the embedded Commit
SHA, installed the pinned Playwright Chromium, and exercised the Phase 3 route only after public
deployment and route reachability succeeded.

## Public Phase 3 operation proof

The online suite executed the same owner operations frozen before merge:

- 20 Draw Calls, 10,560 triangles, 20 visible objects, one GPU Mesh, 12 Pipelines, and 20 Materials;
- Metallic and Roughness controls with stable resource ownership;
- Exposure +1 EV and HDRI rotation to 90 degrees;
- Normal Y-down, AO off, and clipped Tone Mapping;
- Orbit-left and Orbit-right dirty-only renders returning to Sleeping;
- Device Lost with zero resources, exact recovery, disposal with zero resources, and exact
  recreation;
- no console or page errors on public `/phase-3/` and `/latest/`.

## Immutable tag proof

`phase-03-accepted` resolves to exactly:

```text
6b3331251fd1a20257aeebab26a72c2f26103f0a
```

The resolved target is identical to the merge commit for PR #5 and the source deployed by the
successful Pages workflow.

## Conclusion

Phase 3 satisfies the development plan, complete Phase 3 rubric, source/evidence/final CI gates,
technical QA, autonomous owner checklist, public deployment, online Chromium/WebGPU interaction
verification, and immutable freeze requirements. Phase 4 may begin from the accepted source after
this documentation closure is merged.
