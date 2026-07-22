# Phase 3 P3-06 — Deterministic split-sum IBL reference

Status: Implemented checkpoint (Phase 3 remains In Development)

## Scope

P3-06 adds a deterministic CPU reference and byte-exact WGSL mirror for the three numerical parts
of the base image-based-lighting pipeline:

- cosine-weighted diffuse irradiance
- GGX specular environment prefiltering
- the two-channel split-sum BRDF integration LUT

The checkpoint is a correctness oracle. It does not create environment Textures, decode HDR files,
allocate Cubemaps, select mip levels, bind IBL resources to the Renderer, or claim Phase 3
acceptance.

## Authoritative clean-room inputs

- [Khronos glTF IBL Sampler](https://github.com/KhronosGroup/glTF-IBL-Sampler) defines the official
  glTF sample-environment workflow of Lambertian filtering, GGX mip filtering, and a BRDF LUT. Its
  [filtering Shader](https://github.com/KhronosGroup/glTF-IBL-Sampler/blob/main/lib/source/shaders/filter.frag)
  documents Hammersley sampling, cosine-weighted diffuse convolution, GGX half-vector sampling,
  `N·L` prefilter normalization, and split-sum scale/bias integration.
- [Khronos glTF 2.0 Appendix B](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#appendix-b-brdf-implementation)
  is the existing P3-02 source for perceptual roughness, GGX, Smith visibility, and Schlick Fresnel.
- Brian Karis, [Real Shading in Unreal Engine 4](https://blog.selfshadow.com/publications/s2013-shading-course/karis/s2013_pbs_epic_notes_v2.pdf),
  introduces the split-sum environment approximation and the `F0 * scale + bias` LUT form.
- [W3C WGSL](https://www.w3.org/TR/WGSL/) defines the unsigned bit operations, floating-point
  functions, storage-buffer layout, and compute execution used by the GPU reference.

The Kyxos implementation was written independently from these equations. No external Renderer
source, third-party Shader body, texture asset, or random input is copied into the repository.

## Frozen deterministic contract

- The gate uses 64 unsigned Hammersley points: `(i / 64, reverseBits32(i) / 2^32)`.
- CPU callers may request 1 through 4,096 samples. The canonical CPU/WGSL gate always uses 64.
- A deterministic asymmetric analytic RGB environment replaces a sampled texture so the checkpoint
  can isolate integration math from image decode, Cubemap orientation, filtering, and resource
  ownership.
- Sampling directions use a normalized right-handed tangent frame with a fixed alternate axis near
  the positive or negative Z pole.
- CPU inputs, sample order, coordinate basis, roughness mapping, accepted domains, and WGSL literals
  are fixed. No frame index, clock, random number, browser state, or global mutable cache participates.

## Diffuse convention

Cosine-weighted hemisphere sampling has PDF `(N·L) / pi`. The reference records both quantities so
the later runtime cannot silently lose or duplicate a factor of pi:

- physical irradiance `E = pi * average(environment samples)`
- Lambertian outgoing-radiance factor `E / pi = average(environment samples)`

The future Renderer multiplies the second value by diffuse material color, or equivalently
multiplies physical irradiance by `diffuseColor / pi`.

## GGX prefilter convention

- Perceptual roughness is squared to alpha and retains the P3-02 finite floor.
- Each Hammersley point importance-samples a GGX half vector around the reflection direction with
  the prefilter assumption `V = N = R`.
- The reflected light direction is accepted only when `N·L > 0`.
- Environment radiance is weighted by `N·L` and divided by the accumulated accepted weight.
- The oracle deliberately omits texture-PDF mip selection because it has no texture resolution or
  mip chain. That contract belongs to the environment-resource checkpoint.

## BRDF LUT convention

The two channels satisfy the future runtime form:

`specularIBL = prefilteredRadiance * (F0 * scale + bias)`

For each accepted GGX half-vector sample:

- `Fc = (1 - V·H)^5`
- `visibilityOverPdf = 4 * V(alpha, N·L, N·V) * (V·H) * (N·L) / (N·H)`
- `scale += (1 - Fc) * visibilityOverPdf`
- `bias += Fc * visibilityOverPdf`

Both channels are divided by the full sample count. `V` is the exact separable Smith visibility
already frozen by P3-02, keeping the direct and indirect Kyxos numerical contracts coherent.
`N·V = 0` is evaluated at the shared finite floor while retaining the requested zero as the LUT
coordinate.

## Verification

- Unit tests freeze bit reversal, the first Hammersley points, constant-environment diffuse and
  specular identities, the smooth-reflection limit, roughness direction, LUT domain behavior,
  malformed-input rejection, repeatability, and the canonical numeric result.
- An SDK-only consumer reaches the oracle exclusively through `@kyxos/render-sdk`.
- The Shader validator requires an exact source/runtime mirror.
- Chromium/WebGPU compiles and executes the 64-sample compute Shader, reads back 16 float32 values,
  and compares physical irradiance, `E/pi`, prefiltered RGB, and LUT scale/bias/input against the CPU
  oracle with an absolute tolerance of `0.0005`. The unnormalized diagnostic prefilter-weight sum
  uses `0.001`; it accumulates 64 float32 terms and is not a shading output. The normalized
  prefiltered RGB remains under the stricter `0.0005` gate.
- CI retains `test-results/phase-03/runtime/ibl-reference.json`, including compiler messages, every
  CPU/GPU value, every absolute difference, each field's tolerance, and the maximum tolerance
  ratio.

## Deferred work

- HDR and EXR decode, equirectangular-to-Cubemap conversion, and coordinate-orientation fixtures
- sampled Cubemap resources, mip generation, PDF-to-LOD selection, and GPU preprocessing passes
- environment identity, cache ownership, Device Lost recovery, disposal, rotation, and intensity
- PBR Renderer integration of diffuse/specular IBL and AO on indirect light only
- exposure, tone mapping, gallery visuals, performance evidence, Pages deployment, owner acceptance,
  and the immutable Phase 3 Accepted Tag
