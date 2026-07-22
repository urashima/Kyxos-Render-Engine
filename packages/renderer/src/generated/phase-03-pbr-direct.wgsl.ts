// Generated mirror of shaders/webgpu/phase-03-pbr-direct.wgsl. Keep validation exact.
export const PHASE_03_PBR_DIRECT_WGSL = `const PBR_PI: f32 = 3.141592653589793;
const PBR_MIN_ALPHA: f32 = 0.0001;

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

struct PbrBrdfResult {
  diffuse: vec3f,
  specular: vec3f,
  total: vec3f,
}

fn pbrRoughnessToAlpha(perceptualRoughness: f32) -> f32 {
  return max(perceptualRoughness * perceptualRoughness, PBR_MIN_ALPHA);
}

fn pbrGgxDistribution(alpha: f32, nDotH: f32) -> f32 {
  if (nDotH <= 0.0) {
    return 0.0;
  }
  let alphaSquared = alpha * alpha;
  let denominator = nDotH * nDotH * (alphaSquared - 1.0) + 1.0;
  return alphaSquared / (PBR_PI * denominator * denominator);
}

fn pbrSmithGgxVisibility(alpha: f32, nDotL: f32, nDotV: f32) -> f32 {
  if (nDotL <= 0.0 || nDotV <= 0.0) {
    return 0.0;
  }
  let alphaSquared = alpha * alpha;
  let lightDenominator = nDotL +
    sqrt(alphaSquared + (1.0 - alphaSquared) * nDotL * nDotL);
  let viewDenominator = nDotV +
    sqrt(alphaSquared + (1.0 - alphaSquared) * nDotV * nDotV);
  return 1.0 / (lightDenominator * viewDenominator);
}

fn pbrSchlickFresnel(f0: vec3f, vDotH: f32) -> vec3f {
  let grazingWeight = pow(1.0 - abs(vDotH), 5.0);
  return f0 + (vec3f(1.0) - f0) * grazingWeight;
}

fn pbrEvaluateMetallicRoughness(
  baseColor: vec3f,
  metallic: f32,
  perceptualRoughness: f32,
  nDotL: f32,
  nDotV: f32,
  nDotH: f32,
  vDotH: f32,
) -> PbrBrdfResult {
  let alpha = pbrRoughnessToAlpha(perceptualRoughness);
  let diffuseColor = baseColor * (1.0 - metallic);
  let f0 = mix(vec3f(0.04), baseColor, vec3f(metallic));
  let fresnel = pbrSchlickFresnel(f0, vDotH);
  if (nDotH <= 0.0 || nDotL <= 0.0 || nDotV <= 0.0) {
    return PbrBrdfResult(vec3f(0.0), vec3f(0.0), vec3f(0.0));
  }
  let distribution = pbrGgxDistribution(alpha, nDotH);
  let visibility = pbrSmithGgxVisibility(alpha, nDotL, nDotV);
  let diffuse = (vec3f(1.0) - fresnel) * diffuseColor / PBR_PI;
  let specular = fresnel * distribution * visibility;
  return PbrBrdfResult(diffuse, specular, diffuse + specular);
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

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) uv0: vec2f,
  @location(3) worldTangent: vec4f,
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
  output.worldPosition = (object.model * vec4f(position, 1.0)).xyz;
  output.worldNormal = (object.normalMatrix * vec4f(normal, 0.0)).xyz;
  output.uv0 = uv0;
  output.worldTangent = vec4f((object.model * vec4f(tangent.xyz, 0.0)).xyz, tangent.w);
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

fn shadePbr(input: VertexOutput, frontFacing: bool) -> vec4f {
  var normal = pbrSafeNormalize(input.worldNormal, vec3f(0.0, 0.0, 1.0));
  if (!frontFacing) {
    normal = -normal;
  }
  normal = pbrApplyNormalMap(input, normal);
  let viewDirection = pbrSafeNormalize(
    object.cameraPosition.xyz - input.worldPosition,
    normal,
  );
  let lightDirection = pbrSafeNormalize(
    object.lightDirectionAndIntensity.xyz,
    normal,
  );
  let halfDirection = pbrSafeNormalize(viewDirection + lightDirection, normal);
  let nDotL = clamp(dot(normal, lightDirection), 0.0, 1.0);
  let nDotV = clamp(dot(normal, viewDirection), 0.0, 1.0);
  let nDotH = clamp(dot(normal, halfDirection), 0.0, 1.0);
  let vDotH = clamp(dot(viewDirection, halfDirection), 0.0, 1.0);
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
  let baseColorSample = textureSample(baseColorTexture, baseColorSampler, baseColorUv);
  let metallicRoughnessSample = textureSample(
    metallicRoughnessTexture,
    metallicRoughnessSampler,
    metallicRoughnessUv,
  );
  let emissiveUv = pbrTransformUv(
    input.uv0,
    object.emissiveUvOffsetScale,
    object.normalEmissiveUvRotations.zw,
  );
  let emissiveSample = textureSample(emissiveTexture, emissiveSampler, emissiveUv).rgb;
  let baseColor = object.baseColor * baseColorSample;
  let material = object.metallicRoughnessAlphaCutoff;
  let brdf = pbrEvaluateMetallicRoughness(
    baseColor.rgb,
    material.x * metallicRoughnessSample.b,
    material.y * metallicRoughnessSample.g,
    nDotL,
    nDotV,
    nDotH,
    vDotH,
  );
  let directRadiance = brdf.total *
    object.lightColor.rgb *
    object.lightDirectionAndIntensity.w *
    nDotL;
  let emission =
    object.emissiveAndStrength.rgb * object.emissiveAndStrength.w * emissiveSample;
  return vec4f(max(directRadiance + emission, vec3f(0.0)), baseColor.a);
}

@fragment
fn fragmentOpaque(
  input: VertexOutput,
  @builtin(front_facing) frontFacing: bool,
) -> @location(0) vec4f {
  return vec4f(shadePbr(input, frontFacing).rgb, 1.0);
}

@fragment
fn fragmentMask(
  input: VertexOutput,
  @builtin(front_facing) frontFacing: bool,
) -> @location(0) vec4f {
  let shaded = shadePbr(input, frontFacing);
  if (shaded.a < object.metallicRoughnessAlphaCutoff.z) {
    discard;
  }
  return vec4f(shaded.rgb, 1.0);
}

@fragment
fn fragmentBlend(
  input: VertexOutput,
  @builtin(front_facing) frontFacing: bool,
) -> @location(0) vec4f {
  return shadePbr(input, frontFacing);
}
`;
