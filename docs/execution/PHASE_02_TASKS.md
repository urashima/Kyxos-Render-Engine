# Phase 02 Tasks — Scene, Camera, Geometry, and Basic Rendering

Phase 2 starts from accepted tag `phase-01-accepted` and branch base `1244a06f9c02b3aed3bdbbd6bd7e883ae8ecf72f`.

| ID    | Task                                                                              | Depends on              | Verification                                                                      | Status         |
| ----- | --------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------- | -------------- |
| P2-01 | Implement math primitives, TRS matrices, AABB, spheres, and frusta                | Phase 1, ADR-002        | Reference-vector tests; finite guards; transform/projection/frustum invariants    | Completed      |
| P2-02 | Implement immutable Mesh data, validation, bounds, and Plane/Cube/Sphere builders | P2-01                   | Geometry counts, winding, normals, bounds, 16/32-bit indices, invalid-input tests | Completed      |
| P2-03 | Implement Entity Scene Graph, local/world Transform, hierarchy, and dirty flow    | P2-01                   | Parent/reparent/remove tests; deep dirty propagation; cycle and nonfinite guards  | Completed      |
| P2-04 | Implement perspective Camera, Orbit Controller, and automatic framing             | P2-01,P2-03             | Projection/look tests; DOM-free orbit tests; fitted bounds coverage               | Completed      |
| P2-05 | Implement layer/frustum visibility and opaque/transparent Render Queues           | P2-01,P2-02,P2-03       | Offscreen exclusion; stable opaque keys; predictable transparency ordering        | Completed      |
| P2-06 | Connect Scene submission to Renderer and the public SDK                           | P2-02,P2-03,P2-04,P2-05 | Backend-neutral Draw List tests; no native GPU or private package exposure        | Completed      |
| P2-07 | Add the independent `/acceptance/phase-02` Playground route                       | P2-06                   | Primitive, hierarchy, orbit/framing, culling, ordering, and diagnostic flows      | Completed      |
| P2-08 | Add deterministic visual, behavior, performance, and lifecycle evidence           | P2-07                   | Reference/Current/Difference; draw/visible counts; Phase 1 budget comparison      | In Development |
| P2-09 | Complete CI, technical QA, autonomous owner review, PR, merge, and accepted tag   | P2-08                   | All gates green; `phase-02-accepted` resolves to the accepted merge               | Planned        |

## Required architecture boundaries

- `@kyxos/render-math` is dependency-free and owns the right-handed, Y-up, column-vector conventions frozen by ADR-002.
- Geometry owns CPU mesh data and bounds but cannot import Scene, Renderer, SDK, or a concrete graphics backend.
- Scene owns hierarchy and component handles but cannot submit GPU commands.
- Visibility consumes scene/camera/bounds data and emits backend-neutral Render Items only.
- Renderer consumes prepared Render Items through public package roots; no lower layer imports Renderer or SDK.
- Orbit input adaptation stays in the SDK/Playground boundary; camera math and controller state remain DOM-independent and testable.

## Minimum implementation order

1. Finite math values, transforms, projections, bounds, and frusta.
2. Validated mesh data and deterministic primitive builders.
3. Hierarchy ownership and transform dirty propagation.
4. Camera projection, orbit behavior, and bounds framing.
5. Frustum/layer selection and deterministic queue sorting.
6. Renderer/SDK composition, acceptance route, and evidence.
