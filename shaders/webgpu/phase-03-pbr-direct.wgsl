const PBR_PI: f32 = 3.141592653589793;
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
}

@group(0) @binding(0) var<uniform> object: PbrObjectUniforms;

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

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) worldNormal: vec3f,
}

@vertex
fn vertexMain(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = object.modelViewProjection * vec4f(position, 1.0);
  output.worldPosition = (object.model * vec4f(position, 1.0)).xyz;
  output.worldNormal = (object.normalMatrix * vec4f(normal, 0.0)).xyz;
  return output;
}

fn shadePbr(input: VertexOutput, frontFacing: bool) -> vec4f {
  var normal = pbrSafeNormalize(input.worldNormal, vec3f(0.0, 0.0, 1.0));
  if (!frontFacing) {
    normal = -normal;
  }
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
  let material = object.metallicRoughnessAlphaCutoff;
  let brdf = pbrEvaluateMetallicRoughness(
    object.baseColor.rgb,
    material.x,
    material.y,
    nDotL,
    nDotV,
    nDotH,
    vDotH,
  );
  let directRadiance = brdf.total *
    object.lightColor.rgb *
    object.lightDirectionAndIntensity.w *
    nDotL;
  let emission = object.emissiveAndStrength.rgb * object.emissiveAndStrength.w;
  return vec4f(max(directRadiance + emission, vec3f(0.0)), object.baseColor.a);
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
