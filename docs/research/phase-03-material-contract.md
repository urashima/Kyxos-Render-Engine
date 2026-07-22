# Phase 3 Material and Color Contract

## Scope

This record freezes the clean-room inputs and implementation decisions for checkpoint P3-01. It
covers material state, texture semantics, color transfer, UV transforms, and deterministic cache
keys. BRDF evaluation, GPU bindings, shaders, IBL preprocessing, and tone mapping remain later
Phase 3 checkpoints.

P3-05 subsequently implements tangent-space Normal and Emission sampling while preserving this
CPU material contract; see [phase-03-normal-emission.md](./phase-03-normal-emission.md).

## Authoritative inputs

- [Khronos glTF 2.0 Specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
  defines the metallic-roughness material defaults, texture channel packing, transfer functions,
  normal-map interpretation, occlusion behavior, alpha modes, and double-sided state.
- [W3C CSS Color Module Level 4](https://www.w3.org/TR/css-color-4/) provides the piecewise extended
  sRGB to linear-light transfer functions and their inverse.

No private renderer source, reverse engineering, or copied third-party implementation was used.

## Frozen decisions

### Color and transfer functions

- Material computations use linear-light RGB.
- `base-color` and `emissive` textures declare the `srgb` transfer function.
- `metallic-roughness`, `normal`, and `occlusion` textures declare the `linear` transfer function.
- RGB transfer helpers preserve finite extended-range values; alpha is never transfer encoded.
- Unit-range material factors are validated separately from extended-range transfer helpers.

### Texture semantics

| Semantic           | Channels                 | Transfer function |
| ------------------ | ------------------------ | ----------------- |
| base-color         | RGBA                     | sRGB              |
| emissive           | RGB                      | sRGB              |
| metallic-roughness | G roughness, B metalness | linear            |
| normal             | RGB                      | linear            |
| occlusion          | R                        | linear            |

Texture references are engine-neutral IDs. Bindings add an immutable UV set, offset, scale, and
rotation without depending on a GPU backend or asset loader.

### Variant and binding identity

- The feature key contains only discrete pipeline or shader choices currently needed by the base
  material contract: alpha mode, double-sided state, and normal-map presence.
- Continuous factors do not create shader variants.
- Base color, emissive, metallic-roughness, and occlusion texture presence does not create a variant;
  later renderer integration must bind defined fallback resources for absent textures.
- The binding key includes texture identity, declared transfer function, UV set, and UV transform for
  every slot in a fixed order.
- Equivalent descriptors produce identical keys regardless of object insertion order.

## Deferred requirements

The following are deliberately not claimed by P3-01:

- BRDF equations or energy compensation
- tangent-space normal reconstruction and Normal Y switching
- GPU uniform/storage layout
- shader module, pipeline, or bind-group cache implementation
- HDRI decode, irradiance, prefiltered specular, BRDF LUT, or environment rotation
- tone mapping, exposure, or a Phase 3 Playground route

These must consume this contract through public package exports rather than duplicating material
state inside the renderer or Playground.
