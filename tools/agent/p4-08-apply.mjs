import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`P4-08 patch anchor not found: ${label}`);
  if (source.indexOf(search, index + search.length) >= 0) {
    throw new Error(`P4-08 patch anchor is not unique: ${label}`);
  }
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

function insertBeforeLast(source, marker, insertion, label) {
  const index = source.lastIndexOf(marker);
  if (index < 0) throw new Error(`P4-08 final anchor not found: ${label}`);
  return source.slice(0, index) + insertion + source.slice(index);
}

async function update(path, transform) {
  const source = await readFile(path, 'utf8');
  const next = transform(source);
  if (next === source) throw new Error(`P4-08 produced no change for ${path}`);
  await writeFile(path, next);
}

await update('packages/renderer/src/pbr-render-feature.ts', (original) => {
  let source = original;
  source = replaceOnce(
    source,
    '  BackendPipelineHandle,\n  BackendRenderPassStatistics,',
    '  BackendPipelineHandle,\n  BackendRenderPassDescriptor,\n  BackendRenderPassStatistics,',
    'PBR render-pass descriptor import',
  );
  source = replaceOnce(
    source,
    "import type {\n  RenderFeature,\n  RenderFeatureFrameContext,\n  RenderFeatureInitializationContext,\n} from './extensions.js';",
    "import type { DynamicTaaGpuFrame } from './dynamic-taa-gpu-history.js';\nimport type {\n  RenderFeature,\n  RenderFeatureFrameContext,\n  RenderFeatureInitializationContext,\n} from './extensions.js';",
    'Dynamic TAA frame type import',
  );
  source = replaceOnce(
    source,
    "import { PHASE_03_PBR_TONEMAPPED_WGSL } from './generated/phase-03-pbr-tonemapped.wgsl.js';",
    "import { PHASE_03_PBR_TONEMAPPED_WGSL } from './generated/phase-03-pbr-tonemapped.wgsl.js';\nimport { PHASE_04_PBR_TEMPORAL_OUTPUT_WGSL } from './generated/phase-04-pbr-temporal-output.wgsl.js';",
    'Phase 4 PBR Shader import',
  );
  source = replaceOnce(
    source,
    "const DEPTH_FORMAT = 'depth24plus' as const;",
    "const SURFACE_DEPTH_FORMAT = 'depth24plus' as const;\nconst TEMPORAL_DEPTH_FORMAT = 'depth32float' as const;\nconst TEMPORAL_COLOR_FORMAT = 'rgba16float' as const;\nconst TEMPORAL_NORMAL_FORMAT = 'rgba16float' as const;\nconst TEMPORAL_NORMAL_CLEAR_COLOR: BackendClearColor = Object.freeze({\n  a: 1,\n  b: 1,\n  g: 0.5,\n  r: 0.5,\n});",
    'PBR output formats',
  );
  source = replaceOnce(
    source,
    'export interface PbrRenderFeatureOptions extends BuildRenderQueuesOptions {',
    "export interface PbrDynamicTaaOutput {\n  /** Returns one caller-prepared frame. The feature never commits, cancels, resizes, or disposes it. */\n  readonly acquireFrame: () => DynamicTaaGpuFrame;\n}\n\nexport interface PbrRenderFeatureOptions extends BuildRenderQueuesOptions {",
    'PBR Dynamic TAA output contract',
  );
  source = replaceOnce(
    source,
    '  readonly clearColor?: BackendClearColor;\n  readonly environment?: PbrEnvironmentDescriptor;',
    '  readonly clearColor?: BackendClearColor;\n  /** Opt-in linear-HDR Color + encoded Normal MRT output into caller-owned Dynamic TAA targets. */\n  readonly dynamicTaaOutput?: PbrDynamicTaaOutput;\n  readonly environment?: PbrEnvironmentDescriptor;',
    'PBR Dynamic TAA option',
  );
  source = replaceOnce(
    source,
    '  readonly objectBindingCount: number;\n  readonly outputExposure: number;',
    "  readonly objectBindingCount: number;\n  readonly outputTarget: 'dynamic-taa' | 'surface';\n  readonly temporalOwnerId: string | null;\n  readonly outputExposure: number;",
    'PBR diagnostics output target',
  );
  source = replaceOnce(
    source,
    '  readonly #camera: PerspectiveCamera;\n  readonly #environmentCache: EnvironmentGpuCache;',
    '  readonly #camera: PerspectiveCamera;\n  readonly #dynamicTaaOutput: PbrDynamicTaaOutput | undefined;\n  readonly #environmentCache: EnvironmentGpuCache;',
    'PBR Dynamic TAA field',
  );
  source = replaceOnce(
    source,
    '  #lastFallbackDrawCount = 0;\n  #lastVisibility: VisibilityDiagnostics | null = null;',
    '  #lastFallbackDrawCount = 0;\n  #lastTemporalOwnerId: string | null = null;\n  #lastVisibility: VisibilityDiagnostics | null = null;',
    'PBR temporal owner diagnostic field',
  );
  source = replaceOnce(
    source,
    '    this.#scene = options.scene;\n    this.#camera = options.camera;',
    "    if (\n      options.dynamicTaaOutput !== undefined &&\n      typeof options.dynamicTaaOutput.acquireFrame !== 'function'\n    ) {\n      throw new KyxosEngineError('PBR Dynamic TAA output requires an acquireFrame function.', {\n        code: 'INVALID_ARGUMENT',\n        module: 'renderer',\n        recoverable: false,\n      });\n    }\n    this.#scene = options.scene;\n    this.#camera = options.camera;\n    this.#dynamicTaaOutput = options.dynamicTaaOutput;",
    'PBR Dynamic TAA constructor assignment',
  );
  source = replaceOnce(
    source,
    "      const shader = backend.createShaderModule({\n        code: PHASE_03_PBR_TONEMAPPED_WGSL,\n        label: 'phase-03-pbr-tonemapped',\n        language: 'wgsl',\n      });",
    "      const dynamicTaa = this.#dynamicTaaOutput !== undefined;\n      const shader = backend.createShaderModule({\n        code: dynamicTaa ? PHASE_04_PBR_TEMPORAL_OUTPUT_WGSL : PHASE_03_PBR_TONEMAPPED_WGSL,\n        label: dynamicTaa ? 'phase-04-pbr-temporal-output' : 'phase-03-pbr-tonemapped',\n        language: 'wgsl',\n      });",
    'PBR mode-specific Shader',
  );
  source = replaceOnce(
    source,
    '              normalMap,\n            );',
    '              normalMap,\n              dynamicTaa,\n            );',
    'PBR mode-specific Pipeline call',
  );
  source = replaceOnce(
    source,
    '      const depthTexture = this.#createDepthTexture(backend, surfaceInfo);',
    '      const depthTexture = dynamicTaa ? undefined : this.#createDepthTexture(backend, surfaceInfo);',
    'PBR surface-only Depth allocation',
  );
  source = replaceOnce(
    source,
    "    const commandEncoder = context.backend.createCommandEncoder({\n      label: `phase-03-pbr-frame-${context.frameIndex}`,\n    });\n    try {\n      return context.backend.executeFrame({\n        commandEncoder,\n        renderPasses: [\n          {\n            clearColor: this.#clearColor,\n            depthAttachment: { texture: resources.depthTexture },\n            draws,\n            label: 'phase-03-pbr-pass',\n            surface: resources.surface,\n          },\n        ],\n      });\n    } catch (error) {",
    "    const renderPass: BackendRenderPassDescriptor =\n      this.#dynamicTaaOutput === undefined\n        ? {\n            clearColor: this.#clearColor,\n            depthAttachment: { texture: resources.depthTexture },\n            draws,\n            label: 'phase-03-pbr-pass',\n            surface: resources.surface,\n          }\n        : this.#createDynamicTaaRenderPass(surfaceInfo, draws);\n    const commandEncoder = context.backend.createCommandEncoder({\n      label: `${this.#dynamicTaaOutput === undefined ? 'phase-03-pbr' : 'phase-04-pbr-temporal'}-frame-${context.frameIndex}`,\n    });\n    try {\n      return context.backend.executeFrame({ commandEncoder, renderPasses: [renderPass] });\n    } catch (error) {",
    'PBR mode-specific Render Pass',
  );
  source = replaceOnce(
    source,
    '      objectBindingCount: this.#objectResources.size,\n      outputExposure: this.#output.exposure,',
    "      objectBindingCount: this.#objectResources.size,\n      outputTarget: this.#dynamicTaaOutput === undefined ? 'surface' : 'dynamic-taa',\n      temporalOwnerId: this.#lastTemporalOwnerId,\n      outputExposure: this.#output.exposure,",
    'PBR output diagnostics values',
  );
  source = replaceOnce(
    source,
    '    const nextDepthTexture = this.#createDepthTexture(backend, surfaceInfo);',
    '    const nextDepthTexture =\n      this.#dynamicTaaOutput === undefined\n        ? this.#createDepthTexture(backend, surfaceInfo)\n        : undefined;',
    'PBR temporal Resize behavior',
  );
  source = replaceOnce(
    source,
    '    this.#lastFallbackDrawCount = 0;\n    this.#visibility.clearCache();',
    '    this.#lastFallbackDrawCount = 0;\n    this.#lastTemporalOwnerId = null;\n    this.#visibility.clearCache();',
    'PBR temporal Device Lost reset',
  );
  source = replaceOnce(
    source,
    "  async #createPipeline(\n    backend: GraphicsBackend,\n    shader: BackendShaderModuleHandle,\n    surfaceInfo: BackendSurfaceInfo,\n    alphaMode: PbrAlphaMode,\n    doubleSided: boolean,\n    normalMap: boolean,\n  ): Promise<BackendPipelineHandle> {\n    const transparent = alphaMode === 'blend';\n    return backend.createRenderPipeline({\n      depthStencil: {\n        depthCompare: 'less',\n        depthWriteEnabled: !transparent,\n        format: DEPTH_FORMAT,\n      },\n      fragment: {\n        entryPoint: fragmentEntryPoint(alphaMode),\n        module: shader,\n        targets: [\n          {\n            ...(transparent\n              ? {\n                  blend: {\n                    alpha: { dstFactor: 'one-minus-src-alpha', srcFactor: 'one' },\n                    color: { dstFactor: 'one-minus-src-alpha', srcFactor: 'src-alpha' },\n                  },\n                }\n              : {}),\n            format: surfaceInfo.format,\n          },\n        ],\n      },\n      label: `phase-03-pbr-${alphaMode}-${doubleSided ? 'double' : 'single'}-${normalMap ? 'normal' : 'geometric'}`,\n      primitive: {\n        cullMode: doubleSided ? 'none' : 'back',\n        frontFace: 'ccw',\n        topology: 'triangle-list',\n      },\n      vertex: {\n        buffers: [\n          {\n            arrayStride: PBR_VERTEX_STRIDE,\n            attributes: [\n              { format: 'float32x3', offset: 0, shaderLocation: 0 },\n              { format: 'float32x3', offset: 12, shaderLocation: 1 },\n              { format: 'float32x2', offset: 24, shaderLocation: 2 },\n              { format: 'float32x4', offset: 32, shaderLocation: 3 },\n            ],\n          },\n        ],\n        entryPoint: 'vertexMain',\n        module: shader,\n      },\n    });\n  }",
    "  #createDynamicTaaRenderPass(\n    surfaceInfo: BackendSurfaceInfo,\n    draws: readonly BackendDrawCommand[],\n  ): BackendRenderPassDescriptor {\n    const output = this.#dynamicTaaOutput;\n    if (output === undefined) {\n      throw this.#error('PBR Dynamic TAA output is not configured.', 'INVALID_STATE');\n    }\n    const frame = output.acquireFrame();\n    if (frame.ownerId.trim().length === 0) {\n      throw this.#error('PBR Dynamic TAA frame Owner ID must not be empty.', 'INVALID_ARGUMENT');\n    }\n    if (\n      frame.size.width !== surfaceInfo.size.physicalWidth ||\n      frame.size.height !== surfaceInfo.size.physicalHeight\n    ) {\n      throw this.#error(\n        `PBR Dynamic TAA frame ${frame.size.width}x${frame.size.height} does not match Surface ${surfaceInfo.size.physicalWidth}x${surfaceInfo.size.physicalHeight}.`,\n        'INVALID_ARGUMENT',\n      );\n    }\n    this.#lastTemporalOwnerId = frame.ownerId;\n    return {\n      clearColor: this.#clearColor,\n      colorAttachments: [\n        { clearColor: this.#clearColor, texture: frame.currentColorTexture },\n        { clearColor: TEMPORAL_NORMAL_CLEAR_COLOR, texture: frame.writeNormalTexture },\n      ],\n      depthAttachment: { clearValue: 1, texture: frame.writeDepthTexture },\n      draws,\n      label: 'phase-04-pbr-temporal-mrt-pass',\n    };\n  }\n\n  async #createPipeline(\n    backend: GraphicsBackend,\n    shader: BackendShaderModuleHandle,\n    surfaceInfo: BackendSurfaceInfo,\n    alphaMode: PbrAlphaMode,\n    doubleSided: boolean,\n    normalMap: boolean,\n    dynamicTaa: boolean,\n  ): Promise<BackendPipelineHandle> {\n    const transparent = alphaMode === 'blend';\n    return backend.createRenderPipeline({\n      depthStencil: {\n        depthCompare: 'less',\n        depthWriteEnabled: !transparent,\n        format: dynamicTaa ? TEMPORAL_DEPTH_FORMAT : SURFACE_DEPTH_FORMAT,\n      },\n      fragment: {\n        entryPoint: fragmentEntryPoint(alphaMode),\n        module: shader,\n        targets: dynamicTaa\n          ? [\n              {\n                ...(transparent\n                  ? {\n                      blend: {\n                        alpha: { dstFactor: 'one-minus-src-alpha', srcFactor: 'one' },\n                        color: { dstFactor: 'one-minus-src-alpha', srcFactor: 'src-alpha' },\n                      },\n                    }\n                  : {}),\n                format: TEMPORAL_COLOR_FORMAT,\n              },\n              { format: TEMPORAL_NORMAL_FORMAT },\n            ]\n          : [\n              {\n                ...(transparent\n                  ? {\n                      blend: {\n                        alpha: { dstFactor: 'one-minus-src-alpha', srcFactor: 'one' },\n                        color: { dstFactor: 'one-minus-src-alpha', srcFactor: 'src-alpha' },\n                      },\n                    }\n                  : {}),\n                format: surfaceInfo.format,\n              },\n            ],\n      },\n      label: `${dynamicTaa ? 'phase-04-pbr-temporal' : 'phase-03-pbr'}-${alphaMode}-${doubleSided ? 'double' : 'single'}-${normalMap ? 'normal' : 'geometric'}`,\n      primitive: {\n        cullMode: doubleSided ? 'none' : 'back',\n        frontFace: 'ccw',\n        topology: 'triangle-list',\n      },\n      vertex: {\n        buffers: [\n          {\n            arrayStride: PBR_VERTEX_STRIDE,\n            attributes: [\n              { format: 'float32x3', offset: 0, shaderLocation: 0 },\n              { format: 'float32x3', offset: 12, shaderLocation: 1 },\n              { format: 'float32x2', offset: 24, shaderLocation: 2 },\n              { format: 'float32x4', offset: 32, shaderLocation: 3 },\n            ],\n          },\n        ],\n        entryPoint: 'vertexMain',\n        module: shader,\n      },\n    });\n  }",
    'PBR temporal Render Pass and Pipeline implementation',
  );
  source = source.replaceAll('format: DEPTH_FORMAT,', 'format: SURFACE_DEPTH_FORMAT,');
  source = replaceOnce(
    source,
    "if (errors.length === 0) return 'The Phase 3 PBR IBL WGSL module failed validation.';\n  return `The Phase 3 PBR IBL WGSL module failed validation: ${errors",
    "if (errors.length === 0) return 'The PBR WGSL module failed validation.';\n  return `The PBR WGSL module failed validation: ${errors",
    'PBR Shader error wording',
  );
  return source;
});

