import { replaceExact, writeGeneratedMirror } from './helpers.mjs';

await replaceExact(
  'packages/renderer/src/dynamic-taa-gpu-history.ts',
  `const CURRENT_COLOR_BYTES_PER_TEXEL = 8;`,
  `const CURRENT_COLOR_BYTES_PER_TEXEL = 8;
const CURRENT_VELOCITY_BYTES_PER_TEXEL = 4;`,
);
await replaceExact(
  'packages/renderer/src/dynamic-taa-gpu-history.ts',
  `  readonly currentColorTexture: BackendTextureHandle;
  readonly historyValid: boolean;`,
  `  readonly currentColorTexture: BackendTextureHandle;
  readonly currentVelocityTexture: BackendTextureHandle;
  readonly historyValid: boolean;`,
);
await replaceExact(
  'packages/renderer/src/dynamic-taa-gpu-history.ts',
  `  readonly currentColorTexture: BackendTextureHandle;
  readonly sampler: BackendSamplerHandle;`,
  `  readonly currentColorTexture: BackendTextureHandle;
  readonly currentVelocityTexture: BackendTextureHandle;
  readonly sampler: BackendSamplerHandle;`,
);
await replaceExact(
  'packages/renderer/src/dynamic-taa-gpu-history.ts',
  `      currentColorTexture: resources.currentColorTexture,
      historyValid,`,
  `      currentColorTexture: resources.currentColorTexture,
      currentVelocityTexture: resources.currentVelocityTexture,
      historyValid,`,
);
await replaceExact(
  'packages/renderer/src/dynamic-taa-gpu-history.ts',
  `(CURRENT_COLOR_BYTES_PER_TEXEL + RESOLVED_SET_BYTES_PER_TEXEL * RESOLVED_SET_COUNT),`,
  `(CURRENT_COLOR_BYTES_PER_TEXEL +
          CURRENT_VELOCITY_BYTES_PER_TEXEL +
          RESOLVED_SET_BYTES_PER_TEXEL * RESOLVED_SET_COUNT),`,
);
await replaceExact(
  'packages/renderer/src/dynamic-taa-gpu-history.ts',
  `        format: 'depth32float' | 'rgba16float',`,
  `        format: 'depth32float' | 'rg16float' | 'rgba16float',`,
);
await replaceExact(
  'packages/renderer/src/dynamic-taa-gpu-history.ts',
  `      const currentColorTexture = createTexture(
        \`taa-history-${'${this.#ownerId}'}-current-color\`,
        'rgba16float',
      );`,
  `      const currentColorTexture = createTexture(
        \`taa-history-${'${this.#ownerId}'}-current-color\`,
        'rgba16float',
      );
      const currentVelocityTexture = createTexture(
        \`taa-history-${'${this.#ownerId}'}-current-velocity\`,
        'rg16float',
      );`,
);
await replaceExact(
  'packages/renderer/src/dynamic-taa-gpu-history.ts',
  `        currentColorTexture,
        sampler,`,
  `        currentColorTexture,
        currentVelocityTexture,
        sampler,`,
);
await replaceExact(
  'packages/renderer/src/dynamic-taa-gpu-history.ts',
  `      resources.currentColorTexture,
    ]);`,
  `      resources.currentVelocityTexture,
      resources.currentColorTexture,
    ]);`,
);

await replaceExact(
  'shaders/webgpu/phase-04-pbr-temporal-output.wgsl',
  `  environmentControls: vec4f,
}`,
  `  environmentControls: vec4f,
  currentMotionModelViewProjection: mat4x4f,
  previousMotionModelViewProjection: mat4x4f,
}`,
);
await replaceExact(
  'shaders/webgpu/phase-04-pbr-temporal-output.wgsl',
  `  @location(3) worldTangent: vec4f,
}`,
  `  @location(3) worldTangent: vec4f,
  @location(4) @interpolate(linear) currentMotionNdc: vec2f,
  @location(5) @interpolate(linear) previousMotionNdc: vec2f,
}`,
);
await replaceExact(
  'shaders/webgpu/phase-04-pbr-temporal-output.wgsl',
  `  output.worldTangent = vec4f((object.model * vec4f(tangent.xyz, 0.0)).xyz, tangent.w);
  return output;`,
  `  output.worldTangent = vec4f((object.model * vec4f(tangent.xyz, 0.0)).xyz, tangent.w);
  let currentMotionClip = object.currentMotionModelViewProjection * vec4f(position, 1.0);
  let previousMotionClip = object.previousMotionModelViewProjection * vec4f(position, 1.0);
  output.currentMotionNdc = currentMotionClip.xy / max(abs(currentMotionClip.w), PBR_MIN_ALPHA);
  output.previousMotionNdc = previousMotionClip.xy / max(abs(previousMotionClip.w), PBR_MIN_ALPHA);
  return output;`,
);
await replaceExact(
  'shaders/webgpu/phase-04-pbr-temporal-output.wgsl',
  `struct PbrTemporalFragmentOutput {
  @location(0) color: vec4f,
  @location(1) normal: vec4f,
}`,
  `struct PbrTemporalFragmentOutput {
  @location(0) color: vec4f,
  @location(1) normal: vec4f,
  @location(2) velocity: vec2f,
}

fn pbrTemporalVelocity(input: VertexOutput) -> vec2f {
  return input.currentMotionNdc - input.previousMotionNdc;
}`,
);
await replaceExact(
  'shaders/webgpu/phase-04-pbr-temporal-output.wgsl',
  `  return PbrTemporalFragmentOutput(vec4f(shaded.color.rgb, 1.0), shaded.normal);`,
  `  return PbrTemporalFragmentOutput(
    vec4f(shaded.color.rgb, 1.0),
    shaded.normal,
    pbrTemporalVelocity(input),
  );`,
);
await replaceExact(
  'shaders/webgpu/phase-04-pbr-temporal-output.wgsl',
  `  return PbrTemporalFragmentOutput(shaded.color, shaded.normal);`,
  `  return PbrTemporalFragmentOutput(shaded.color, shaded.normal, pbrTemporalVelocity(input));`,
);
await writeGeneratedMirror(
  'shaders/webgpu/phase-04-pbr-temporal-output.wgsl',
  'packages/renderer/src/generated/phase-04-pbr-temporal-output.wgsl.ts',
  'PHASE_04_PBR_TEMPORAL_OUTPUT_WGSL',
);
