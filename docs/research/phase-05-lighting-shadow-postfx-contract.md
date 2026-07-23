# Phase 05 Lighting, Shadow, AO, and PostFX Contract

Status: **Frozen for P5-01**  
Scope: Phase 5 architecture, quality, Temporal integration, and acceptance boundaries  
Source plan: `DEVELOPMENT_PLAN.md` Sections 14, 15, 19, 21, and Phase 5 milestone

## 1. Package and dependency boundary

Phase 5 extends the accepted renderer through three independent feature families:

- `lighting`: portable Directional/Spot descriptors, validation, deterministic Scene registry, layer masks,
  mutation versions, and public diagnostics. It contains no WebGPU objects and does not import PostFX.
- Shadow Feature: consumes portable light snapshots and Scene visibility, declares shadow-map resources and
  passes, and owns atlas/pipeline/bind-group lifecycle behind Backend contracts. PBR consumes only the
  resulting portable shadow binding/command contract.
- `postfx-core` plus standard implementations: registered pass nodes declare inputs, outputs, color space,
  resolution scale, quality tier, Temporal History, and backend capabilities. PostFX never mutates Scene.

Dependency direction remains SDK → Feature/Renderer → Backend API → WebGPU. Backend implementations do not
know Scene, Material, Lighting policy, or individual PostFX algorithms.

## 2. Portable light contract

P5-02 starts with immutable validated Directional and Spot descriptors:

- stable Light ID, enabled state, color/temperature-resolved linear RGB, intensity, layer mask, shadow mode;
- Directional direction and Spot position/direction/range/inner/outer cone with finite normalized values;
- Scene-owned create/update/remove lifecycle with monotonically increasing version and deterministic
  submission order independent of insertion-map implementation details;
- snapshots contain portable values only and are safe for Mock Backend/unit tests;
- disposal releases registry ownership and prevents stale-light submission.

P5-02 deliberately does not allocate GPU resources or render shadows.

## 3. Shadow Feature contract

Shadow passes are opt-in registered features. They declare light selection, atlas regions, view-projection,
depth format, resolution tier, Bias/Normal Bias, filtering mode, layer mask, and validity generation.
Directional/Spot maps and CSM share lifecycle infrastructure but keep projection and sampling policies
separate. Resize, quality changes, light mutation, caster mutation, Device Lost, and disposal invalidate the
relevant shadow generation through explicit Dirty causes.

## 4. PostFX contract and ordering

Standard order is explicit and testable rather than hard-coded in Renderer Core:

1. scene/Temporal HDR result;
2. GTAO composition at the declared lighting stage;
3. Bloom and DOF in linear HDR;
4. Color Grading/LUT;
5. Sharpen at the declared output resolution;
6. existing Present tone-map and single linear-to-sRGB conversion.

Every pass can be independently disabled without leaving stale resources or changing unrelated pass output.

## 5. Quality matrix

- Shadow Low/Medium/High control map resolution, PCF taps, cascade count, and stabilization.
- GTAO controls resolution, directions/steps, denoise, and Temporal reuse.
- Bloom controls pyramid depth and filter taps.
- DOF controls half/quarter/full-resolution kernels and sample count.
- Color Grading and Sharpen retain deterministic identity paths at every quality tier.

Quality changes are Dirty events, invalidate only owned History/resources, and use hysteresis when later
connected to automatic quality selection.

## 6. Temporal and scheduler integration

Interactive camera/light/caster changes wake rendering and invalidate affected Shadow/AO histories. Static
convergence may reuse stable Shadow maps while GTAO/DOF histories follow explicit signatures. Disabled pass,
Resize, Device Lost, quality, and resource replacement transitions are atomic. No Phase 5 feature owns a
permanent RAF or bypasses the accepted Frame Scheduler.

## 7. Acceptance gates

Phase 5 must prove:

- each Shadow/AO/PostFX pass independently toggles and reports quality/resource diagnostics;
- AO, shadows, and TAA do not produce stale History, visible ghosting, or conflicting ownership;
- CPU/WGSL references and native WebGPU readback cover critical sampling/output branches;
- Device Lost, Resize, quality mutation, disable, disposal, and recreation release/rebuild exact resources;
- public `/phase-5/` and `/latest/` expose the accepted operations and immutable source before Tag freeze.

## 8. P5-02 exact next scope

Implement only portable Directional/Spot types and the Scene-owned registry. Verification requires invalid
descriptor rejection, normalized deterministic snapshots, stable order, layer filtering, update versioning,
remove/dispose behavior, Mock Backend independence, public package exports, and dependency-boundary checks.
