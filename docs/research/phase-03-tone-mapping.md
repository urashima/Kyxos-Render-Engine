# Phase 3 HDR Output Transform Contract

## Checkpoint

P3-09 adds a deterministic display transform after the P3-08 linear direct-light, indirect IBL,
and Emission sum. The order is fixed as linear HDR composition, EV exposure, Khronos PBR Neutral
tone mapping, and one sRGB output transfer. Phase 3 remains In Development.

## Clean-room sources

- [Khronos PBR Neutral specification](https://github.com/KhronosGroup/ToneMapping/tree/main/PBR_Neutral)
  defines the highlight-compression and desaturation curve for nonnegative linear Rec.709 input and
  bounded linear Rec.709 output. The repository is Apache-2.0 licensed.
- [Khronos PBR Neutral sample formula](https://github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/pbrNeutral.glsl)
  is used only to cross-check the independently written TypeScript and WGSL equations.
- [W3C CSS Color 4 sample conversion code](https://www.w3.org/TR/css-color-4/#color-conversion-code)
  records the IEC sRGB piecewise transfer used by the existing Material Core color contract.
- [W3C WebGPU](https://www.w3.org/TR/webgpu/) and [W3C WGSL](https://www.w3.org/TR/WGSL/)
  define normalized render-target storage and Shader arithmetic.

No private Renderer code, assets, or non-public implementation details were used.

## Numerical contract

- Every direct, indirect, and Emission term is composed in nonnegative linear Rec.709 before the
  output transform.
- Public exposure is measured in EV stops. The linear multiplier is `2^exposure`; the supported
  deterministic range is -32 through +32 EV and the default is 0 EV.
- The default mode is `khronos-pbr-neutral`. It preserves the official `0.04` dielectric headroom,
  starts highlight compression at `0.76`, and uses the official `0.15` desaturation rate.
- The explicit `none` mode clips exposed linear RGB to `[0, 1]`; it does not bypass the final output
  transfer.
- Both modes apply the piecewise sRGB transfer exactly once before writing the current
  `rgba8unorm` or `bgra8unorm` surface. Alpha is not exposure-adjusted, tone-mapped, or encoded.
- Negative or non-finite HDR inputs and unsupported output state are rejected by the CPU oracle.

## Renderer contract

- `PbrRenderFeature` owns immutable output state and exposes `setOutputTransform`. Exposure and
  mode changes update object Uniforms only; they do not create Shader, Pipeline, Bind Group,
  Texture, Sampler, or Buffer variants.
- The 448-byte object Uniform remains unchanged. The former reserved components of
  `environmentControls` now store exposure multiplier and the PBR Neutral enable flag.
- A separate canonical P3-09 Shader is used by the feature. The P3-03 direct-light and P3-08 raw
  linear IBL Shaders remain byte-for-byte historical validation inputs.
- The current forward path applies the display transform per fragment. The fixed Phase 3 gallery
  uses opaque material spheres; linear HDR transparent-layer composition through an intermediate
  target belongs to the later PostFX/Render Graph phase.

## Verification

- Material PBR tests cover EV multiplication, the official curve anchors, bounded output, explicit
  clipped mode, sRGB encoding, and invalid input rejection.
- Renderer tests prove the output state occupies only the two reserved Uniform components and that
  changing exposure or mode does not alter GPU Handle counts.
- SDK-only consumer coverage proves the output oracle is available without importing package
  internals.
- Chromium/WebGPU compiles the exact runtime Shader, creates a known HDR Emission value, applies
  +1 EV, PBR Neutral, and explicit sRGB encoding, then compares the RGBA8 readback with the CPU
  oracle channel by channel.

## Deferred scope

- HDR panorama decoding and runtime environment preprocessing
- Environment background rendering and background/lighting visibility separation
- Intermediate HDR targets and linear composition of multiple transparent layers
- Phase 3 gallery, visual baselines, performance evidence, public deployment, owner acceptance, and
  the immutable Phase 3 Accepted Tag
