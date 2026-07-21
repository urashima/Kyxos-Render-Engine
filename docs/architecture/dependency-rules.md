# Dependency Rules

## Rule hierarchy

Runtime dependencies flow downward only:

```text
Product application
→ Integration adapter
→ Public SDK
→ Feature modules and render pipeline
→ Renderer Core
→ Graphics backend contract
→ WebGPU or WebGL2 implementation
```

Lower layers never import higher layers. Interfaces, opaque handles, immutable descriptors, typed events, and command APIs are the allowed communication mechanisms.

## Current allowed edges

| From                     | May import at runtime                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `render-core`            | No engine package                                                                                         |
| `render-math`            | No engine package                                                                                         |
| `render-geometry`        | `render-math`                                                                                             |
| `render-scene`           | `render-core`, `render-math`                                                                              |
| `render-camera`          | `render-core`, `render-math`, `render-scene`                                                              |
| `render-visibility`      | `render-camera`, `render-core`, `render-geometry`, `render-math`, `render-scene`                          |
| `render-backend-api`     | `render-core`                                                                                             |
| `render-backend-webgpu`  | `render-backend-api`, `render-core`                                                                       |
| `render-frame-scheduler` | `render-core`                                                                                             |
| `render-renderer`        | `render-backend-api`, `render-core`, `render-frame-scheduler`                                             |
| `render-sdk`             | `render-backend-api`, `render-backend-webgpu`, `render-core`, `render-frame-scheduler`, `render-renderer` |
| `render-testing`         | `render-backend-api`, `render-core`, `render-frame-scheduler`                                             |
| `render-playground`      | `render-sdk`, `render-testing`                                                                            |

`render-testing` is development support. A production engine package may use it only from tests or development-only dependencies; it must not enter a production source graph.

The SDK is the browser composition root: it may instantiate a selected concrete backend, but all Renderer and feature communication still uses `GraphicsBackend`. Adding another concrete backend to this edge requires its own phase acceptance and must not leak native objects through SDK declarations.

## Forbidden dependencies

The following are gate failures:

- A workspace import through a private subpath, such as `@kyxos/render-sdk/src/*`.
- A relative import crossing a package root.
- A runtime manifest edge outside the allowed table.
- Any production dependency cycle.
- React, React DOM, Next.js, Zustand, or Texture Lab in engine runtime source.
- Backend code importing Scene, Material, Renderer, Integration, or product code.
- Renderer Core importing DOM panels, product routes, stores, or analytics.
- Product code accessing `GPUDevice`, WebGL contexts, Render Graph internals, or Shader caches.
- A global mutable singleton used to bypass the declared graph.

## Public entry policy

Each package's `exports` map exposes only `.`. Cross-package consumers import the package root. Product applications import only `@kyxos/render-sdk`, except that Texture Lab will import its dedicated integration adapter when Phase 11 introduces it.

Public API values must not reveal backend-native GPU objects. Capabilities and diagnostics are immutable data; resources are addressed by opaque handles and released through explicit ownership APIs.

## Automated enforcement

`pnpm check:boundaries` performs both sides of the contract:

1. It scans workspace production manifests and TypeScript source imports, constructs the runtime graph, rejects cycles and prohibited edges, and prints the accepted graph.
2. It scans a deliberate Renderer-to-SDK violation and succeeds only when that fixture is rejected.

The second check protects against a broken or accidentally disabled rule engine producing a false PASS.

`pnpm verify` runs this gate before acceptance. GitHub Actions runs the same command on Phase branches and pull requests.

## Adding a package or edge

Before adding a package or runtime edge:

1. Place the package at one explicit layer.
2. List its owner, public contract, resource lifetime, and allowed consumers.
3. Update this document and `tools/quality/check-boundaries.mjs` in the same change.
4. Add a positive build or consumer test and, for a new restriction, a negative fixture.
5. Confirm WebGPU and WebGL2 responsibilities remain separated behind the backend contract.
6. Use an ADR if the edge changes a public boundary or reverses an accepted architecture decision.

Convenience alone is not a reason to add an upward dependency.
