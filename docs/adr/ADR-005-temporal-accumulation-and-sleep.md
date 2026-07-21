# ADR-005: Temporal Accumulation and Sleep

- **Status:** Accepted
- **Date:** 2026-07-21
- **Owners:** Frame scheduling, temporal rendering, renderer architecture

## Context

The engine must react immediately during interaction, improve a static image over time, stop expensive full rendering after convergence, and wake correctly for every meaningful change. A permanent unconditional `requestAnimationFrame` loop would violate power and performance goals, while indiscriminate history reuse would create ghosting across scene changes.

## Decision

Rendering is driven by explicit dirty events and a four-mode state machine:

```text
Sleeping → Interactive → Stabilizing → Accumulating → Sleeping
```

- **Interactive:** prioritize latency and stable frame rate; reset static accumulation and use short, rejection-aware dynamic history.
- **Stabilizing:** wait for camera inertia, resource uploads, Shader compilation, and viewport changes to settle within a configurable window.
- **Accumulating:** apply a deterministic low-discrepancy jitter sequence until a sample target or measured convergence threshold is reached.
- **Sleeping:** retain the converged presentation result but schedule no full frame and, where possible, no RAF callback.

Every feature declares which dirty flags it raises. The canonical set is Camera, Transform, Geometry, Material, Texture, Light, Environment, Animation, Viewport, Post Process, Selection, and Accumulation.

Multiple invalidations before a frame coalesce into one pending request while retaining the union of dirty flags. A dirty event during frame execution schedules the next required frame. With no further work, the scheduler enters `sleeping` and releases the frame request.

Temporal state is owner-scoped:

- Dynamic TAA history and static accumulation history are separate resources.
- Histories include the generation/signature of the scene, camera, viewport, relevant material/lighting inputs, and backend device.
- A mismatched signature is rejected before sampling.
- Device/context loss and renderer disposal invalidate all history.
- Features explicitly declare reset dependencies; a generic "keep history" fallback is forbidden.

Animation, pending uploads, active interaction, and required background compilation prevent static convergence. Non-render UI animation must not wake full rendering unless it changes an engine input.

## Phase delivery

Phase 0 implements the injected, deterministic dirty-driven shell: one or more dirty events produce the minimum requested frame count and return to sleep. It intentionally does not claim Stabilizing, TAA, jitter, convergence, or accumulation.

Phase 4 implements and accepts the full four-mode policy, temporal reprojection, static accumulation, history diagnostics, convergence, and static-to-sleep performance budgets.

## Consequences

- Feature APIs must invalidate deliberately and include reset tests.
- Schedulers require an injected platform frame driver, enabling deterministic tests and keeping DOM globals outside Renderer Core.
- Temporal resources have explicit owners and memory costs visible in diagnostics.
- Capture may request a higher sample target but cannot bypass cancellation, loss, or disposal.
- A visual improvement that leaves permanent full-frame work running is not acceptable.

## Alternatives rejected

- **Permanent RAF:** wastes CPU/GPU and makes convergence-to-sleep impossible.
- **One shared history for dynamic and static rendering:** causes incompatible weighting and stale-scene artifacts.
- **Reset all history on every UI event:** is safe but destroys convergence for changes unrelated to rendering.
- **Reuse history without signatures:** permits previous scenes, cameras, or devices to contaminate the current frame.
