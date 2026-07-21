# ADR-002: Coordinate and Color Conventions

- **Status:** Accepted
- **Date:** 2026-07-21
- **Owners:** Math, assets, renderer, graphics backends

## Context

Scene transforms, imported assets, cameras, lighting, temporal reprojection, picking, and both graphics backends must agree on one mathematical convention. Ad hoc transposes, handedness flips, gamma conversions, or NDC corrections distributed through feature code would make visual and temporal errors difficult to isolate.

## Decision

### World and transform convention

- World space is right-handed and Y-up.
- Cameras look along local negative Z; local positive X is right and local positive Y is up.
- One engine distance unit represents one meter unless an imported asset declares a conversion.
- Vectors are treated as column vectors.
- Matrices are stored column-major and compose as `world = parentWorld × local`.
- A local TRS transform composes as `T × R × S`; the rightmost operation acts first.
- Quaternions are stored `(x, y, z, w)`, use right-handed positive rotation, are normalized at public construction boundaries, and compose in the same parent-to-child order as transforms.
- Angles in public and internal APIs use radians unless a property explicitly says otherwise.

Asset loaders convert source conventions once at the loader boundary. Scene, Material, Render Graph, and feature code operate only in engine convention.

### Clip and screen convention

The engine's canonical projection uses a zero-to-one depth range. WebGPU can consume it directly. WebGL2 applies its required clip-space/depth conversion inside the WebGL2 backend or its backend-specific projection adapter. No Scene or Material code branches on backend NDC rules.

Viewport and presentation origin differences are likewise backend/platform concerns. Readback and capture APIs return documented top-left-oriented images.

### Color convention

- Lighting, BRDF evaluation, blending inputs, HDR buffers, and temporal history operate in linear light.
- Color textures such as base color and emissive are decoded from their declared transfer function, normally sRGB, at sampling/upload boundaries.
- Data textures such as normal, roughness, metalness, occlusion, depth, motion, and masks are sampled as linear data and never receive an sRGB transform.
- Authoring colors entering through the public SDK declare or use a documented color space and are converted once to linear values.
- Tone mapping and output transfer encoding happen near the Present pass, after HDR post-processing.
- Alpha coverage/transparency semantics are declared by the material; transfer conversion never modifies alpha.

Exact GPU formats belong to feature contracts and capability negotiation, but their color/data interpretation must follow these rules.

## Consequences

- Importers and backends own all required coordinate conversions.
- CPU math, WGSL, and GLSL tests can use the same reference vectors and matrices.
- Temporal reprojection can compare current and previous matrices without hidden handedness changes.
- Normal-map orientation corrections are asset/backend boundary metadata, not arbitrary material flags.
- Debug views must label whether displayed values are linear data, encoded color, depth, or motion.

## Alternatives rejected

- **Backend-native conventions throughout the renderer:** spreads conditional transforms across every feature.
- **Row vectors or row-major public math:** conflicts with the selected Shader and asset conventions and would require repeated transposes.
- **Gamma-space lighting or blending:** is physically incorrect and produces unstable post-processing and temporal results.
- **Implicit unit inference:** makes lighting range, camera clipping, and physically based asset interchange unpredictable.