const phase03Shader = await readFile('shaders/webgpu/phase-03-pbr-tonemapped.wgsl', 'utf8');
let temporalShader = phase03Shader;
temporalShader = replaceOnce(
  temporalShader,
  'fn shadePbr(input: VertexOutput, frontFacing: bool) -> vec4f {',
  "struct PbrShadingResult {\n  color: vec4f,\n  normal: vec4f,\n}\n\nstruct PbrTemporalFragmentOutput {\n  @location(0) color: vec4f,\n  @location(1) normal: vec4f,\n}\n\nfn shadePbr(input: VertexOutput, frontFacing: bool) -> PbrShadingResult {",
  'PBR temporal Shader result structs',
);
temporalShader = replaceOnce(
  temporalShader,
  '  return vec4f(\n    pbrApplyOutputTransform(directRadiance + indirectRadiance + emission),\n    baseColor.a,\n  );',
  '  return PbrShadingResult(\n    vec4f(directRadiance + indirectRadiance + emission, baseColor.a),\n    vec4f(normal * 0.5 + vec3f(0.5), 1.0),\n  );',
  'PBR temporal linear-HDR and Normal output',
);
temporalShader = replaceOnce(
  temporalShader,
  "@fragment\nfn fragmentOpaque(\n  input: VertexOutput,\n  @builtin(front_facing) frontFacing: bool,\n) -> @location(0) vec4f {\n  return vec4f(shadePbr(input, frontFacing).rgb, 1.0);\n}\n\n@fragment\nfn fragmentMask(\n  input: VertexOutput,\n  @builtin(front_facing) frontFacing: bool,\n) -> @location(0) vec4f {\n  let shaded = shadePbr(input, frontFacing);\n  if (shaded.a < object.metallicRoughnessAlphaCutoff.z) {\n    discard;\n  }\n  return vec4f(shaded.rgb, 1.0);\n}\n\n@fragment\nfn fragmentBlend(\n  input: VertexOutput,\n  @builtin(front_facing) frontFacing: bool,\n) -> @location(0) vec4f {\n  return shadePbr(input, frontFacing);\n}\n",
  "@fragment\nfn fragmentOpaque(\n  input: VertexOutput,\n  @builtin(front_facing) frontFacing: bool,\n) -> PbrTemporalFragmentOutput {\n  let shaded = shadePbr(input, frontFacing);\n  return PbrTemporalFragmentOutput(vec4f(shaded.color.rgb, 1.0), shaded.normal);\n}\n\n@fragment\nfn fragmentMask(\n  input: VertexOutput,\n  @builtin(front_facing) frontFacing: bool,\n) -> PbrTemporalFragmentOutput {\n  let shaded = shadePbr(input, frontFacing);\n  if (shaded.color.a < object.metallicRoughnessAlphaCutoff.z) {\n    discard;\n  }\n  return PbrTemporalFragmentOutput(vec4f(shaded.color.rgb, 1.0), shaded.normal);\n}\n\n@fragment\nfn fragmentBlend(\n  input: VertexOutput,\n  @builtin(front_facing) frontFacing: bool,\n) -> PbrTemporalFragmentOutput {\n  let shaded = shadePbr(input, frontFacing);\n  return PbrTemporalFragmentOutput(shaded.color, shaded.normal);\n}\n",
  'PBR temporal fragment entry points',
);
await writeFile('shaders/webgpu/phase-04-pbr-temporal-output.wgsl', temporalShader);
await writeFile(
  'packages/renderer/src/generated/phase-04-pbr-temporal-output.wgsl.ts',
  `export const PHASE_04_PBR_TEMPORAL_OUTPUT_WGSL = \`${temporalShader}\`;\n`,
);

