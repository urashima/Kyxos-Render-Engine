const PBR_PI: f32 = 3.141592653589793;
const PBR_MIN_ALPHA: f32 = 0.0001;

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

struct PbrReferenceOutput {
  diffuseAndAlpha: vec4f,
  specularAndDistribution: vec4f,
  totalAndVisibility: vec4f,
}

@group(0) @binding(0) var<storage, read_write> referenceOutput: PbrReferenceOutput;

fn pbrReferenceResult() -> PbrBrdfResult {
  return pbrEvaluateMetallicRoughness(
    vec3f(0.8, 0.3, 0.1),
    0.65,
    0.42,
    0.73,
    0.81,
    0.92,
    0.88,
  );
}

@compute @workgroup_size(1)
fn computeMain() {
  let result = pbrReferenceResult();
  let alpha = pbrRoughnessToAlpha(0.42);
  let distribution = pbrGgxDistribution(alpha, 0.92);
  let visibility = pbrSmithGgxVisibility(alpha, 0.73, 0.81);
  referenceOutput.diffuseAndAlpha = vec4f(result.diffuse, alpha);
  referenceOutput.specularAndDistribution = vec4f(result.specular, distribution);
  referenceOutput.totalAndVisibility = vec4f(result.total, visibility);
}

struct VertexOutput {
  @builtin(position) position: vec4f,
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
fn fragmentMain() -> @location(0) vec4f {
  return vec4f(pbrReferenceResult().total, 1.0);
}
