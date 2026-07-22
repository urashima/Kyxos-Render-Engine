# Phase 3 Renderer IBL Contract

## Checkpoint

P3-08 binds the prefiltered P3-07 environment resources into `PbrRenderFeature`. It adds
split-sum indirect lighting, material Occlusion on indirect light only, and explicit environment
rotation/intensity controls. Phase 3 remains In Development.

## Clean-room sources

- [Khronos glTF 2.0 Appendix B](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#appendix-b-brdf-implementation)
  for metallic-roughness color allocation and the direct-light BRDF convention.
- [Khronos glTF IBL Sampler](https://github.com/KhronosGroup/glTF-IBL-Sampler) for the public
  Diffuse Irradiance cube, GGX Specular mip chain, and two-channel BRDF LUT workflow.
- [W3C WebGPU](https://www.w3.org/TR/webgpu/) and [W3C WGSL](https://www.w3.org/TR/WGSL/) for
  Cube Texture Views, explicit mip sampling, Bind Group layout, and Shader execution.
- The repository's P3-06 deterministic oracle freezes the `E` versus `E/pi` convention and the
  split-sum scale/bias equation. P3-07 freezes Texture formats, cube-face order, identity, and GPU
  ownership.

No external Renderer source or third-party Shader body was copied.

## Shading contract

- The Diffuse Cube stores physical irradiance `E`. Runtime diffuse is
  `E * baseColor * (1 - metallic) / pi`.
- Specular is `prefilteredRadiance * (F0 * scale + bias)`, where the BRDF LUT is sampled at
  `(N dot V, perceptualRoughness)`.
- Specular mip LOD is `perceptualRoughness * (mipLevelCount - 1)`.
- Direct light remains the P3-02/P3-03 GGX/Smith/Schlick result and is not multiplied by material
  Occlusion.
- Effective AO is `mix(1, occlusion.r, occlusionStrength)` and multiplies only the sum of indirect
  Diffuse and Specular.
- Environment intensity is a finite nonnegative linear multiplier on indirect light only.
- Environment rotation is a world-to-environment rotation about positive Y. A positive quarter
  turn maps world positive Z to environment negative X. Background rotation is deferred and must
  later reuse this convention.
- Emission remains independent of direct and indirect lighting.

## Binding and ownership

- The existing 12 alpha/sidedness/Normal Pipeline variants remain bounded. Environment presence,
  identity, intensity, rotation, and AO do not create Shader variants.
- Group 0 adds linear Occlusion Texture/Sampler bindings to the existing per-object material set.
- Group 1 contains Diffuse Cube, Specular Cube, shared Cube Sampler, BRDF LUT, and LUT Sampler. One
  Bind Group is created per Pipeline because Backend Bind Groups retain their originating Pipeline
  identity.
- A black one-level environment is the no-environment fallback, so existing direct-only rendering
  remains numerically unchanged without a second Shader variant.
- `EnvironmentGpuCache` owns environment Textures/Samplers. The Render Feature owns only its Lease
  and Pipeline-specific Bind Groups. Environment source replacement constructs the full new set
  before swapping, then releases the previous set.
- Continuous intensity/rotation changes update only per-object Uniform data. They do not recreate
  Pipelines, environment resources, or Bind Groups.
- Device Lost preserves the logical environment Lease through the P3-07 cache and rebuilds new
  Handles before the feature recreates Group 1 bindings.

## Verification

- CPU tests mirror physical Irradiance, split-sum Specular, effective AO, and intensity.
- Renderer tests cover the 448-byte Uniform, 11-entry material group, 5-entry environment group,
  Pipeline-specific bindings, environment replacement, Device Lost, and zero-Handle disposal.
- Chromium/WebGPU compiles the independent IBL Shader, selects the negative-X face through a
  positive quarter-turn, selects the last Specular mip at roughness one, samples the LUT and AO,
  and compares the rendered pixel with the CPU oracle while retaining nonzero direct light to prove
  that AO affects only the indirect term.

## Deferred scope

- HDR/RGBE/EXR/KTX2 decoding and equirectangular-to-cube preprocessing
- Runtime convolution, persistent cache, and authored environment asset loading
- Environment background rendering and independent background visibility
- Exposure, tone mapping, Phase 3 gallery/presets, performance evidence, public deployment, owner
  acceptance, and the immutable Phase 3 Accepted Tag