await update('tools/shader-build/validate-shaders.mjs', (source) =>
  replaceOnce(
    source,
    "  [\n    'webgpu/phase-04-camera-reprojection-reference.wgsl',",
    "  [\n    'webgpu/phase-04-pbr-temporal-output.wgsl',\n    {\n      exportName: 'PHASE_04_PBR_TEMPORAL_OUTPUT_WGSL',\n      path: 'packages/renderer/src/generated/phase-04-pbr-temporal-output.wgsl.ts',\n    },\n  ],\n  [\n    'webgpu/phase-04-camera-reprojection-reference.wgsl',",
    'Phase 4 PBR Shader mirror registration',
  ),
);

await update('packages/renderer/src/index.ts', (source) =>
  replaceOnce(
    source,
    '  type PbrEnvironmentDescriptor,\n  type PbrEnvironmentState,',
    '  type PbrDynamicTaaOutput,\n  type PbrEnvironmentDescriptor,\n  type PbrEnvironmentState,',
    'Renderer PBR Dynamic TAA type export',
  ),
);

await update('packages/sdk/src/create-pbr-renderer.ts', (original) => {
  let source = original;
  source = replaceOnce(
    source,
    '  PbrDirectionalLightDescriptor,\n  PbrEnvironmentDescriptor,',
    '  PbrDirectionalLightDescriptor,\n  PbrDynamicTaaOutput,\n  PbrEnvironmentDescriptor,',
    'SDK PBR Dynamic TAA type import',
  );
  source = replaceOnce(
    source,
    '  readonly devicePixelRatio?: number;\n  readonly environment?: PbrEnvironmentDescriptor;',
    '  readonly devicePixelRatio?: number;\n  readonly dynamicTaaOutput?: PbrDynamicTaaOutput;\n  readonly environment?: PbrEnvironmentDescriptor;',
    'SDK PBR Dynamic TAA option',
  );
  source = replaceOnce(
    source,
    '    ...(options.clearColor === undefined ? {} : { clearColor: options.clearColor }),\n    ...(options.environment === undefined ? {} : { environment: options.environment }),',
    '    ...(options.clearColor === undefined ? {} : { clearColor: options.clearColor }),\n    ...(options.dynamicTaaOutput === undefined\n      ? {}\n      : { dynamicTaaOutput: options.dynamicTaaOutput }),\n    ...(options.environment === undefined ? {} : { environment: options.environment }),',
    'SDK PBR Dynamic TAA composition',
  );
  return source;
});

