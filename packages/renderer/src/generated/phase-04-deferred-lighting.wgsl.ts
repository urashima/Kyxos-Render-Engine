// Generated mirror of shaders/webgpu/phase-04-deferred-lighting.wgsl. Keep validation exact.
export const PHASE_04_DEFERRED_LIGHTING_WGSL = `const PBR_PI: f32 = 3.141592653589793;
const PBR_MIN_ALPHA: f32 = 0.0001;

struct DeferredLightingUniforms {
  inverseViewProjection: mat4x4f,
  cameraPosition: vec4f,
  lightDirectionAndIntensity: vec4f,
  lightColorAndAmbient: vec4f,
  viewportSizeAndInvSize: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
}

struct PbrBrdfResult {
  diffuse: vec3f,
  specular: vec3f,
  total: vec3f,
}

@group(0) @binding(0) var<uniform> lighting: DeferredLightingUniforms;
@group(0) @binding(1) var baseColorMetallicTexture: texture_2d<f32>;
@group(0) @binding(2) var normalRoughnessTexture: texture_2d<f32>;
@group(0) @binding(3) var emissiveOcclusionTexture: texture_2d<f32>;
@group(0) @binding(4) var depthTexture: texture_depth_2d;

fn pbrSafeNormalize(value: vec3f, fallback: vec3f) -> vec3f {
  let squaredLength = dot(value, value);
  if (squaredLength <= 0.000000000001) {
    return fallback;
  }
  return value * inverseSqrt(squaredLength);
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

fn reconstructWorldPosition(pixel: vec2i, depth: f32) -> vec3f {
  let uv = (vec2f(pixel) + vec2f(0.5)) * lighting.viewportSizeAndInvSize.zw;
  let clipPosition = vec4f(
    uv.x * 2.0 - 1.0,
    1.0 - uv.y * 2.0,
    depth,
    1.0,
  );
  let worldPosition = lighting.inverseViewProjection * clipPosition;
  return worldPosition.xyz / max(abs(worldPosition.w), 0.0000001);
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = max(vec2i(textureDimensions(baseColorMetallicTexture)), vec2i(1));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let depth = textureLoad(depthTexture, pixel, 0);
  if (depth >= 1.0) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }

  let baseColorMetallic = textureLoad(baseColorMetallicTexture, pixel, 0);
  let normalRoughness = textureLoad(normalRoughnessTexture, pixel, 0);
  let emissiveOcclusion = textureLoad(emissiveOcclusionTexture, pixel, 0);
  let baseColor = max(baseColorMetallic.rgb, vec3f(0.0));
  let metallic = clamp(baseColorMetallic.a, 0.0, 1.0);
  let normal = pbrSafeNormalize(normalRoughness.xyz, vec3f(0.0, 0.0, 1.0));
  let perceptualRoughness = clamp(normalRoughness.a, 0.0, 1.0);
  let occlusion = clamp(emissiveOcclusion.a, 0.0, 1.0);
  let worldPosition = reconstructWorldPosition(pixel, depth);
  let viewDirection = pbrSafeNormalize(lighting.cameraPosition.xyz - worldPosition, normal);
  let lightDirection = pbrSafeNormalize(lighting.lightDirectionAndIntensity.xyz, normal);
  let halfDirection = pbrSafeNormalize(viewDirection + lightDirection, normal);
  let nDotL = clamp(dot(normal, lightDirection), 0.0, 1.0);
  let nDotV = clamp(dot(normal, viewDirection), 0.0, 1.0);
  let nDotH = clamp(dot(normal, halfDirection), 0.0, 1.0);
  let vDotH = clamp(dot(viewDirection, halfDirection), 0.0, 1.0);
  let brdf = pbrEvaluateMetallicRoughness(
    baseColor,
    metallic,
    perceptualRoughness,
    nDotL,
    nDotV,
    nDotH,
    vDotH,
  );
  let directRadiance = brdf.total *
    lighting.lightColorAndAmbient.rgb *
    lighting.lightDirectionAndIntensity.w *
    nDotL;
  let ambientRadiance = baseColor *
    (1.0 - metallic) *
    lighting.lightColorAndAmbient.w *
    occlusion;
  return vec4f(
    max(directRadiance + ambientRadiance + emissiveOcclusion.rgb, vec3f(0.0)),
    1.0,
  );
}
`;
