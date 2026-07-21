# ADR-001: WebGPU First, WebGL2 Fallback

- **Status:** Accepted
- **Date:** 2026-07-21
- **Owners:** Renderer architecture

## Context

The engine needs modern GPU capabilities for its primary rendering path while remaining usable on browsers and devices without suitable WebGPU support. A shared SDK must not force consumers to understand two native graphics APIs, and WebGL2 must not become a partial WebGPU emulator.

## Decision

WebGPU is the primary backend. WebGL2 is an independent, capability-limited compatibility backend. Both implement the backend-neutral `GraphicsBackend` contract and publish immutable availability, feature, and limit reports.

The eventual public selector has three policies:

| Request  | Behavior                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| `auto`   | Try WebGPU first; use WebGL2 only when WebGPU is unavailable or cannot initialize before user resources exist |
| `webgpu` | Initialize WebGPU or return a stable error; do not silently change semantics                                  |
| `webgl2` | Initialize WebGL2 or return a stable error                                                                    |

Phase 0 injects a backend instance directly so lifecycle and boundaries can be tested before browser GPU initialization. Phase 1 adds WebGPU selection; Phase 10 completes WebGL2 selection and compatibility acceptance.

Concrete `GPUDevice`, `GPUQueue`, WebGL contexts, and native resources remain private to their backend. The Renderer receives capability data, opaque resource handles, commands, lifecycle events, and diagnostics.

Backend differences in NDC, texture presentation, synchronization, resource creation, and Shader language are resolved inside backend implementations or backend-specific Shader compilation. They do not leak into Scene, Material, or product code.

## Required behavior

- Capabilities default conservatively: an unreported feature is unsupported.
- Unsupported optional features are disabled or use a documented lower-cost substitute; they never pretend to run.
- Explicit backend requests fail clearly rather than silently falling back.
- `auto` fallback records the selected backend and the unavailable reason in diagnostics.
- Device/context loss invalidates native resources, cancels pending rendering, and follows a tested recovery or terminal-error path.
- Both backends share the public SDK but may expose different capabilities and quality limits.

## Consequences

- Feature modules must query capabilities and provide a disable/degrade policy.
- Shader sources may share generated concepts, but WGSL and GLSL ES 3.0 compilation remain backend-specific.
- WebGL2 cannot block WebGPU-only implementation work before Phase 10, provided capability claims remain honest.
- Cross-backend visual parity is judged within documented tolerances, not by assuming identical algorithms.

## Alternatives rejected

- **WebGPU only:** excludes the required compatibility preview path.
- **Lowest-common-denominator renderer:** prevents modern WebGPU compute, storage, and pipeline features from defining the primary architecture.
- **Expose both native APIs through the SDK:** couples products and feature modules to backend details and makes fallback unsafe.
- **Emulate WebGPU on WebGL2:** creates misleading capability semantics and unbounded maintenance cost.
