# ADR-006: Independent Deferred Rendering and TRAA Pipeline

- **Status:** Accepted
- **Date:** 2026-07-25
- **Supersedes:** the P4-14 forward temporal integration boundary in `docs/execution/PHASE_04_TASKS.md`

## Context

The Phase 4 forward temporal path combines PBR shading, Color/Normal/Velocity MRT output, Dynamic TAA,
Static Accumulation, Present, and their History role swaps inside one transaction. The public Phase 4
Playground passes deterministic resource gates, but owner visual review still observes strong Dynamic TAA
shaking. Continuing to add rejection and weighting controls would preserve the same coupled scheduling and
attachment model rather than correcting its architectural boundary.

A production TRAA implementation needs one authoritative motion-vector convention, one jitter application,
an explicit pass graph, and History ownership that is independent from static convergence and presentation.

## Decision

Create a new opt-in rendering path with the fixed order:

1. `gbuffer`
2. `deferred-lighting`
3. `traa-resolve`
4. `post-process`
5. `present`

The new path follows these rules:

- GBuffer rasterization owns material attributes, encoded world/view normal, linear depth, and rigid-object
  motion vectors. It does not perform final lighting or temporal blending.
- Deferred Lighting consumes only current-frame GBuffer attachments and writes one linear-HDR current-color
  target.
- TRAA owns its own Color/Depth History pair, reprojection, disocclusion rejection, neighborhood clipping,
  accumulation weight, and jitter sequence.
- Motion vectors are generated from current and previous **unjittered** transforms. Projection jitter is
  applied to rasterization once, and the resolve compensates the current/previous jitter delta once.
- Post-processing runs after TRAA and never mutates TRAA History.
- Present is the only Canvas Surface owner.
- The new scheduler emits the fixed pass graph and only three modes: `interactive`, `resolving`, and
  `sleeping`. It does not import or call the legacy Static Accumulation transaction.
- Resize, Device Lost, cancellation, and disposal replace or release the complete Deferred/TRAA resource set
  atomically.

The existing `TemporalPbrRenderFeature` remains available only as the Phase 4 comparison path until the new
pipeline passes local visual review, complete `pnpm verify`, public Pages verification, and owner acceptance.
It must not be extended with new Deferred/TRAA responsibilities.

## Consequences

- Phase 4 acceptance is reopened for P4-15 while the immutable `phase-04-accepted` tag remains unchanged.
- The new implementation may temporarily duplicate raster/material plumbing to preserve a strict ownership
  boundary; reuse is allowed only through public, render-path-neutral data contracts.
- Phase 5 lighting/post-processing work remains paused until the new Deferred/TRAA path replaces the public
  Phase 4 default or is explicitly rejected with evidence.
- Visual acceptance must include stationary-camera stability, slow orbit, fast orbit, thin-edge motion,
  disocclusion, resize, wake/sleep, and zero-growth GPU resource checks.

## Alternatives rejected

- **Continue tuning the legacy Dynamic TAA resolve:** rejected because it leaves PBR MRT, History role swaps,
  Static Accumulation, and Present inside one transaction and cannot prove one authoritative jitter/motion
  convention.
- **Insert a GBuffer only for Velocity while retaining forward color:** rejected because two geometry paths
  would still share temporal ownership and could diverge at depth, alpha, and transform boundaries.
- **Reuse Static Accumulation as TRAA History:** rejected because static convergence and real-time temporal
  antialiasing have different invalidation, cadence, and presentation requirements.
- **Rewrite the existing accepted feature in place:** rejected because the legacy path is needed as an exact
  comparison and rollback target until the new path passes every acceptance gate.
