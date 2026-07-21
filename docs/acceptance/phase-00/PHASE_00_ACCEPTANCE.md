# Phase 00 Acceptance — Repository and Architecture Baseline

- **Evidence status:** Automated verification, technical QA, and owner evidence review complete
- **Phase status:** Owner Acceptance Passed; final CI, merge, and accepted tag pending
- **Branch:** `agent/phase-00-foundation`
- **Pull request:** [#1](https://github.com/urashima/Kyxos-Render-Engine/pull/1)
- **Source checkpoint:** `565ef4f5ed38e3e9bcf61670c2d93b363a0dcfc7`
- **CI run:** [29829946332](https://github.com/urashima/Kyxos-Render-Engine/actions/runs/29829946332)
- **Evidence generated:** 2026-07-21 05:26 PDT

This document proves the Phase 0 deliverables defined by `DEVELOPMENT_PLAN.md` and `PHASE_ACCEPTANCE_PLAN.md`. It does not claim Phase Accepted: the owner-evidence commit's final CI, merge, and accepted tag remain freeze gates.

## Acceptance surface

The independent Vite Playground serves `/acceptance/phase-00` and imports the public SDK plus the development Mock Backend. It contains no Texture Lab, React, Next.js, Zustand, business route, account, billing, database, or analytics dependency.

The surface exposes and tests:

- public SDK initialization;
- backend capability and lifecycle state;
- dirty-driven wake, one-frame render, and return to sleep;
- resource allocation, release, and memory diagnostics;
- simulated device loss and recovery;
- idempotent renderer disposal and zero active-resource baseline;
- the package dependency direction.

## Required deliverables

| Requirement                              | Evidence                                                                                 | Result |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| pnpm Monorepo                            | `pnpm-workspace.yaml`, frozen lockfile, eight workspaces                                 | PASS   |
| TypeScript strict                        | Shared strict configuration plus package, test, and app type checks                      | PASS   |
| ESLint and Prettier                      | Zero-warning lint and formatting gates                                                   | PASS   |
| Vitest                                   | 9 files, 28 tests                                                                        | PASS   |
| Playwright                               | 5 Chromium tests, including refresh/resize/DPR and canonical visual regression           | PASS   |
| GitHub Actions                           | Run `29829543107`, job `88630686057`; complete `pnpm verify` on merge checkout           | PASS   |
| Package boundaries and cycles            | Runtime graph has zero cycles/violations; deliberate Renderer-to-SDK fixture is rejected | PASS   |
| Mock Backend                             | Capability, resource accounting, loss, recovery, and disposal tests                      | PASS   |
| ADR baseline                             | ADR-001 through ADR-005 accepted and mechanically checked                                | PASS   |
| SDK callable from an independent example | SDK-only consumer test and standalone Playground                                         | PASS   |
| All packages independently buildable     | Seven package build scripts pass independently; Playground has its own typecheck/build   | PASS   |

## Automated results

The authoritative command is:

```bash
pnpm verify
```

Local result: **PASS**. The machine-readable record is [`test-results/phase-00/automated-summary.json`](../../../test-results/phase-00/automated-summary.json).

| Gate                  | Result         | Evidence                                       |
| --------------------- | -------------- | ---------------------------------------------- |
| Format                | PASS           | All files formatted                            |
| Lint                  | PASS           | Zero warnings                                  |
| Typecheck             | PASS           | Packages, tests, configuration, Playground     |
| Unit                  | PASS           | 28 / 28                                        |
| Dependency boundaries | PASS           | Zero cycles/violations; negative fixture works |
| Architecture docs     | PASS           | 5 ADRs, 2 architecture documents, valid links  |
| Shader validation     | NOT APPLICABLE | No Phase 0 Shader capability or sources        |
| Build                 | PASS           | 7 packages, 1 application                      |
| Bundle budget         | PASS           | 77,075 B raw; 57,665 B gzip                    |
| Browser acceptance    | PASS           | 5 / 5 local; final owner-evidence CI required  |
| Visual regression     | PASS           | 0 differing pixels                             |
| Static-to-sleep       | PASS           | p95 66.2 ms against 250 ms Phase 0 budget      |
| Pull-request CI       | PASS           | Run `29829946332`; all steps successful        |

Shader validation is deliberately not marked PASS: the current gate reports `NOT_APPLICABLE` and will fail if Shader files appear before a compiler-backed validator is added.

The reviewed technical evidence and applicability decisions are recorded in [`TECHNICAL_QA.md`](./TECHNICAL_QA.md) and [`technical-qa.json`](../../../test-results/phase-00/technical-qa.json).
The autonomous owner review is recorded in [`OWNER_ACCEPTANCE.md`](./OWNER_ACCEPTANCE.md) and [`owner-acceptance.json`](../../../test-results/phase-00/owner-acceptance.json).

## Dependency evidence

[`test-results/phase-00/dependency-graph.json`](../../../test-results/phase-00/dependency-graph.json) records the accepted runtime graph. The graph gate scans manifests and production TypeScript imports, rejects private subpaths and cross-package relatives, detects cycles, and proves its own negative path with an intentional Renderer-to-SDK violation.

No `integration-texture-lab` package exists in Phase 0. Therefore excluding it changes no engine build input; the standalone build and Playground already prove product independence.

## Visual evidence

The screenshot is a 1440 × 1306 full-page Chrome Headless Shell 149.0.7827.55 capture at DPR 1 and dark color scheme on the GitHub Actions Ubuntu 24.04 canonical environment. Animations and transitions are disabled. Only the wall-clock text inside `.event-log time` is hidden during capture; event identity, runtime state, diagnostics, dependency direction, and all controls remain visible.

| Reference                                                         | Current                                                       | Difference                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| [reference.png](../../../visual-baselines/phase-00/reference.png) | [current.png](../../../visual-baselines/phase-00/current.png) | [difference.png](../../../visual-baselines/phase-00/difference.png) |

Reference and Current have identical SHA-256 `f6a82ba78ecba88bff71ad9d103f8942d5fa8a600ea881b6d65244e96084e9d7`. Absolute error is 0 pixels. [`metadata.json`](../../../visual-baselines/phase-00/metadata.json) records dimensions, hashes, capture settings, threshold, and known limitations.

The first remote visual run exposed 2,763 text-edge pixels caused by the original implicit system-font fallback. The corrected page bundles the normal Latin weight-variable Inter v20 subset from `@fontsource-variable/inter@5.2.8`; its source and OFL-1.1 license are recorded in [`THIRD_PARTY_ASSETS.md`](../../assets/THIRD_PARTY_ASSETS.md).

The subsequent official Playwright run exposed the remaining browser-build rasterizer difference: both CI attempts produced the byte-identical canonical hash above, while the network-restricted sandbox Chromium 149.0.7827.0 development reference differed at 2,983 Playwright-thresholded pixels (20,028 pixels by absolute comparison), all confined to glyph antialiasing. The old development reference and [environment Difference](../../../visual-baselines/phase-00/environment-difference.png) are retained as migration evidence. The canonical reference changed because the acceptance plan requires a fixed CI environment, not a sandbox-specific browser build. Both profiles keep a 0-pixel limit against their own versioned reference; no comparison threshold or assertion was weakened.

This is the initial visual baseline. It proves the Phase 0 UI and Mock Backend diagnostics, not GPU-rendered geometry; Phase 1 establishes the first GPU scene baseline.

## Performance and resource evidence

[`benchmarks/phase-00/summary.json`](../../../benchmarks/phase-00/summary.json) is the initial performance baseline. There is no previous accepted tag to compare.

| Metric                         | Result                          |
| ------------------------------ | ------------------------------- |
| Static-to-sleep, 10 samples    | median 16.6 ms; p95/max 66.2 ms |
| Static-to-sleep budget         | 250 ms — PASS                   |
| Draw calls / triangles         | 0 / 0 — Mock Backend baseline   |
| Pipeline count                 | 0 — Mock Backend baseline       |
| Active resources after dispose | 0 — PASS                        |
| Active estimated bytes         | 0 — PASS                        |
| Playground JavaScript          | 20,299 B raw / 6,530 B gzip     |
| Playground font                | 48,256 B raw / 48,254 B gzip    |
| Total Playground output        | 77,075 B raw / 57,665 B gzip    |
| CPU/GPU frame time             | NOT APPLICABLE until Phase 1    |
| Asset load time                | NOT APPLICABLE until Phase 6    |

The browser benchmark measures a user dirty event through frame completion and the UI-observed return to `sleeping`. Unit tests separately prove coalescing, cancellation, device loss, and zero resource deltas.

## Owner checklist status

| Operation                                                      | Evidence                                        | Status |
| -------------------------------------------------------------- | ----------------------------------------------- | ------ |
| Open the Playground                                            | Chromium route and visibility test              | PASS   |
| Confirm no Texture Lab dependency                              | Manifest/source boundary scan                   | PASS   |
| View all CI checks                                             | Runs `29829543107` and `29829946332` inspected  | PASS   |
| View the dependency graph                                      | Versioned JSON graph and architecture document  | PASS   |
| Exclude `integration-texture-lab` and rebuild                  | Package is absent; full standalone build passes | PASS   |
| Import only `@kyxos/render-sdk` from a blank consumer boundary | SDK-only consumer test                          | PASS   |

Owner Acceptance Passed — Autonomous Evidence Review. The general checklist additionally verifies refresh, live resize, DPR 2, empty console/page-error collectors, visual judgment, performance, degradation behavior, and standalone operation. The owner-evidence commit must still pass its final CI before merge or tag.

## Known limitations

- Phase 0 uses a deterministic Mock Backend and does not create a GPU surface.
- WebGPU device creation, clear, triangle rendering, GPU timing, and Shader compilation begin in Phase 1.
- WebGL2 implementation and cross-backend visual comparison begin in Phase 10.
- CPU/GPU frame times and asset-load metrics are unavailable because their capabilities do not yet exist.
- Canonical visual acceptance requires the pinned official Playwright browser on GitHub Actions; the explicit sandbox profile is development evidence only.
- GitHub Actions run `29829946332` passed the complete canonical verification pipeline for the reviewed checkpoint.

## P0-12 owner conclusion

Owner Acceptance passes for the reviewed checkpoint `565ef4f5ed38e3e9bcf61670c2d93b363a0dcfc7`. Commit this owner evidence, mark PR #1 ready, and require one final clean CI on the owner-evidence head before merge and `phase-00-accepted` freeze.
