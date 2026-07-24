from pathlib import Path


def edit(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise RuntimeError(f'{path}: expected source not found: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1))

# Owner-scoped current velocity target. It is not ping-ponged because velocity is only consumed by the current resolve.
edit('packages/renderer/src/dynamic-taa-gpu-history.ts',
"const CURRENT_COLOR_BYTES_PER_TEXEL = 8;\nconst RESOLVED_SET_BYTES_PER_TEXEL = 8 + 4 + 8;",
"const CURRENT_COLOR_BYTES_PER_TEXEL = 8;\nconst CURRENT_VELOCITY_BYTES_PER_TEXEL = 4;\nconst RESOLVED_SET_BYTES_PER_TEXEL = 8 + 4 + 8;")
edit('packages/renderer/src/dynamic-taa-gpu-history.ts',
"  readonly currentColorTexture: BackendTextureHandle;\n  readonly historyValid: boolean;",
"  readonly currentColorTexture: BackendTextureHandle;\n  readonly currentVelocityTexture: BackendTextureHandle;\n  readonly historyValid: boolean;")
edit('packages/renderer/src/dynamic-taa-gpu-history.ts',
"  readonly currentColorTexture: BackendTextureHandle;\n  readonly sampler: BackendSamplerHandle;",
"  readonly currentColorTexture: BackendTextureHandle;\n  readonly currentVelocityTexture: BackendTextureHandle;\n  readonly sampler: BackendSamplerHandle;")
edit('packages/renderer/src/dynamic-taa-gpu-history.ts',
"      currentColorTexture: resources.currentColorTexture,\n      historyValid,",
"      currentColorTexture: resources.currentColorTexture,\n      currentVelocityTexture: resources.currentVelocityTexture,\n      historyValid,")
edit('packages/renderer/src/dynamic-taa-gpu-history.ts',
"        (CURRENT_COLOR_BYTES_PER_TEXEL + RESOLVED_SET_BYTES_PER_TEXEL * RESOLVED_SET_COUNT),",
"        (CURRENT_COLOR_BYTES_PER_TEXEL +\n          CURRENT_VELOCITY_BYTES_PER_TEXEL +\n          RESOLVED_SET_BYTES_PER_TEXEL * RESOLVED_SET_COUNT),")
edit('packages/renderer/src/dynamic-taa-gpu-history.ts',
"        format: 'depth32float' | 'rgba16float',",
"        format: 'depth32float' | 'rg16float' | 'rgba16float',")
edit('packages/renderer/src/dynamic-taa-gpu-history.ts',
"      const currentColorTexture = createTexture(\n        `taa-history-${this.#ownerId}-current-color`,\n        'rgba16float',\n      );",
"      const currentColorTexture = createTexture(\n        `taa-history-${this.#ownerId}-current-color`,\n        'rgba16float',\n      );\n      const currentVelocityTexture = createTexture(\n        `taa-history-${this.#ownerId}-current-velocity`,\n        'rg16float',\n      );")
edit('packages/renderer/src/dynamic-taa-gpu-history.ts',
"        currentColorTexture,\n        sampler,",
"        currentColorTexture,\n        currentVelocityTexture,\n        sampler,")
edit('packages/renderer/src/dynamic-taa-gpu-history.ts',
"      resources.currentColorTexture,\n    ]);",
"      resources.currentVelocityTexture,\n      resources.currentColorTexture,\n    ]);")

# Append previous MVP to the stable PBR object block without moving accepted offsets.
edit('packages/renderer/src/pbr-gpu-layout.ts',
"  byteLength: 448,\n  floatLength: 112,",
"  byteLength: 512,\n  floatLength: 128,")
edit('packages/renderer/src/pbr-gpu-layout.ts',
"    environmentControls: 108,\n    textureUvRotations: 92,",
"    environmentControls: 108,\n    previousModelViewProjection: 112,\n    textureUvRotations: 92,")
edit('packages/renderer/src/pbr-gpu-layout.ts',
"  readonly output?: PbrOutputTransformDescriptor;\n  readonly viewProjectionMatrix: Mat4;",
"  readonly output?: PbrOutputTransformDescriptor;\n  readonly previousViewProjectionMatrix?: Mat4;\n  readonly previousWorldMatrix?: Mat4;\n  readonly viewProjectionMatrix: Mat4;")
edit('packages/renderer/src/pbr-gpu-layout.ts',
"  result.set(\n    multiplyMat4(options.viewProjectionMatrix, options.worldMatrix),\n    offsets.modelViewProjection,\n  );",
"  result.set(\n    multiplyMat4(options.viewProjectionMatrix, options.worldMatrix),\n    offsets.modelViewProjection,\n  );\n  result.set(\n    multiplyMat4(\n      options.previousViewProjectionMatrix ?? options.viewProjectionMatrix,\n      options.previousWorldMatrix ?? options.worldMatrix,\n    ),\n    offsets.previousModelViewProjection,\n  );")

# PBR temporal output grows to Color + Normal + Velocity and receives previous matrices from its temporal owner.
edit('packages/renderer/src/pbr-render-feature.ts',
"const TEMPORAL_NORMAL_FORMAT = 'rgba16float' as const;",
"const TEMPORAL_NORMAL_FORMAT = 'rgba16float' as const;\nconst TEMPORAL_VELOCITY_FORMAT = 'rg16float' as const;")
edit('packages/renderer/src/pbr-render-feature.ts',
"  readonly acquireViewProjectionMatrix?: () => Mat4;",
"  readonly acquireViewProjectionMatrix?: () => Mat4;\n  readonly acquirePreviousViewProjectionMatrix?: () => Mat4;")
edit('packages/renderer/src/pbr-render-feature.ts',
"  readonly #objectResources = new Map<EntityHandle, ObjectGpuResources>();",
"  readonly #objectResources = new Map<EntityHandle, ObjectGpuResources>();\n  readonly #previousWorldMatrices = new Map<EntityHandle, Mat4>();")
edit('packages/renderer/src/pbr-render-feature.ts',
"      if (\n        options.dynamicTaaOutput.acquireViewProjectionMatrix !== undefined &&",
"      if (\n        options.dynamicTaaOutput.acquirePreviousViewProjectionMatrix !== undefined &&\n        typeof options.dynamicTaaOutput.acquirePreviousViewProjectionMatrix !== 'function'\n      ) {\n        throw new KyxosEngineError('PBR Dynamic TAA previous View-Projection provider must be a function.', {\n          code: 'INVALID_ARGUMENT', module: 'renderer', recoverable: false,\n        });\n      }\n      if (\n        options.dynamicTaaOutput.acquireViewProjectionMatrix !== undefined &&")
edit('packages/renderer/src/pbr-render-feature.ts',
"        { clearColor: TEMPORAL_NORMAL_CLEAR_COLOR, texture: frame.writeNormalTexture },\n      ],",
"        { clearColor: TEMPORAL_NORMAL_CLEAR_COLOR, texture: frame.writeNormalTexture },\n        { clearColor: { a: 0, b: 0, g: 0, r: 0 }, texture: frame.currentVelocityTexture },\n      ],")
edit('packages/renderer/src/pbr-render-feature.ts',
"              { format: TEMPORAL_NORMAL_FORMAT },\n            ]",
"              { format: TEMPORAL_NORMAL_FORMAT },\n              { format: TEMPORAL_VELOCITY_FORMAT },\n            ]")
edit('packages/renderer/src/pbr-render-feature.ts',
"        output: this.#output,\n        viewProjectionMatrix:",
"        output: this.#output,\n        previousViewProjectionMatrix:\n          this.#dynamicTaaOutput?.acquirePreviousViewProjectionMatrix?.() ??\n          this.#camera.viewProjectionMatrix(),\n        previousWorldMatrix: this.#previousWorldMatrices.get(item.entity) ?? item.worldMatrix,\n        viewProjectionMatrix:")
edit('packages/renderer/src/pbr-render-feature.ts',
"    const environmentBindGroup = resources.environmentBindGroups.get(material.pipeline);",
"    this.#previousWorldMatrices.set(item.entity, item.worldMatrix);\n    const environmentBindGroup = resources.environmentBindGroups.get(material.pipeline);")
edit('packages/renderer/src/pbr-render-feature.ts',
"      this.#objectResources.delete(entity);",
"      this.#objectResources.delete(entity);\n      this.#previousWorldMatrices.delete(entity);")
edit('packages/renderer/src/pbr-render-feature.ts',
"    this.#objectResources.clear();\n    this.#textureResources.clear();",
"    this.#objectResources.clear();\n    this.#previousWorldMatrices.clear();\n    this.#textureResources.clear();")

# Temporal composition exposes the previous jittered VP to PBR for explicit rigid-object velocity.
edit('packages/renderer/src/temporal-pbr-render-feature.ts',
"  #activeViewProjection: Mat4 | undefined;",
"  #activeViewProjection: Mat4 | undefined;\n  #activePreviousViewProjection: Mat4 | undefined;")
edit('packages/renderer/src/temporal-pbr-render-feature.ts',
"        acquireFrame: () => this.#requireActiveFrame(),\n        acquireViewProjectionMatrix: () => this.#requireActiveViewProjection(),",
"        acquireFrame: () => this.#requireActiveFrame(),\n        acquirePreviousViewProjectionMatrix: () => this.#requireActivePreviousViewProjection(),\n        acquireViewProjectionMatrix: () => this.#requireActiveViewProjection(),")
edit('packages/renderer/src/temporal-pbr-render-feature.ts',
"        if (this.#activeFrame !== undefined || this.#activeViewProjection !== undefined) {",
"        if (\n          this.#activeFrame !== undefined ||\n          this.#activeViewProjection !== undefined ||\n          this.#activePreviousViewProjection !== undefined\n        ) {")
edit('packages/renderer/src/temporal-pbr-render-feature.ts',
"        this.#activeFrame = frame;\n        this.#activeViewProjection = matrices.currentViewProjection;",
"        this.#activeFrame = frame;\n        this.#activePreviousViewProjection = matrices.previousViewProjection;\n        this.#activeViewProjection = matrices.currentViewProjection;")
edit('packages/renderer/src/temporal-pbr-render-feature.ts',
"          this.#activeFrame = undefined;\n          this.#activeViewProjection = undefined;",
"          this.#activeFrame = undefined;\n          this.#activePreviousViewProjection = undefined;\n          this.#activeViewProjection = undefined;")
edit('packages/renderer/src/temporal-pbr-render-feature.ts',
"    this.#activeFrame = undefined;\n    this.#activeViewProjection = undefined;\n    this.#cameraTracker.reset();",
"    this.#activeFrame = undefined;\n    this.#activePreviousViewProjection = undefined;\n    this.#activeViewProjection = undefined;\n    this.#cameraTracker.reset();")
edit('packages/renderer/src/temporal-pbr-render-feature.ts',
"  #requireActiveViewProjection(): Mat4 {",
"  #requireActivePreviousViewProjection(): Mat4 {\n    const matrix = this.#activePreviousViewProjection;\n    if (matrix === undefined) {\n      throw error('Temporal PBR previous View-Projection is unavailable outside the current transaction.', 'INVALID_STATE');\n    }\n    return matrix;\n  }\n\n  #requireActiveViewProjection(): Mat4 {")

# Resolve binds and samples explicit velocity.
edit('packages/renderer/src/dynamic-taa-resolve-pass.ts',
"      frame.currentColorTexture.id,\n      frame.writeDepthTexture.id,",
"      frame.currentColorTexture.id,\n      frame.currentVelocityTexture.id,\n      frame.writeDepthTexture.id,")
edit('packages/renderer/src/dynamic-taa-resolve-pass.ts',
"        { binding: 2, resource: { texture: frame.writeDepthTexture } },\n        { binding: 3, resource: { texture: frame.writeNormalTexture } },\n        { binding: 4, resource: { texture: frame.readColorTexture } },\n        { binding: 5, resource: { texture: frame.readDepthTexture } },\n        { binding: 6, resource: { texture: frame.readNormalTexture } },\n        { binding: 7, resource: { sampler: frame.sampler } },",
"        { binding: 2, resource: { texture: frame.currentVelocityTexture } },\n        { binding: 3, resource: { texture: frame.writeDepthTexture } },\n        { binding: 4, resource: { texture: frame.writeNormalTexture } },\n        { binding: 5, resource: { texture: frame.readColorTexture } },\n        { binding: 6, resource: { texture: frame.readDepthTexture } },\n        { binding: 7, resource: { texture: frame.readNormalTexture } },\n        { binding: 8, resource: { sampler: frame.sampler } },")

pbr_shader = Path('shaders/webgpu/phase-04-pbr-temporal-output.wgsl')
pbr = pbr_shader.read_text()
pbr = pbr.replace('  environmentControls: vec4f,\n}', '  environmentControls: vec4f,\n  previousModelViewProjection: mat4x4f,\n}')
pbr = pbr.replace('  @location(3) worldTangent: vec4f,\n}', '  @location(3) worldTangent: vec4f,\n  @location(4) previousClipPosition: vec4f,\n}')
pbr = pbr.replace('  output.position = object.modelViewProjection * vec4f(position, 1.0);', '  output.position = object.modelViewProjection * vec4f(position, 1.0);\n  output.previousClipPosition = object.previousModelViewProjection * vec4f(position, 1.0);')
pbr = pbr.replace('  @location(1) normal: vec4f,\n}', '  @location(1) normal: vec4f,\n  @location(2) velocity: vec2f,\n}')
pbr = pbr.replace('fn shadePbr(input: VertexOutput, frontFacing: bool) -> PbrShadingResult {', 'fn pbrVelocity(input: VertexOutput) -> vec2f {\n  let currentNdc = input.position.xy / max(abs(input.position.w), 0.000001);\n  let previousNdc = input.previousClipPosition.xy / max(abs(input.previousClipPosition.w), 0.000001);\n  return (currentNdc - previousNdc) * vec2f(0.5, -0.5);\n}\n\nfn shadePbr(input: VertexOutput, frontFacing: bool) -> PbrShadingResult {')
pbr = pbr.replace('return PbrTemporalFragmentOutput(vec4f(shaded.color.rgb, 1.0), shaded.normal);', 'return PbrTemporalFragmentOutput(vec4f(shaded.color.rgb, 1.0), shaded.normal, pbrVelocity(input));')
pbr = pbr.replace('return PbrTemporalFragmentOutput(shaded.color, shaded.normal);', 'return PbrTemporalFragmentOutput(shaded.color, shaded.normal, pbrVelocity(input));')
pbr_shader.write_text(pbr)
Path('packages/renderer/src/generated/phase-04-pbr-temporal-output.wgsl.ts').write_text('export const PHASE_04_PBR_TEMPORAL_OUTPUT_WGSL = `' + pbr + '`;\n')

resolve_shader = Path('shaders/webgpu/phase-04-taa-resolve.wgsl')
resolve = resolve_shader.read_text()
resolve = resolve.replace('@group(0) @binding(2) var currentDepthTexture: texture_depth_2d;\n@group(0) @binding(3) var currentNormalTexture: texture_2d<f32>;\n@group(0) @binding(4) var historyColorTexture: texture_2d<f32>;\n@group(0) @binding(5) var historyDepthTexture: texture_depth_2d;\n@group(0) @binding(6) var historyNormalTexture: texture_2d<f32>;\n@group(0) @binding(7) var historySampler: sampler;', '@group(0) @binding(2) var currentVelocityTexture: texture_2d<f32>;\n@group(0) @binding(3) var currentDepthTexture: texture_depth_2d;\n@group(0) @binding(4) var currentNormalTexture: texture_2d<f32>;\n@group(0) @binding(5) var historyColorTexture: texture_2d<f32>;\n@group(0) @binding(6) var historyDepthTexture: texture_depth_2d;\n@group(0) @binding(7) var historyNormalTexture: texture_2d<f32>;\n@group(0) @binding(8) var historySampler: sampler;')
resolve = resolve.replace('  let reprojection = taaReproject(currentUv, currentDepth);', '  let velocity = textureLoad(currentVelocityTexture, pixel, 0).xy;\n  var reprojection = taaReproject(currentUv, currentDepth);\n  if (dot(velocity, velocity) > 0.00000001) {\n    let velocityUv = currentUv - velocity;\n    reprojection = TaaReprojection(velocityUv, select(0.0, 1.0, taaUvInBounds(velocityUv)), 0.0);\n  }')
# Variance-guided clipping inside the existing min/max envelope.
resolve = resolve.replace('  let bounds = taaNeighborhoodBounds(neighborhood);\n  let clampedHistory = clamp(historyColor.rgb, bounds.minimum, bounds.maximum);', '  let bounds = taaNeighborhoodBounds(neighborhood);\n  var mean = vec3f(0.0);\n  var secondMoment = vec3f(0.0);\n  for (var sampleIndex: u32 = 0u; sampleIndex < 9u; sampleIndex += 1u) {\n    mean += neighborhood[sampleIndex];\n    secondMoment += neighborhood[sampleIndex] * neighborhood[sampleIndex];\n  }\n  mean /= 9.0;\n  let sigma = sqrt(max(secondMoment / 9.0 - mean * mean, vec3f(0.0)));\n  let varianceMinimum = max(bounds.minimum, mean - sigma * 1.25);\n  let varianceMaximum = min(bounds.maximum, mean + sigma * 1.25);\n  let clampedHistory = clamp(historyColor.rgb, varianceMinimum, varianceMaximum);')
resolve_shader.write_text(resolve)
Path('packages/renderer/src/generated/phase-04-taa-resolve.wgsl.ts').write_text('export const PHASE_04_TAA_RESOLVE_WGSL = `' + resolve + '`;\n')

# Lightweight source-level gates for the new contract.
Path('packages/renderer/test/phase-04-final-source.test.ts').write_text("""import { readFileSync } from 'node:fs';\nimport { describe, expect, it } from 'vitest';\n\ndescribe('Phase 4 final TRAA source contract', () => {\n  it('keeps an explicit current velocity MRT and velocity-first reprojection', () => {\n    const pbr = readFileSync('shaders/webgpu/phase-04-pbr-temporal-output.wgsl', 'utf8');\n    const resolve = readFileSync('shaders/webgpu/phase-04-taa-resolve.wgsl', 'utf8');\n    expect(pbr).toContain('@location(2) velocity: vec2f');\n    expect(pbr).toContain('previousModelViewProjection');\n    expect(resolve).toContain('currentVelocityTexture');\n    expect(resolve).toContain('mean - sigma * 1.25');\n  });\n});\n""")

print('Phase 4 final core patch applied')