await update('packages/sdk/src/index.ts', (source) =>
  replaceOnce(
    source,
    '   PbrDirectionalLightDescriptor,\n   PbrEnvironmentDescriptor,',
    '   PbrDirectionalLightDescriptor,\n   PbrDynamicTaaOutput,\n   PbrEnvironmentDescriptor,',
    'SDK PBR Dynamic TAA public type export',
  ),
);

await update('packages/renderer/test/pbr-render-feature.test.ts', (original) => {
  let source = replaceOnce(
    original,
    '  KyxosRenderer,\n  PBR_OBJECT_UNIFORM_LAYOUT,',
    '  DynamicTaaGpuHistory,\n  KyxosRenderer,\n  PBR_OBJECT_UNIFORM_LAYOUT,',
    'PBR test Dynamic TAA import',
  );
  const testCase = `\n  it('writes opt-in linear-HDR Color and encoded Normal MRT into a prepared Dynamic TAA frame', async () => {\n    const backend = new MockBackend();\n    const createPipeline = vi.spyOn(backend, 'createRenderPipeline');\n    const executeFrame = vi.spyOn(backend, 'executeFrame');\n    await backend.initialize();\n    const scene = new Scene();\n    const camera = new PerspectiveCamera();\n    const meshRenderers = new MeshRendererStore(scene);\n    const entity = scene.createEntity();\n    meshRenderers.attach(entity, { mesh: createCubeGeometry() });\n    const history = new DynamicTaaGpuHistory({\n      height: 32,\n      ownerId: 'p4-08-pbr-temporal',\n      width: 64,\n    });\n    history.initialize(backend);\n    const frame = history.prepareFrame({\n      camera: 1,\n      device: 1,\n      environment: 1,\n      geometry: 1,\n      lighting: 1,\n      materials: 1,\n      postProcess: 1,\n      scene: 1,\n      viewport: 1,\n    });\n    const feature = new PbrRenderFeature({\n      camera,\n      dynamicTaaOutput: { acquireFrame: () => frame },\n      frustumCulling: false,\n      meshRenderers,\n      scene,\n      surface: { cssHeight: 32, cssWidth: 64, devicePixelRatio: 1, target },\n    });\n    await feature.initialize({ backend });\n\n    expect(createPipeline).toHaveBeenCalledTimes(12);\n    for (const [descriptor] of createPipeline.mock.calls) {\n      expect(descriptor.depthStencil?.format).toBe('depth32float');\n      expect(descriptor.fragment?.targets?.map(({ format }) => format)).toEqual([\n        'rgba16float',\n        'rgba16float',\n      ]);\n    }\n    expect(\n      feature.render({ backend, dirtyFlags: ['geometry'], frameIndex: 1, timestamp: 0 }),\n    ).toEqual({ drawCalls: 1, instances: 1, triangles: 12, vertices: 36 });\n    const pass = executeFrame.mock.calls[0]?.[0].renderPasses[0];\n    expect(pass).toMatchObject({\n      colorAttachments: [\n        { texture: frame.currentColorTexture },\n        {\n          clearColor: { a: 1, b: 1, g: 0.5, r: 0.5 },\n          texture: frame.writeNormalTexture,\n        },\n      ],\n      depthAttachment: { clearValue: 1, texture: frame.writeDepthTexture },\n      label: 'phase-04-pbr-temporal-mrt-pass',\n    });\n    expect(pass).not.toHaveProperty('surface');\n    expect(feature.getDiagnostics()).toMatchObject({\n      outputTarget: 'dynamic-taa',\n      pipelineCount: 12,\n      temporalOwnerId: 'p4-08-pbr-temporal',\n    });\n\n    feature.dispose();\n    history.cancelFrame();\n    history.dispose();\n    expect(backend.getResourceStatistics().activeCount).toBe(0);\n    backend.dispose();\n    meshRenderers.dispose();\n    camera.dispose();\n    scene.dispose();\n  });\n`;
  source = insertBeforeLast(source, '\n});', testCase, 'PBR test describe closure');
  return source;
});

