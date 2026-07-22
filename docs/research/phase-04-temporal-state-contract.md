# Phase 4 Temporal State Contract

## Scope

P4-01 establishes the deterministic CPU contract required before any TAA, reprojection, or static
accumulation Shader is introduced. It implements the state machine accepted by ADR-005 without
claiming that a GPU history exists.

This checkpoint includes:

- the legacy `FrameScheduler`, retained as the default dirty-only behavior for accepted Phase 0–3
  routes;
- an opt-in `TemporalFrameScheduler` implementing Interactive → Stabilizing → Accumulating →
  Sleeping;
- owner-scoped dynamic/static `TemporalHistory` records with immutable signatures;
- fixed sample-limit and consecutive error-threshold convergence;
- explicit interaction, animation, upload, and Shader-compilation activity blockers;
- coalesced Dirty Flags, per-batch history generations, and Renderer frame metadata.

P4-01 deliberately excluded Jitter, motion vectors, reprojection, History Textures, neighborhood
clamping, disocclusion rejection, accumulation Shaders, and Phase 4 visual acceptance. Those depend
on its state contract and are subsequent checkpoints.

P4-02 adds only the deterministic sampling and Camera matrix layer above this contract. It selects a
one-based Halton base-2/base-3 sequence for the supported 1–256 samples, converts top-left Raster
offsets into canonical +Y-up NDC, and applies the offset to a copied Projection Matrix. The Camera's
canonical Projection and Frustum remain unjittered.

`TemporalCameraMatrixTracker` retains Current/Previous jittered View-Projection matrices for future
reprojection. First use, History Generation change, Projection change, Viewport change, and explicit
reset fail closed by setting Previous equal to Current. Camera pose motion within one Generation
retains the true prior matrix and Jitter so a later Dynamic TAA pass can reproject it. The tracker
owns neither its caller-provided Camera nor a GPU resource.

P4-03 freezes the Dynamic TAA resolve math without creating its eventual GPU resources. Its input is
a current linear-HDR pixel plus History Color, Depth, and Normal already sampled at a
caller-provided reprojected coordinate. A nine-sample current-color neighborhood bounds History;
invalid History, incompatible Depth, or incompatible normalized Normals reject it. Accepted History
uses an explicit base weight reduced by a unit-range responsive mask. Output RGB remains linear HDR
and output Alpha always comes from the current frame.

The clean-room algorithm inputs are [Brian Karis, High Quality Temporal
Supersampling](https://de45xmedrsdbp.cloudfront.net/Resources/files/TemporalAA_small-59732822.pdf),
Playdead's published [Temporal Reprojection Anti-Aliasing in
INSIDE](https://github.com/playdeadgames/temporal/blob/master/GDC2016_Temporal_Reprojection_AA_INSIDE.pdf),
and the [W3C WGSL specification](https://www.w3.org/TR/WGSL/) for the exact `min`, `max`, `clamp`,
`normalize`, `dot`, and `mix` operations. P4-03 independently freezes Kyxos-specific thresholds and
reference vectors; no private renderer source or assets were used.

The deterministic reference executes three branches: accepted History with neighborhood clamping
and responsive weighting, Depth disocclusion rejection, and Normal rejection. CPU results and 60
WebGPU float32 values must agree within the frozen `0.000001` absolute tolerance. Reprojection
coordinates, Motion Vectors, History Textures, Render Graph resources, and Renderer integration
remain deferred.

## Scheduling invariants

1. No strategy owns a global or unconditional RAF loop. Both strategies use an injected frame
   driver.
2. Multiple Dirty Events before a frame retain their sorted union but produce one pending callback.
3. A history-reset batch increments its generation exactly once, even when several reset Dirty Flags
   coalesce.
4. Active interaction, animation, upload, or compilation keeps the mode Interactive and prevents
   static convergence.
5. Ending the final activity enters a timestamp-driven stabilization window before accumulation.
6. Accumulation sample indices are exact, one-based, and bounded to 1–256.
7. Reaching either the fixed target or the configured consecutive error threshold enters Sleeping
   and leaves no pending callback.
8. A non-reset Selection update may draw one overlay frame without destroying converged history.
9. Suspension, Device Lost, and disposal cancel pending work and invalidate the scheduling
   generation.

## History signatures and ownership

Every Dynamic or Static History belongs to one non-empty owner identifier. A reusable signature is
the exact tuple of non-negative safe-integer revisions for:

```text
Camera, Device, Environment, Geometry, Lighting,
Materials, Post Process, Scene, Viewport
```

Any mismatch clears validity before the new sample is recorded. Explicit invalidation preserves a
stable cause such as Camera, Material, Texture, Viewport, or Device. Dynamic and Static records do
not share sample counts or validity.

The CPU record owns no GPU object. A future Temporal Render Feature will own History Textures,
Motion/Depth inputs, Bind Groups, loss recovery, and disposal while using this signature contract to
decide whether sampling is legal.

## Renderer boundary

`KyxosRenderer` continues to construct the dirty-only scheduler unless a caller explicitly injects a
`FrameSchedulerController`. The Renderer owns the selected controller and disposes it. Temporal
frames expose immutable Mode, Sample Index, Target Samples, History Generation, and Reset state to
Render Features and diagnostics; ordinary frames retain their previous shape.

This opt-in boundary prevents P4-01 from changing accepted route behavior or treating CPU state as
completed TAA.

## Verification

Deterministic tests cover the full mode sequence, stabilization timing, activity blockers,
coalesced resets, selection-only reuse, error-threshold convergence, suspension/disposal, owner
isolation, signature mismatch, and Renderer metadata forwarding. Package-boundary checks enforce:

```text
Temporal → Core
Frame Scheduler → Core + Temporal
Renderer → Frame Scheduler
SDK → public engine packages
```
