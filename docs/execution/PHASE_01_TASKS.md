# Phase 01 Tasks — WebGPU Core and Basic Geometry

Phase 1 starts from accepted tag `phase-00-accepted` and branch base `6522a6d7ff35ebef39c2efd7627a3f23a7b1da2c`.

| ID    | Task                                                                                          | Depends on  | Verification                                                                                 | Status         |
| ----- | --------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- | -------------- |
| P1-01 | Define WebGPU initialization contracts, injectable native seam, feature/limit negotiation     | Phase 0     | Strict types; unavailable/adapter/device/loss unit coverage; no native objects cross Backend | Completed      |
| P1-02 | Implement adapter, device, queue, loss lifecycle, recovery policy, and stable errors          | P1-01       | Lifecycle/state/event tests; repeated initialize; deterministic disposal                     | Completed      |
| P1-03 | Implement Canvas surface ownership, configure/unconfigure, Resize, DPR, and zero-size suspend | P1-02       | Resize/DPR/hidden/restore/multiple-surface tests                                             | Completed      |
| P1-04 | Implement Buffer, Texture, Sampler, Shader, Pipeline, and Command Encoder ownership           | P1-02       | Create/destroy/native-destroy/resource-count tests; loss returns resource baseline           | Completed      |
| P1-05 | Implement clear, triangle, and generated sphere draw paths with validated WGSL                | P1-03,P1-04 | Compiler-backed Shader gate; command-order tests; WebGPU smoke                               | In Development |
| P1-06 | Connect Renderer and public SDK Canvas options without exposing `GPUDevice`                   | P1-03,P1-05 | SDK-only consumer; create/dispose/recreate; clear fallback errors                            | Planned        |
| P1-07 | Add independent `/acceptance/phase-01` Playground controls and diagnostics                    | P1-06       | Clear/triangle/sphere, Resize/DPR, hidden/restore, canvas switch, loss/dispose browser flows | Planned        |
| P1-08 | Add visual, performance, resource, and WebGPU integration evidence                            | P1-07       | Reference/Current/Difference; frame/resource metrics; comparison to Phase 0                  | Planned        |
| P1-09 | Complete full CI, technical QA, autonomous owner review, PR, merge, and accepted tag          | P1-08       | All Phase 1 gates green; `phase-01-accepted` resolves to accepted merge                      | Planned        |

### P1-05 checkpoints

- [x] Backend-neutral Buffer upload, Render Pass, Draw, indexed Draw, Command Encoder consumption, queue submission, and immutable statistics.
- [x] Browser-native command translation and deterministic fake-native command-order coverage.
- [x] Vertex/Index usage, ownership, alignment, range, count, duplicate-slot, and safe-integer validation.
- [ ] Canonical WGSL module with compiler-backed validation.
- [ ] Generated triangle and indexed sphere geometry wired through a Renderer feature.
- [ ] Real WebGPU smoke covering clear, triangle, and sphere submissions.

## Required architecture boundaries

- Browser `navigator.gpu`, `GPUAdapter`, `GPUDevice`, queue, context, and native resources remain private to `@kyxos/render-backend-webgpu`.
- Renderer and SDK communicate through backend-neutral descriptors, commands, opaque handles, diagnostics, and lifecycle events.
- WebGPU unavailable and failed initialization paths return stable public errors and an explicit fallback recommendation; Phase 1 does not pretend WebGL2 exists before Phase 10.
- Every native resource has one owner, an idempotent destroy path, loss cleanup, and debug accounting.
- Surface resizing clamps physical dimensions to device limits, handles a zero-sized Canvas without drawing, and does not create a permanent RAF loop.

## Minimum implementation order

1. Injectable native contracts and deterministic test doubles.
2. Adapter/device/queue ownership and capability report.
3. Surface lifecycle and physical-size calculation.
4. Resource registry and native destruction.
5. WGSL modules, pipelines, and encoded draws.
6. SDK integration, acceptance surface, and evidence.
