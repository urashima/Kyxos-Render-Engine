# Phase 3 P3-04 — PBR factor-map and sampled-resource contract

Status: Implemented checkpoint (Phase 3 remains In Development)

This record freezes the P3-04 boundary. P3-05 subsequently implements the deferred Normal and
Emission path and extends the live layouts; see
[phase-03-normal-emission.md](./phase-03-normal-emission.md). The P3-04 evidence remains unchanged.

## Scope

P3-04 extends the backend-neutral resource contract with sampled Texture and Sampler Bind Group
entries, adds validated RGBA8 Texture uploads, and connects Base Color plus Metallic-Roughness maps
to the independent `PbrRenderFeature`. The accepted Phase 2 renderer and its baselines remain
unchanged.

## Authoritative clean-room inputs

- [Khronos glTF 2.0 Specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
  defines Base Color as non-premultiplied RGBA with sRGB RGB channels and linear alpha, defines
  Metallic-Roughness as a linear texture with roughness in G and metalness in B, and defines absent
  texture components as `1.0` before factor multiplication.
- [Khronos KHR_texture_transform](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_texture_transform)
  defines transformed UV as offset plus rotation applied after scale.
- [W3C WebGPU](https://www.w3.org/TR/webgpu/) defines `GPUQueue.writeTexture`, sampled Texture and
  Sampler Bind Group resources, Texture usage validation, and destroyed-resource behavior.
- [W3C WGSL](https://www.w3.org/TR/WGSL/) defines `texture_2d<f32>`, `sampler`, `textureSample`, and
  resource binding declarations.

No private renderer source, reverse engineering, or copied third-party Shader was used.

## Frozen backend contract

- `BackendBindGroupEntry.resource` is a runtime-validated union of exactly one Buffer, sampled
  Texture, or Sampler Handle.
- Sampled Texture entries reject depth, multisampled, non-sampled, stale, or foreign resources.
- Draw submission revalidates every resource retained by a Bind Group so destroying a dependency
  cannot silently submit an invalid frame.
- `writeTexture` currently supports single-sampled 4-byte RGBA/BGRA color formats. It validates
  `copy-dst`, mip level, origin, extent, row layout, source byte length, and subresource bounds.
- Native `GPUDevice`, `GPUTexture`, `GPUTextureView`, and `GPUSampler` objects remain inside the
  WebGPU backend; public consumers receive only opaque Handles.

## Frozen material and Shader contract

Group 0 uses a stable five-entry layout for every one of the six existing pipelines:

| Binding | Resource                   | Transfer / channels                   |
| ------: | -------------------------- | ------------------------------------- |
|       0 | Per-object Uniform Buffer  | Linear factors, transforms, and light |
|       1 | Base Color Texture         | RGBA; RGB sRGB-decoded, alpha linear  |
|       2 | Base Color Sampler         | Source sampling descriptor            |
|       3 | Metallic-Roughness Texture | Linear; G roughness, B metalness      |
|       4 | Metallic-Roughness Sampler | Source sampling descriptor            |

- Missing maps bind owned 1×1 white Textures. Therefore the sampled value is exactly `1.0`, and
  factor-only P3-03 output remains valid without a separate Shader variant.
- Base Color sample multiplies `baseColorFactor`; Metallic-Roughness G/B multiply the corresponding
  roughness/metallic factors before the established P3-02 BRDF.
- Vertex data is Position + Normal + UV0 at a 32-byte stride. A mapped material on a Mesh without
  UV0 fails closed.
- Each supported map applies `offset + rotation(uv0 * scale)`. Only `texCoord = 0` is claimed in this
  checkpoint; other UV sets fail with `UNSUPPORTED_CAPABILITY`.
- The public per-object layout is 352 bytes / 88 Float32 values. The final 48 bytes contain the two
  offset/scale vectors and packed cosine/sine rotations.

## CPU and GPU ownership

- `PbrTextureSource` owns an immutable copy of validated RGBA8 bytes and a normalized Sampler
  descriptor.
- A supplied `PbrTextureLibrary` and every registered source remain caller-owned. An omitted library
  is owned and disposed by the Render Feature.
- `PbrRenderFeature` lazily creates and owns Texture/Sampler Handles per source identity. Replacing a
  library entry rebuilds only affected Texture, Sampler, and Entity Bind Groups; the six Pipelines,
  Shader Module, Mesh Buffers, and Uniform Buffers remain stable.
- Source caches are retained while any Entity Bind Group references them, reconciled after each
  frame, forgotten after Device Lost, and destroyed during feature disposal.

## Verification

- Backend, browser-port, Mock Backend, Texture-library, UV packing, cache replacement, Device Lost,
  and zero-resource disposal unit tests.
- Exact canonical WGSL/runtime mirror validation.
- Chromium/WebGPU renders a 2×2 sRGB Base Color map and a 2×2 linear Metallic-Roughness map through
  distinct UV offsets, then reads RGBA8 back and compares it with the CPU BRDF and transfer-function
  oracle.

## Deferred work

- Normal, occlusion, and emissive sampling
- tangent generation and tangent-space Normal Y switching
- additional Mesh UV sets
- mip generation, compressed formats, image decode, streaming, and general asset loading
- HDRI/IBL, exposure, and tone mapping
- the Phase 3 gallery, public deployment, owner acceptance, and immutable Accepted Tag
