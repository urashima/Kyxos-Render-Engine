# Phase 3 Metallic-Roughness BRDF Reference

## Scope

Checkpoint P3-02 adds a deterministic CPU reference and an equivalent WGSL implementation for the
base glTF metallic-roughness BRDF. It is a correctness oracle for later Renderer integration, not a
claim that Phase 3 rendering, IBL, or acceptance is complete.

## Authoritative input

- [Khronos glTF 2.0 Appendix B](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#appendix-b-brdf-implementation)
  defines the informative realtime model used here: perceptual roughness squared to alpha,
  Trowbridge-Reitz/GGX distribution, separable Smith masking-shadowing, Schlick Fresnel, Lambert
  diffuse, dielectric F0 of 0.04, and metallic interpolation.

No private renderer source or copied third-party shader was used.

## Frozen equations and conventions

- `alpha = max(roughness², 0.0001)`. The floor is a Kyxos realtime regularization that replaces the
  non-finite delta limit at roughness zero and is identical in CPU and WGSL paths.
- Specular uses `F * D * V`, where `V = G / (4 |N·L| |N·V|)` is the separable Smith visibility form
  given by the glTF appendix.
- Diffuse uses `(1 - F) * diffuseColor / pi`.
- `diffuseColor = baseColor * (1 - metallic)`.
- `F0 = mix(0.04, baseColor, metallic)`.
- A light or view below the shading hemisphere contributes a zero BRDF.
- The function returns a BRDF value. Light radiance, `N·L`, occlusion, emission, exposure, and tone
  mapping are later pipeline stages.

## Verification strategy

- CPU unit tests freeze equation reference points, metallic diffuse removal, roughness direction,
  reciprocity, invalid inputs, and hemisphere rejection.
- The canonical WGSL source is mirrored byte-for-byte into TypeScript and checked by the Shader
  validator.
- GitHub Actions compiles the WGSL in Chromium/WebGPU, executes a one-workgroup compute reference,
  reads back float32 diffuse/specular/total values, and compares them with the CPU reference.

## Deferred work

- height-correlated Smith and multiple-scattering compensation
- Burley diffuse selection and visual comparison
- tangent-space normal reconstruction
- direct-light and IBL integration
- production shader variants, pipeline cache, and bind-group cache
