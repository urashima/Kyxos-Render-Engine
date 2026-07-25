// Generated mirror of shaders/webgpu/phase-04-deferred-gbuffer.wgsl. Keep validation exact.
export const PHASE_04_DEFERRED_GBUFFER_WGSL = `const PBR_MIN_ALPHA: f32 = 0.0001;

struct PbrObjectUniforms {
  modelViewProjection: mat4x4f,
  model: mat4x4f,
  normalMatrix: mat4x4f,
  baseColor: vec4f,
  emissiveAndStrength: vec4f,
  metallicRoughnessAlphaCutoff: vec4f,
  normalOcclusion: vec4f,
  cameraPosition: vec4f,
  lightDirectionAndIntensity: vec4f,
  lightColor: vec4f,
  baseColorUvOffsetScale: vec4f,
  metallicRoughnessUvOffsetScale: vec4f,
  normalUvOffsetScale: vec4f,
  emissiveUvOffsetScale: vec4f,
  textureUvRotations: vec4f,
  normalEmissiveUvRotations: vec4f,
  occlusionUvOffsetScale: vec4f,
  occlusionEnvironmentRotations: vec4f,
  environmentControls: vec4f,
  currentMotionModelViewProjection: mat4x4f,
  previousMotionModelViewProjection: mat4x4f,
}

@group(0) @binding(0) var<uniform> object: PbrObjectUniforms;
@group(0) @binding(1) var baseColorTexture: texture_2d<f32>;
@group(0) @binding(2) var baseColorSampler: sampler;
@group(0) @binding(3) var metallicRoughnessTexture: texture_2d<f32>;
@group(0) @binding(4) var metallicRoughnessSampler: sampler;
@group(0) @binding(5) var normalTexture: texture_2d<f32>;
@group(0) @binding(6) var normalSampler: sampler;
@group(0) @binding(7) var emissiveTexture: texture_2d<f32>;
@group(0) @binding(8) var emissiveSampler: sampler;
@group(0) @binding(9) var occlusionTexture: texture_2d<f32>;
@group(0) @binding(10) var occlusionSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldNormal: vec3f,
  @location(1) uv0: vec2f,
  @location(2) worldTangent: vec4f,
  @location(3) @interpolate(linear) currentMotionNdc: vec2f,
  @location(4) @interpolate(linear) previousMotionNdc: vec2f,
}

struct DeferredGBufferFragmentOutput {
  @location(0) baseColorMetallic: vec4f,
  @location(1) normalRoughness: vec4f,
  @location(2) emissiveOcclusion: vec4f,
  @location(3) velocity: vec2f,
}

fn pbrSafeNormalize(value: vec3f, fallback: vec3f) -> vec3f {
  let squaredLength = dot(value, value);
  if (squaredLength <= 0.000000000001) {
    return fallback;
  }
  return value * inverseSqrt(squaredLength);
}

fn pbrTransformUv(uv: vec2f, offsetScale: vec4f, rotation: vec2f) -> vec2f {
  let scaled = uv * offsetScale.zw;
  let rotated = vec2f(
    rotation.x * scaled.x - rotation.y * scaled.y,
    rotation.y * scaled.x + rotation.x * scaled.y,
  );
  return rotated + offsetScale.xy;
}

@vertex
fn vertexMain(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv0: vec2f,
  @location(3) tangent: vec4f,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = object.modelViewProjection * vec4f(position, 1.0);
  output.worldNormal = (object.normalMatrix * vec4f(normal, 0.0)).xyz;
  output.uv0 = uv0;
  output.worldTangent = vec4f((object.model * vec4f(tangent.xyz, 0.0)).xyz, tangent.w);

  let currentMotionClip = object.currentMotionModelViewProjection * vec4f(position, 1.0);
  let previousMotionClip = object.previousMotionModelViewProjection * vec4f(position, 1.0);
  output.currentMotionNdc = currentMotionClip.xy / max(abs(currentMotionClip.w), PBR_MIN_ALPHA);
  output.previousMotionNdc =
    previousMotionClip.xy / max(abs(previousMotionClip.w), PBR_MIN_ALPHA);
  return output;
}

fn pbrApplyNormalMap(input: VertexOutput, geometricNormal: vec3f) -> vec3f {
  if (object.normalOcclusion.z < 0.5) {
    return geometricNormal;
  }
  let uv = pbrTransformUv(
    input.uv0,
    object.normalUvOffsetScale,
    object.normalEmissiveUvRotations.xy,
  );
  var tangentNormal = textureSample(normalTexture, normalSampler, uv).xyz * 2.0 - 1.0;
  tangentNormal.x *= object.normalOcclusion.x;
  tangentNormal.y *= object.normalOcclusion.x * object.normalOcclusion.w;
  tangentNormal = pbrSafeNormalize(tangentNormal, vec3f(0.0, 0.0, 1.0));
  let tangent = pbrSafeNormalize(
    input.worldTangent.xyz - geometricNormal * dot(geometricNormal, input.worldTangent.xyz),
    vec3f(1.0, 0.0, 0.0),
  );
  let modelOrientation = select(
    -1.0,
    1.0,
    dot(cross(object.model[0].xyz, object.model[1].xyz), object.model[2].xyz) >= 0.0,
  );
  let bitangent = cross(geometricNormal, tangent) * input.worldTangent.w * modelOrientation;
  return pbrSafeNormalize(
    tangent * tangentNormal.x + bitangent * tangentNormal.y + geometricNormal * tangentNormal.z,
    geometricNormal,
  );
}

fn writeGBuffer(
  input: VertexOutput,
  frontFacing: bool,
) -> DeferredGBufferFragmentOutput {
  var normal = pbrSafeNormalize(input.worldNormal, vec3f(0.0, 0.0, 1.0));
  if (!frontFacing) {
    normal = -normal;
  }
  normal = pbrApplyNormalMap(input, normal);

  let baseColorUv = pbrTransformUv(
    input.uv0,
    object.baseColorUvOffsetScale,
    object.textureUvRotations.xy,
  );
  let metallicRoughnessUv = pbrTransformUv(
    input.uv0,
    object.metallicRoughnessUvOffsetScale,
    object.textureUvRotations.zw,
  );
  let emissiveUv = pbrTransformUv(
    input.uv0,
    object.emissiveUvOffsetScale,
    object.normalEmissiveUvRotations.zw,
  );
  let occlusionUv = pbrTransformUv(
    input.uv0,
    object.occlusionUvOffsetScale,
    object.occlusionEnvironmentRotations.xy,
  );

  let baseColor = object.baseColor * textureSample(baseColorTexture, baseColorSampler, baseColorUv);
  let metallicRoughness = textureSample(
    metallicRoughnessTexture,
    metallicRoughnessSampler,
    metallicRoughnessUv,
  );
  let metallic = clamp(object.metallicRoughnessAlphaCutoff.x * metallicRoughness.b, 0.0, 1.0);
  let roughness = clamp(object.metallicRoughnessAlphaCutoff.y * metallicRoughness.g, 0.04, 1.0);
  let emissive =
    object.emissiveAndStrength.rgb *
    object.emissiveAndStrength.w *
    textureSample(emissiveTexture, emissiveSampler, emissiveUv).rgb;
  let occlusionSample = textureSample(occlusionTexture, occlusionSampler, occlusionUv).r;
  let ambientOcclusion = mix(1.0, occlusionSample, object.normalOcclusion.y);

  return DeferredGBufferFragmentOutput(
    vec4f(baseColor.rgb, metallic),
    vec4f(normal * 0.5 + vec3f(0.5), roughness),
    vec4f(emissive, ambientOcclusion),
    input.currentMotionNdc - input.previousMotionNdc,
  );
}

@fragment
fn fragmentOpaque(
  input: VertexOutput,
  @builtin(front_facing) frontFacing: bool,
) -> DeferredGBufferFragmentOutput {
  return writeGBuffer(input, frontFacing);
}

@fragment
fn fragmentMask(
  input: VertexOutput,
  @builtin(front_facing) frontFacing: bool,
) -> DeferredGBufferFragmentOutput {
  let baseColorUv = pbrTransformUv(
    input.uv0,
    object.baseColorUvOffsetScale,
    object.textureUvRotations.xy,
  );
  let alpha = object.baseColor.a * textureSample(baseColorTexture, baseColorSampler, baseColorUv).a;
  if (alpha < object.metallicRoughnessAlphaCutoff.z) {
    discard;
  }
  return writeGBuffer(input, frontFacing);
}
`;
