# Phase 00 Acceptance — Repository and Architecture Baseline

- **Evidence status:** Local evidence complete
- **Phase status:** Development Complete; formal CI and technical QA pending
- **Branch:** `agent/phase-00-foundation`
- **Source checkpoint:** `70d13c68f7c7f8f5d1ae0cc1575b87cf37138e5d`
- **Evidence generated:** 2026-07-21 05:14 PDT

This document proves the Phase 0 deliverables defined by `DEVELOPMENT_PLAN.md` and `PHASE_ACCEPTANCE_PLAN.md`. It does not claim Phase Accepted: the pull-request CI run, technical QA review, autonomous owner evidence review, merge, and accepted tag are later gates.

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

| Requirement                              | Evidence                                                                                 | Result  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | ------- |
| pnpm Monorepo                            | `pnpm-workspace.yaml`, frozen lockfile, eight workspaces                                 | PASS    |
| TypeScript strict                        | Shared strict configuration plus package, test, and app type checks                      | PASS    |
| ESLint and Prettier                      | Zero-warning lint and formatting gates                                                   | PASS    |
| Vitest                                   | 9 files, 28 tests                                                                        | PASS    |
| Playwright                               | 4 Chromium tests: lifecycle, compact viewport, visual baseline, static-to-sleep          | PASS    |
| GitHub Actions                           | `.github/workflows/ci.yml`; formal pull-request run intentionally pending                | PENDING |
| Package boundaries and cycles            | Runtime graph has zero cycles/violations; deliberate Renderer-to-SDK fixture is rejected | PASS    |
| Mock Backend                             | Capability, resource accounting, loss, recovery, and disposal tests                      | PASS    |
| ADR baseline                             | ADR-001 through ADR-005 accepted and mechanically checked                                | PASS    |
| SDK callable from an independent example | SDK-only consumer test and standalone Playground                                         | PASS    |
| All packages independently buildable     | Seven package build scripts pass independently; Playground has its own typecheck/build   | PASS    |

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
| Browser acceptance    | PASS           | 4 / 4 Chromium tests                           |
| Visual regression     | PASS           | 0 differing pixels                             |
| Static-to-sleep       | PASS           | p95 66.2 ms against 250 ms Phase 0 budget      |
| Pull-request CI       | PENDING        | Must be inspected after the Phase PR exists    |

Shader validation is deliberately not marked PASS: the current gate reports `NOT_APPLICABLE` and will fail if Shader files appear before a compiler-backed validator is added.

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

| Operation                                                      | Evidence                                        | Status  |
| -------------------------------------------------------------- | ----------------------------------------------- | ------- |
| Open the Playground                                            | Chromium route and visibility test              | PASS    |
| Confirm no Texture Lab dependency                              | Manifest/source boundary scan                   | PASS    |
| View all CI checks                                             | Requires Phase pull request                     | PENDING |
| View the dependency graph                                      | Versioned JSON graph and architecture document  | PASS    |
| Exclude `integration-texture-lab` and rebuild                  | Package is absent; full standalone build passes | PASS    |
| Import only `@kyxos/render-sdk` from a blank consumer boundary | SDK-only consumer test                          | PASS    |

Owner Acceptance is not marked passed in this checkpoint. P0-12 will mechanically review the complete evidence only after CI and technical QA pass.

## Known limitations

- Phase 0 uses a deterministic Mock Backend and does not create a GPU surface.
- WebGPU device creation, clear, triangle rendering, GPU timing, and Shader compilation begin in Phase 1.
- WebGL2 implementation and cross-backend visual comparison begin in Phase 10.
- CPU/GPU frame times and asset-load metrics are unavailable because their capabilities do not yet exist.
- Canonical visual acceptance requires the pinned official Playwright browser on GitHub Actions; the explicit sandbox profile is development evidence only.
- Remote GitHub Actions is pending the repaired pull-request run and is not represented as green.

## P0-10 conclusion

The Phase 0 acceptance evidence package is internally complete and locally verified. Advance to P0-11 for the full gate, draft pull request, observable GitHub Actions run, CI repair if needed, and technical QA. Do not merge or tag from this evidence checkpoint alone.
