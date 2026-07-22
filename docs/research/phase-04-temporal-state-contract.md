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

P4-04 added the first GPU-owned part of that contract without wiring a TAA resolve Render Feature.
At that checkpoint, Backend Render Passes selected exactly one Canvas Surface or one offscreen
Texture Color Attachment. An offscreen target had to be a single-sampled, non-depth Texture created
with `render-attachment` usage; its View selected exactly one valid 2D Mip and Array Layer. Draw
Pipeline Color Formats matched the attachment, and an optional Depth Texture matched its selected
dimensions. Explicit `loadOp` and `storeOp` values passed unchanged through the native WebGPU port.

The validation and usage model follows the [W3C WebGPU
specification](https://www.w3.org/TR/webgpu/), specifically `GPUTextureUsage`,
`GPUTextureViewDescriptor`, and `GPURenderPassColorAttachment`. Kyxos deliberately narrows that
general API to one Color Attachment and one 2D subresource in P4-04. P4-06 expands that narrow
contract to a validated ordered attachment list while retaining the same subresource rules.

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

The CPU record owns no GPU object. P4-04 added a separate `DynamicTaaGpuHistory` owner in Renderer;
P4-06 expanded it to the complete frame-target identity consumed by the P4-07 resolve pass:

- each non-empty Owner ID has one Current `rgba16float` linear-HDR Color Texture;
- it also has two resolved target sets, each containing `rgba16float` Color, `depth32float` Depth,
  and `rgba16float` Normal Textures, plus one shared clamp-to-edge linear Sampler;
- all seven Textures have `render-attachment` and `sampled` usage so the later scene and resolve
  passes can use the same stable owner contract;
- `prepareFrame` returns the immutable Current target plus read/write Color/Depth/Normal roles and
  fail-closed signature validity; `commitFrame` records the signature and swaps all three resolved
  roles as one set, while cancellation does neither;
- Resize creates the complete replacement set before publishing it, resets the read role, and
  invalidates the Viewport signature before releasing the old set;
- Device Lost discards already-invalid Handles without destroying them, invalidates Device history,
  and restores fresh Handles only after the caller restores the same Backend;
- idempotent disposal releases only owner-created Handles and never disposes the caller Backend.

The seven Textures consume exactly `width × height × 48` estimated bytes: eight bytes for Current
Color plus two sets of eight-byte Color, four-byte Depth, and eight-byte Normal. No sampled TAA Bind
Group, resolve Pipeline, present pass, or Render Graph resource is added by P4-06.

## Camera-motion reprojection contract

P4-05 adds a deterministic Camera-layer reprojection reference without connecting the TAA resolve
to a Renderer pass. `TemporalCameraMatrixTracker` now returns the inverse of the Current jittered
View-Projection together with the retained Previous jittered View-Projection. The general inverse
is provided by the dependency-free Math package and is rejected for singular matrices.

For a top-left Raster coordinate `currentUv` and canonical WebGPU Depth `currentDepth`, CPU and WGSL
perform the same float32 sequence:

```text
currentNdc = (2 × currentUv.x - 1, 1 - 2 × currentUv.y, currentDepth)
world = inverseCurrentViewProjection × (currentNdc, 1)
previousClip = previousViewProjection × (world.xyz / world.w, 1)
historyUv = ((previousClip.x / previousClip.w + 1) / 2,
             (1 - previousClip.y / previousClip.w) / 2)
motionUv = currentUv - historyUv
```

The Motion direction is therefore frozen so `historyUv = currentUv - motionUv`. This includes both
Camera movement and the difference between Current and Previous Projection Jitter. History validity
fails closed for a Current UV outside the unit square, clear/background Depth `1`, a zero or invalid
Current homogeneous W, a Previous clip W at or behind the Camera, Previous Depth outside `[0, 1]`,
or a Previous History UV outside the unit square. Skinned/Morph Motion Vectors, History sampling,
Depth/Normal validation, resolve composition, and Renderer submission remain outside P4-05.

The coordinate and depth mapping follow Accepted ADR-002 and the W3C [WebGPU coordinate-system
definition](https://www.w3.org/TR/webgpu/#coordinate-systems). Matrix/vector multiplication,
float32 behavior, storage layout, and finite-value guards follow the W3C [WGSL
specification](https://www.w3.org/TR/WGSL/). Four frozen branches cover stationary, moving Camera
plus Jitter, Previous UV rejection, and background rejection. The pinned WebGPU gate reads back 64
float32 fields and compares them with the CPU reference under a `0.00001` absolute tolerance.

## Ordered MRT contract

P4-06 replaces the single offscreen Color Attachment field with a non-empty ordered list. A Texture
pass remains mutually exclusive with a Canvas Surface pass. The list length cannot exceed the
Backend's reported `maxColorAttachments`; every selected View remains one single-sampled,
non-depth, renderable 2D Mip and Array Layer; all Views have identical dimensions; and the same
Texture cannot occupy two attachment slots. Each attachment has its own `loadOp`, `storeOp`, and
optional finite Clear Color, falling back to the Render Pass Clear Color when omitted.

Any Draw Pipeline with fragment targets must match the attachment count and ordered formats
exactly. A fragment-less/depth-only Pipeline remains valid in a pass with Color Attachments. The
Backend validates the complete list before its browser port constructs the native ordered
`GPURenderPassColorAttachment[]`. The Mock Backend mirrors the same count, resource, subresource,
dimension, format-order, operation, and finite-Clear validation.

The contract follows the W3C [WebGPU Render Pass
definition](https://www.w3.org/TR/webgpu/#render-pass-encoder-creation), including the ordered
`colorAttachments` sequence, attachment-size compatibility, and device attachment limit. Kyxos
deliberately excludes multisampled resolves, sparse/null attachment slots, duplicate Texture
subresources, and mixed attachment dimensions until a Render Graph checkpoint defines their
ownership and scheduling semantics.

## Sampled Dynamic TAA resolve pass

P4-07 adds an independent `DynamicTaaResolvePass` without transferring ownership of the
`DynamicTaaGpuHistory` targets. Its 176-byte Uniform contains inverse Current and Previous
View-Projection matrices, Viewport size, History validity, responsive mask, and the frozen P4-03
resolve options. One Bind Group maps Current Color, Current write Depth and Normal, prior read
Color/Depth/Normal, and the History Sampler. The Backend therefore permits single-sampled sampled
Depth Textures in Bind Groups while retaining usage, view-subresource, and sample-count validation.

The full-screen WGSL pass reconstructs History UV from Current Depth with the P4-05 fail-closed
rules, loads a clamped 3×3 Current Color neighborhood, samples prior linear-HDR Color and encoded
Normal at the reprojected coordinate, and loads the corresponding prior Depth texel. Normals decode
from `[0, 1]` to `[-1, 1]` and normalize before the P4-03 Depth/Normal rejection, neighborhood clamp,
and responsive weighting. The result preserves Current Alpha and writes linear-HDR RGB into the
History write Color target.

The pass owns only one Shader, one Pipeline, one Uniform Buffer, and role-specific Bind Groups. It
reuses Bind Groups within a resource generation, releases stale groups before binding a resized
generation, forgets invalid Handles on Device Lost, rebuilds after restoration, and releases its
resources before the caller disposes History. The caller remains responsible for the order
`scene MRT → resolve → History commit`; execution never commits or swaps History implicitly.

P4-07 deliberately excludes PBR offscreen/MRT output, final Present, Skinned/Morph Motion Vectors,
Render Graph scheduling, Static Accumulation, a Phase 4 public route, and an acceptance claim.

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
Renderer → Frame Scheduler + Temporal
SDK → public engine packages
```

Unit tests cover Backend target/view/count/dimension/format-order validation, sampled Depth binding,
native ordered port translation, whole-set ping-pong roles, signature mismatch, atomic Resize,
partial-allocation rollback, Device Lost recovery, complete release, general matrix inversion,
Camera reprojection direction, every fail-closed projection branch, exact 176-byte Uniform packing,
role-cache reuse/replacement, and resolve ownership. The pinned Chromium/SwiftShader gate
dynamically loads the public WebGPU Backend and Renderer modules, submits real two-target
`rgba16float` MRT passes with `depth32float`, executes the sampled resolve through both initial and
resized History resources, and records the resource diagnostics. A separate native WebGPU gate
reads three `rgba16float` output pixels for accepted, Depth-rejected, and Normal-rejected History,
compares them with the half-float-aware CPU oracle, and stores the result with the deterministic
Camera reprojection reference in the Phase 4 Artifact.
