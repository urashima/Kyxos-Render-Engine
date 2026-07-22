// Generated mirror of shaders/webgpu/phase-03-ibl-reference.wgsl. Keep validation exact.
export const PHASE_03_IBL_REFERENCE_WGSL = `const IBL_PI: f32 = 3.141592653589793;
const IBL_MIN_ALPHA: f32 = 0.0001;
const IBL_SAMPLE_COUNT: u32 = 64u;

struct IblFrame {
  tangent: vec3f,
  bitangent: vec3f,
  normal: vec3f,
}

struct IblDiffuseResult {
  irradiance: vec3f,
  lambertianRadiance: vec3f,
}

struct IblSpecularResult {
  radiance: vec3f,
  sampleWeight: f32,
}

struct IblReferenceOutput {
  diffuseIrradianceAndCount: vec4f,
  diffuseRadianceAndPi: vec4f,
  specularPrefilterAndWeight: vec4f,
  brdfLutAndInput: vec4f,
}

@group(0) @binding(0) var<storage, read_write> referenceOutput: IblReferenceOutput;

fn iblRoughnessToAlpha(perceptualRoughness: f32) -> f32 {
  return max(perceptualRoughness * perceptualRoughness, IBL_MIN_ALPHA);
}

fn iblRadicalInverseVdc(value: u32) -> f32 {
  var bits = value;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return f32(bits) * 2.3283064365386963e-10;
}

fn iblHammersley2d(index: u32) -> vec2f {
  return vec2f(f32(index) / f32(IBL_SAMPLE_COUNT), iblRadicalInverseVdc(index));
}

fn iblTangentFrame(normal: vec3f) -> IblFrame {
  var referenceAxis = vec3f(0.0, 0.0, 1.0);
  if (abs(normal.z) >= 0.999) {
    referenceAxis = vec3f(0.0, 1.0, 0.0);
  }
  let tangent = normalize(cross(referenceAxis, normal));
  return IblFrame(tangent, cross(normal, tangent), normal);
}

fn iblWorldDirection(frame: IblFrame, localDirection: vec3f) -> vec3f {
  return normalize(
    frame.tangent * localDirection.x +
      frame.bitangent * localDirection.y +
      frame.normal * localDirection.z,
  );
}

fn iblCosineHemisphereSample(point: vec2f) -> vec3f {
  let phi = 2.0 * IBL_PI * point.x;
  let cosine = sqrt(1.0 - point.y);
  let sine = sqrt(point.y);
  return vec3f(sine * cos(phi), sine * sin(phi), cosine);
}

fn iblGgxHalfVectorSample(point: vec2f, perceptualRoughness: f32) -> vec3f {
  let alpha = iblRoughnessToAlpha(perceptualRoughness);
  let alphaSquared = alpha * alpha;
  let denominator = 1.0 + (alphaSquared - 1.0) * point.y;
  let cosine = sqrt((1.0 - point.y) / denominator);
  let sine = sqrt(max(0.0, 1.0 - cosine * cosine));
  let phi = 2.0 * IBL_PI * point.x;
  return vec3f(sine * cos(phi), sine * sin(phi), cosine);
}

fn iblEnvironmentRadiance(direction: vec3f) -> vec3f {
  let normalized = normalize(direction);
  let x = normalized.x;
  let y = normalized.y;
  let z = normalized.z;
  return vec3f(
    0.16 + 0.26 * (0.5 + 0.5 * x) + 0.12 * y * y,
    0.12 + 0.32 * (0.5 + 0.5 * y) + 0.08 * z * z,
    0.1 + 0.38 * (0.5 + 0.5 * z) + 0.06 * x * y,
  );
}

fn iblConvolveDiffuse(surfaceNormal: vec3f) -> IblDiffuseResult {
  let frame = iblTangentFrame(normalize(surfaceNormal));
  var accumulated = vec3f(0.0);
  for (var index = 0u; index < IBL_SAMPLE_COUNT; index += 1u) {
    let localDirection = iblCosineHemisphereSample(iblHammersley2d(index));
    let sampleDirection = iblWorldDirection(frame, localDirection);
    accumulated += iblEnvironmentRadiance(sampleDirection);
  }
  let lambertianRadiance = accumulated / f32(IBL_SAMPLE_COUNT);
  return IblDiffuseResult(lambertianRadiance * IBL_PI, lambertianRadiance);
}

fn iblPrefilterGgx(reflectionDirection: vec3f, perceptualRoughness: f32) -> IblSpecularResult {
  let frame = iblTangentFrame(normalize(reflectionDirection));
  var accumulated = vec3f(0.0);
  var sampleWeight = 0.0;
  for (var index = 0u; index < IBL_SAMPLE_COUNT; index += 1u) {
    let localHalf = iblGgxHalfVectorSample(iblHammersley2d(index), perceptualRoughness);
    let halfVector = iblWorldDirection(frame, localHalf);
    let light = normalize(reflect(-frame.normal, halfVector));
    let nDotL = max(dot(frame.normal, light), 0.0);
    if (nDotL > 0.0) {
      accumulated += iblEnvironmentRadiance(light) * nDotL;
      sampleWeight += nDotL;
    }
  }
  var radiance = vec3f(0.0);
  if (sampleWeight > 0.0) {
    radiance = accumulated / sampleWeight;
  }
  return IblSpecularResult(radiance, sampleWeight);
}

fn iblSmithGgxVisibility(alpha: f32, nDotL: f32, nDotV: f32) -> f32 {
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

fn iblIntegrateBrdfLut(requestedNdotV: f32, perceptualRoughness: f32) -> vec2f {
  let nDotV = max(requestedNdotV, IBL_MIN_ALPHA);
  let alpha = iblRoughnessToAlpha(perceptualRoughness);
  let view = vec3f(sqrt(max(0.0, 1.0 - nDotV * nDotV)), 0.0, nDotV);
  var scale = 0.0;
  var bias = 0.0;

  for (var index = 0u; index < IBL_SAMPLE_COUNT; index += 1u) {
    let halfVector = iblGgxHalfVectorSample(iblHammersley2d(index), perceptualRoughness);
    let light = normalize(reflect(-view, halfVector));
    let nDotL = max(light.z, 0.0);
    let nDotH = max(halfVector.z, 0.0);
    let vDotH = max(dot(view, halfVector), 0.0);
    if (nDotL > 0.0 && nDotH > 0.0 && vDotH > 0.0) {
      let visibility = iblSmithGgxVisibility(alpha, nDotL, nDotV);
      let visibilityOverPdf = 4.0 * visibility * vDotH * nDotL / nDotH;
      let grazingWeight = pow(1.0 - vDotH, 5.0);
      scale += (1.0 - grazingWeight) * visibilityOverPdf;
      bias += grazingWeight * visibilityOverPdf;
    }
  }

  return vec2f(scale, bias) / f32(IBL_SAMPLE_COUNT);
}

@compute @workgroup_size(1)
fn computeMain() {
  let diffuseNormal = normalize(vec3f(0.31, 0.82, 0.48));
  let specularDirection = normalize(vec3f(-0.42, 0.35, 0.84));
  let specularRoughness = 0.43;
  let brdfNdotV = 0.67;
  let brdfRoughness = 0.38;
  let diffuse = iblConvolveDiffuse(diffuseNormal);
  let specular = iblPrefilterGgx(specularDirection, specularRoughness);
  let brdfLut = iblIntegrateBrdfLut(brdfNdotV, brdfRoughness);
  referenceOutput.diffuseIrradianceAndCount =
    vec4f(diffuse.irradiance, f32(IBL_SAMPLE_COUNT));
  referenceOutput.diffuseRadianceAndPi = vec4f(diffuse.lambertianRadiance, IBL_PI);
  referenceOutput.specularPrefilterAndWeight = vec4f(specular.radiance, specular.sampleWeight);
  referenceOutput.brdfLutAndInput =
    vec4f(brdfLut.x, brdfLut.y, brdfNdotV, brdfRoughness);
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
  return vec4f(iblEnvironmentRadiance(vec3f(0.2, 0.7, -0.4)), 1.0);
}
`;
