# Phase 3 P3-05 — Tangent-space Normal and Emission contract

Status: Implemented checkpoint (Phase 3 remains In Development)

## Scope

P3-05 adds an optional immutable tangent stream to `MeshData`, a deterministic UV-derivative
tangent generator, tangent-space Normal sampling, and Emission sampling to the independent
`PbrRenderFeature`. The accepted Phase 2 renderer, visual baselines, and public routes remain
unchanged. Ambient occlusion is deliberately retained for the later IBL indirect-light pass.

## Authoritative clean-room inputs

- [Khronos glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) defines tangent
  vectors as normalized XYZ plus a W handedness sign, reconstructs the bitangent from
  `cross(normal, tangent.xyz) * tangent.w`, defines Normal RGB as linear tangent-space data, applies
  Normal scale to X/Y, and defines Emissive RGB as sRGB data multiplied by its linear factor.
- [Khronos KHR_materials_emissive_strength](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_emissive_strength/README.md)
  defines the nonnegative scalar multiplier applied with the emissive factor and texture.
- [W3C WGSL](https://www.w3.org/TR/WGSL/) defines vertex interpolation, matrix/vector operations,
  texture sampling, and front-facing Fragment input used by the canonical Shader.
- [ADR-002](../adr/ADR-002-coordinate-and-color-conventions.md) keeps Normal orientation conversion
  at the asset/backend boundary. Consequently Y-up/Y-down is immutable `PbrTextureSource`
  metadata, not mutable material state.

No private renderer source, reverse engineering, copied third-party Shader, or external tangent
implementation was used.

## Mesh tangent contract

- `MeshDataDescriptor.tangents` is optional and contains one finite vec4 per vertex.
- Construction Gram-Schmidt orthogonalizes supplied tangent XYZ against the normalized vertex
  Normal, normalizes it, and rejects unusable directions. W must be exactly `-1` or `1`.
- `generateMeshTangents` returns supplied validated Tangents unchanged. Otherwise it accumulates
  Position/UV0 derivatives per indexed triangle, orthogonalizes the result, and computes W from the
  accumulated bitangent orientation.
- A Mesh without UV0 fails closed. Collapsed UV triangles do not produce nonfinite values; affected
  vertices receive a deterministic orthogonal fallback with positive handedness.
- The fallback generator does not claim MikkTSpace equivalence. Asset ingestion should provide
  authored tangents whenever exact interoperability with an authored tangent basis is required.

The generator remains in the Geometry package and is reached by the PBR path only. The Phase 2
Scene path consumes the expanded immutable Mesh contract but does not import or execute tangent
generation.

## Normal and Emission semantics

- The PBR vertex stream is Position vec3 + Normal vec3 + UV0 vec2 + Tangent vec4 at a 48-byte
  stride.
- Normal Texture RGB is sampled as linear data and remapped from `[0, 1]` to `[-1, 1]`. `normalScale`
  multiplies tangent X/Y. Asset metadata multiplies Y by `+1` for `up` or `-1` for `down`.
- The world Tangent is re-orthogonalized against the geometric Normal. The bitangent is
  `cross(N, T) * tangent.w * modelOrientation`, preserving mirrored UV and mirrored model signs.
- Missing Normal maps bind an owned linear `[128, 128, 255, 255]` fallback and select the geometric
  Normal feature key. Missing Emission maps bind the existing owned white sRGB fallback.
- Emissive Texture RGB is hardware-decoded from sRGB, then multiplied in linear light by
  `emissiveFactor * emissiveStrength`. Emission is additive and is not multiplied by direct-light
  intensity or `N·L`.
- Base Color, Metallic-Roughness, Normal, and Emission each retain their own UV0 transform. Other UV
  sets continue to fail with `UNSUPPORTED_CAPABILITY`.

## GPU layout and variants

Group 0 now has a stable nine-entry Bind Group:

| Binding | Resource                   | Interpretation                        |
| ------: | -------------------------- | ------------------------------------- |
|       0 | Per-object Uniform Buffer  | Linear factors, transforms, and light |
|       1 | Base Color Texture         | sRGB RGB / linear alpha               |
|       2 | Base Color Sampler         | Source or fallback sampler            |
|       3 | Metallic-Roughness Texture | Linear G roughness / B metalness      |
|       4 | Metallic-Roughness Sampler | Source or fallback sampler            |
|       5 | Normal Texture             | Linear tangent-space RGB              |
|       6 | Normal Sampler             | Source or fallback sampler            |
|       7 | Emission Texture           | sRGB RGB                              |
|       8 | Emission Sampler           | Source or fallback sampler            |

The aligned public Uniform grows from 352 to 400 bytes / 100 Float32 values. Existing offsets
0–83 remain stable. The appended fields are:

| Field                       | Float offset | Purpose                                   |
| --------------------------- | -----------: | ----------------------------------------- |
| `normalUvOffsetScale`       |           84 | Normal UV offset and scale                |
| `emissiveUvOffsetScale`     |           88 | Emission UV offset and scale              |
| `textureUvRotations`        |           92 | Base Color and Metallic-Roughness cos/sin |
| `normalEmissiveUvRotations` |           96 | Normal and Emission cos/sin               |

`normalOcclusion.z` records Normal-map presence and `.w` records the asset Y sign. AO strength
remains packed but unused by direct lighting.

The feature key already treats Normal-map presence as discrete state. Initialization therefore
prewarms 3 alpha modes × 2 sidedness modes × 2 Normal modes = 12 Pipelines from one Shader Module.
Continuous factor, Emission, and Normal-Y metadata changes do not create unbounded variants.

## Ownership and cache behavior

- Tangents are immutable CPU Mesh data; Mesh-identity GPU Buffer sharing is unchanged.
- Normal and Emission sources remain caller-owned. The Render Feature lazily owns their GPU Texture
  and Sampler Handles and includes them in Entity Bind Group identity and source-retention sets.
- A source replacement rebuilds the source Texture/Sampler and affected Entity Bind Groups while
  retaining Shader, prewarmed Pipelines, Mesh Buffers, and Uniform Buffers.
- Device Lost clears all GPU caches. Feature disposal destroys all fallbacks, source resources,
  Bind Groups, Buffers, Pipelines, Shader Module, depth Texture, and Surface.

## Verification

- Mesh validation and generation tests cover supplied normalization, standard and mirrored UVs,
  handedness, collapsed UVs, missing UV0, immutability, and malformed Tangents.
- Material/Texture tests cover Normal feature identity, asset Y metadata, all four direct-light map
  resources, 400-byte packing, 48-byte vertex upload, cache replacement, Device Lost, and complete
  disposal.
- Canonical WGSL and its runtime mirror are byte-exact.
- Chromium/WebGPU renders Y-up and Y-down from the same tangent-space Normal texel and renders an
  sRGB Emission texel with direct-light intensity zero. Three RGBA8 pixels are read back and compared
  with the CPU BRDF/color-transfer oracle.

## Deferred work

- AO application to indirect diffuse/specular lighting
- HDRI decode, irradiance, prefiltered specular, BRDF LUT, and environment rotation
- exposure, tone mapping, and final output transfer
- MikkTSpace-compatible asset processing, additional UV sets, mip generation, compressed formats,
  image decode, streaming, and general asset loading
- the Phase 3 gallery, public deployment, owner acceptance, and immutable Accepted Tag