await update('tests/e2e/phase-04-temporal.spec.ts', (original) => {
  let source = replaceOnce(
    original,
    "const rendererModuleUrl = `/@fs${path.resolve('packages/renderer/src/index.ts')}`;",
    "const rendererModuleUrl = `/@fs${path.resolve('packages/renderer/src/index.ts')}`;\nconst sdkModuleUrl = `/@fs${path.resolve('packages/sdk/src/index.ts')}`;",
    'Phase 4 SDK module URL',
  );
  const browserCase = `\n  test('submits the real PBR linear-HDR and Normal MRT path into Dynamic TAA targets', async ({\n    page,\n  }) => {\n    const runtimeErrors: string[] = [];\n    page.on('console', (message) => {\n      if (message.type() === 'error') runtimeErrors.push(message.text());\n    });\n    page.on('pageerror', (error) => runtimeErrors.push(error.message));\n    await page.goto('/acceptance/phase-01');\n\n    const result = await page.evaluate(\n      async ({ backendUrl, sdkUrl, signature }) => {\n        const { createWebGpuBackend } = (await import(\n          /* @vite-ignore */ backendUrl\n        )) as typeof import('../../packages/backend-webgpu/src/index.js');\n        const {\n          DynamicTaaGpuHistory,\n          MeshRendererStore,\n          PbrRenderFeature,\n          PerspectiveCamera,\n          Scene,\n          createCubeGeometry,\n        } = (await import(\n          /* @vite-ignore */ sdkUrl\n        )) as typeof import('../../packages/sdk/src/index.js');\n        const backend = createWebGpuBackend({ label: 'phase-04-pbr-temporal-gate' });\n        const scene = new Scene();\n        const camera = new PerspectiveCamera();\n        const meshRenderers = new MeshRendererStore(scene);\n        const entity = scene.createEntity();\n        meshRenderers.attach(entity, { mesh: createCubeGeometry() });\n        const history = new DynamicTaaGpuHistory({\n          height: 2,\n          ownerId: 'phase-04-pbr-temporal-gate',\n          width: 3,\n        });\n        const target = document.createElement('canvas');\n        target.height = 2;\n        target.width = 3;\n        let frame: ReturnType<typeof history.prepareFrame> | undefined;\n        const feature = new PbrRenderFeature({\n          camera,\n          dynamicTaaOutput: {\n            acquireFrame: () => {\n              if (frame === undefined) throw new Error('PBR temporal frame is not prepared.');\n              return frame;\n            },\n          },\n          frustumCulling: false,\n          meshRenderers,\n          scene,\n          surface: { cssHeight: 2, cssWidth: 3, devicePixelRatio: 1, target },\n        });\n        try {\n          await backend.initialize();\n          history.initialize(backend);\n          frame = history.prepareFrame(signature);\n          await feature.initialize({ backend });\n          const statistics = feature.render({\n            backend,\n            dirtyFlags: ['geometry'],\n            frameIndex: 1,\n            timestamp: 0,\n          });\n          await backend.waitForIdle();\n          const diagnostics = feature.getDiagnostics();\n          const resourcesBeforeDispose = backend.getResourceStatistics();\n          feature.dispose();\n          history.cancelFrame();\n          history.dispose();\n          const resourcesAfterDispose = backend.getResourceStatistics();\n          return {\n            checkpoint: 'P4-08',\n            diagnostics,\n            resourcesAfterDispose,\n            resourcesBeforeDispose,\n            statistics,\n            status: 'PASS',\n          };\n        } finally {\n          feature.dispose();\n          history.dispose();\n          meshRenderers.dispose();\n          camera.dispose();\n          scene.dispose();\n          backend.dispose();\n        }\n      },\n      { backendUrl: backendModuleUrl, sdkUrl: sdkModuleUrl, signature: historySignature },\n    );\n\n    expect(result.statistics).toEqual({\n      drawCalls: 1,\n      instances: 1,\n      triangles: 12,\n      vertices: 36,\n    });\n    expect(result.diagnostics).toMatchObject({\n      outputTarget: 'dynamic-taa',\n      pipelineCount: 12,\n      temporalOwnerId: 'phase-04-pbr-temporal-gate',\n      visibility: { visibleCount: 1 },\n    });\n    expect(result.resourcesBeforeDispose.byKind).toMatchObject({\n      pipeline: { activeCount: 12 },\n      surface: { activeCount: 1 },\n      texture: { activeCount: 13 },\n    });\n    expect(result.resourcesAfterDispose.activeCount).toBe(0);\n    expect(runtimeErrors).toEqual([]);\n\n    const runtimeDirectory = path.resolve('test-results/phase-04/runtime');\n    await mkdir(runtimeDirectory, { recursive: true });\n    await writeFile(\n      path.join(runtimeDirectory, 'pbr-temporal-output.json'),\n      `${JSON.stringify({ schemaVersion: 1, phase: '04', ...result }, null, 2)}\\n`,\n    );\n  });\n`;
  source = insertBeforeLast(source, '\n});', browserCase, 'Phase 4 browser describe closure');
  return source;
});

