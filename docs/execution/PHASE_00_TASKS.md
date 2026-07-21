# Phase 0 Task Graph — Repository and Architecture Baseline

Phase status: **In Development**  
Branch: `agent/phase-00-foundation`

Each task must be validated and committed before its dependants begin.

| ID    | Task                                                                                                                          | Depends on | Verification                                                                     | Status         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------- | -------------- |
| P0-01 | Durable execution status, log, decisions, blockers, and task graph                                                            | —          | Required files exist and recovery path is unambiguous                            | Completed      |
| P0-02 | pnpm workspace, root scripts, strict shared TypeScript, formatting and lint configuration                                     | P0-01      | Install, format check, lint, typecheck                                           | Completed      |
| P0-03 | Package manifests and public export boundaries for core, backend-api, renderer, frame-scheduler, sdk, and testing             | P0-02      | Every package builds independently; exports expose no private paths              | Completed      |
| P0-04 | Core lifecycle, typed events, stable errors, handles, and disposal contracts                                                  | P0-03      | Unit tests for lifecycle, error shape, event unsubscribe, and idempotent dispose | Completed      |
| P0-05 | Backend capability contract and mock backend with resource accounting                                                         | P0-04      | Unit and integration tests; dispose returns counters to baseline                 | Completed      |
| P0-06 | Renderer shell, scheduler baseline, registration APIs, and public SDK factory                                                 | P0-05      | SDK-only consumer test; mock renderer create/invalidate/dispose                  | Completed      |
| P0-07 | Framework-independent Vite Playground and `/acceptance/phase-00` route                                                        | P0-06      | Browser smoke test; no Texture Lab dependency                                    | Completed      |
| P0-08 | Vitest, Playwright, shader validation placeholder with honest capability status, bundle budget, and dependency boundary gates | P0-07      | Full local gate; deliberate forbidden import fixture fails                       | Completed      |
| P0-09 | GitHub Actions and ADR-001 through ADR-005 plus architecture/dependency documents                                             | P0-08      | Workflow syntax review; ADR and dependency checks                                | In Development |
| P0-10 | Acceptance document, automated summary, performance record, and Reference/Current/Difference visual baseline                  | P0-09      | Acceptance artifact schema checks and deterministic screenshot comparison        | Planned        |
| P0-11 | Full Phase 0 gate, draft PR, CI repair, and technical QA                                                                      | P0-10      | All required checks green; acceptance evidence complete                          | Planned        |
| P0-12 | Autonomous owner evidence review, merge, and `phase-00-accepted` freeze                                                       | P0-11      | Owner checklist evidence, merged main, accepted tag                              | Planned        |

## Minimal implementation order

```text
Execution baseline
→ workspace/toolchain
→ package boundaries
→ core contracts
→ backend contract + mock
→ renderer/scheduler/SDK
→ independent playground
→ automated gates
→ ADR and acceptance evidence
→ PR/CI/QA/freeze
```

## Phase 0 boundary map

```text
playground
    ↓
sdk
    ↓
renderer → frame-scheduler
    ↓
backend-api
    ↓
core

testing → backend-api + core
```

No Phase 0 package may depend on Texture Lab, React, a product store, or a private path from another package.
