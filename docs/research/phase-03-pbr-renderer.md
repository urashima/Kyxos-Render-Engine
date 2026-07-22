# Phase 3 P3-03 — Direct-light PBR Renderer contract

Status: Implemented checkpoint (Phase 3 remains In Development)

This document freezes the P3-03 boundary. P3-04 subsequently implements the deferred factor-map
path in [phase-03-pbr-textures.md](./phase-03-pbr-textures.md); the P3-03 evidence remains unchanged.

## Scope

P3-03 connects the factor-only metallic/roughness material contract to the backend-neutral Renderer. It adds an independent `PbrRenderFeature`; the accepted Phase 2 `SceneRenderFeature` and its visual baselines are unchanged.

The checkpoint includes:

- one canonical direct-light WGSL module and an exact TypeScript runtime mirror;
- the GGX / Smith / Schlick BRDF established in P3-02;
- Opaque, Mask, and Blend entry points;
- single-sided and double-sided pipeline state;
- a fixed, aligned per-object Uniform layout;
- explicit Shader Module, Pipeline, Bind Group, Buffer, Surface, and depth Texture ownership;
- fallback material resolution;
- Device Lost rebuild and deterministic disposal;
- CPU/Mock Backend tests plus a real Chromium/WebGPU RGBA8 pixel readback.

Texture sampling, IBL, environment processing, and tone mapping are intentionally outside this checkpoint.

## GPU Uniform layout

The layout is a single Group 0 / Binding 0 Uniform Buffer. All offsets are Float32 indices; every logical field starts on a 16-byte boundary.

| Field                          | Float offset | Bytes | Purpose                                          |
| ------------------------------ | -----------: | ----: | ------------------------------------------------ |
| `modelViewProjection`          |            0 |    64 | Clip-space position                              |
| `model`                        |           16 |    64 | World-space position                             |
| `normalMatrix`                 |           32 |    64 | World-space normal                               |
| `baseColor`                    |           48 |    16 | Linear RGBA factor                               |
| `emissiveAndStrength`          |           52 |    16 | Linear RGB plus strength                         |
| `metallicRoughnessAlphaCutoff` |           56 |    16 | Continuous material factors                      |
| `normalOcclusion`              |           60 |    16 | Reserved factor slots for the texture checkpoint |
| `cameraPosition`               |           64 |    16 | World-space camera position                      |
| `lightDirectionAndIntensity`   |           68 |    16 | Direction toward light plus radiometric scale    |
| `lightColor`                   |           72 |    16 | Linear RGB light color                           |
| Total                          |         0–75 |   304 | 76 Float32 values                                |

`PBR_OBJECT_UNIFORM_LAYOUT` is public so tests and future backend implementations can validate the same offsets without duplicating numbers.

## Variant and cache contract

The Shader Module is compiled once. Initialization prewarms six pipelines:

| Alpha mode | Fragment entry point | Depth write | Blend        | Sidedness variants       |
| ---------- | -------------------- | ----------- | ------------ | ------------------------ |
| Opaque     | `fragmentOpaque`     | Yes         | No           | Back-face cull / no cull |
| Mask       | `fragmentMask`       | Yes         | No           | Back-face cull / no cull |
| Blend      | `fragmentBlend`      | No          | Source alpha | Back-face cull / no cull |

The key comes from `createPbrMaterialFeatureKey`. Continuous factors do not change it. A continuous material update therefore writes only the existing Uniform Buffer. A change to alpha mode or sidedness chooses a prewarmed Pipeline and replaces only the pipeline-specific Bind Group.

Mesh vertex/index Buffers are shared by immutable `MeshData` identity. Object Uniform Buffers and Bind Groups are cached by `EntityHandle`. Reconciliation releases entries when Mesh Renderer components are detached.

## Ownership

| Resource or object                                   | Owner              | Disposal rule                                                |
| ---------------------------------------------------- | ------------------ | ------------------------------------------------------------ |
| Shader Module, six Pipelines, Surface, depth Texture | `PbrRenderFeature` | Destroyed by feature disposal; forgotten after Device Lost   |
| Mesh vertex/index Buffers                            | `PbrRenderFeature` | Destroyed when unused or with the feature                    |
| Object Uniform Buffer and Bind Group                 | `PbrRenderFeature` | Destroyed when Entity binding disappears or with the feature |
| Internally created `PbrMaterialLibrary` and fallback | `PbrRenderFeature` | Disposed with the feature                                    |
| Supplied `PbrMaterialLibrary`                        | Caller             | Never disposed by the feature                                |
| Registered `PbrMaterial` values                      | Caller             | Never disposed by the library or feature                     |
| Scene, Camera, MeshRendererStore, VisibilitySystem   | Caller             | Never disposed by the feature                                |

A material-library update is CPU state. The caller must invalidate the Renderer with the `material` dirty flag; P3-03 does not introduce a permanent frame loop.

## Current constraints

The Backend API Bind Group entry currently represents Buffer bindings only. P3-03 rejects any material with a non-null texture slot using `UNSUPPORTED_CAPABILITY` and a recovery hint. This keeps unsupported sampling visible instead of silently ignoring maps.

The Mesh Renderer alpha queue must agree with the PBR material: Blend materials use the transparent queue; Opaque and Mask materials use the opaque queue. A mismatch is rejected because silently using the wrong queue would break depth and ordering.

Direct-light output remains linear. Environment lighting, BRDF LUT integration, HDR exposure, tone mapping, and final display transfer are later Phase 3 checkpoints. AO is not applied to direct light.

## Verification

- Exact runtime mirror and static WGSL validation.
- Mock Backend lifecycle and resource-accounting tests.
- Six-pipeline warmup and Bind Group cache-transition tests.
- 304-byte packing and offset tests.
- Texture capability rejection test.
- Device Lost full rebuild and zero-resource disposal tests.
- Chromium/WebGPU compilation plus an RGBA8 center-pixel readback compared with the P3-02 CPU BRDF oracle.