await update('docs/research/phase-04-temporal-state-contract.md', (source) =>
  `${source.trimEnd()}\n\n## PBR temporal offscreen output\n\nP4-08 adds an opt-in output mode to the existing forward PBR Render Feature. The default accepted\nPhase 3 Surface path retains its original tone-mapped sRGB Shader, one Color target, `depth24plus`\nDepth owner, Pipeline variants, and public behavior. Supplying `dynamicTaaOutput.acquireFrame` selects\na separate Shader and Pipeline family that writes linear-HDR `rgba16float` Color at location 0,\nworld-space Normal encoded from `[-1, 1]` into `[0, 1]` in `rgba16float` at location 1, and canonical\nWebGPU Depth into the caller-prepared `depth32float` write target.\n\nThe Render Feature validates that the immutable frame extent exactly matches the physical Surface\nextent and records the non-empty temporal Owner ID. It acquires one frame per submission but never\ncommits, cancels, resizes, swaps, or disposes caller-owned History resources. The caller order remains\n`prepare frame → PBR scene MRT → Dynamic TAA resolve → commit frame`. Resize therefore updates only\nthe Surface/Camera contract in temporal mode; the next render fails closed until the caller has resized\nHistory to the same physical extent. Device Lost clears only cached Feature resources and diagnostic\nOwner identity; existing History recovery remains independently owned.\n\nOpaque and Mask materials write unit Alpha to Current Color; Blend preserves the material Alpha and\nuses the existing Color blend contract while the encoded Normal attachment remains unblended. Final\nPresent, Output Transform, Static Accumulation, Motion Vectors for deforming geometry, Render Graph\nscheduling, the Phase 4 route, and acceptance remain subsequent checkpoints.\n`,
);
