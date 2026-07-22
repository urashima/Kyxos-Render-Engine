# Phase 3 Environment Resource Contract

## Checkpoint

P3-07 establishes immutable environment identity and GPU resource ownership before indirect IBL is
bound into `PbrRenderFeature`. It does not claim HDR panorama decoding, filtering, material lighting,
AO, background rendering, exposure, or tone mapping.

## Clean-room sources

- [W3C WebGPU specification](https://www.w3.org/TR/webgpu/) for Texture formats, array layers,
  Texture View dimensions, queue Texture writes, sampler state, resource destruction, and Device
  Lost behavior.
- [Khronos glTF IBL Sampler](https://github.com/KhronosGroup/glTF-IBL-Sampler) for the public
  diffuse-cube, GGX specular-mip-chain, and BRDF-LUT preprocessing model.
- [Khronos glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) for the
  metallic-roughness and linear-light semantics consumed by the later Renderer checkpoint.

No third-party Renderer source or Shader implementation was copied.

## CPU identity and ownership

- `EnvironmentSource` is immutable and caller-owned.
- Identity contains the trimmed asset id, caller-controlled immutable version, Texture dimensions,
  mip structure, and deterministic checksum of the encoded Diffuse, Specular, and LUT payloads.
- Cube layer order is fixed to positive X, negative X, positive Y, negative Y, positive Z, negative
  Z, matching a six-layer WebGPU cube view.
- Diffuse Irradiance is one `rgba16float` cube level.
- GGX Specular Prefilter is a complete `rgba16float` mip chain from the supplied base face size to
  1×1. Missing levels fail validation rather than being synthesized silently.
- BRDF LUT is linear `rg16float`; inputs are interleaved scale/bias pairs.
- Source floats are copied and deterministically encoded to IEEE-754 binary16. Radiance must be
  finite, non-negative, and representable; LUT values must remain in 0–1.
- `EnvironmentLibrary` stores sources without taking ownership and emits explicit set, replacement,
  and removal revisions.

## GPU cache and lifecycle

- `EnvironmentGpuCache` exclusively owns the three Texture Handles and two Sampler Handles created
  for each source identity.
- Repeated acquisitions share one entry and return reference-counted Leases. The last release
  destroys the complete five-Handle set.
- Cube Texture bindings carry an explicit `cube` Texture View descriptor; BRDF LUT bindings carry an
  explicit `2d` view. Native `GPUTextureView` objects never cross the Backend boundary.
- Every Specular mip is uploaded as six array layers with a fixed per-level byte layout.
- Device Lost invalidates only device-owned Handles. Logical cache entries and Lease counts remain,
  and a later `initialize()` atomically recreates every retained environment on the ready Backend.
- Failed creation or restoration rolls back all Handles created by that attempt.
- Cache disposal is idempotent, releases every live Handle, and never disposes caller-owned Sources
  or Libraries.

## Deferred scope

- HDR/RGBE/EXR/KTX2 decoding
- Equirectangular-to-cube conversion
- Runtime Compute convolution and persistent IndexedDB caching
- Renderer IBL Bind Groups, AO, environment rotation, intensity, and background separation
- Exposure and tone mapping
- Phase 3 gallery, performance evidence, public deployment, owner acceptance, and Accepted Tag
