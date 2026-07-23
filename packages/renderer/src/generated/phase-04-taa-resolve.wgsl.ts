export const PHASE_04_TAA_RESOLVE_WGSL = `const TAA_REPROJECTION_EPSILON: f32 = 0.000001;

struct DynamicTaaResolveUniforms {
  currentInverseViewProjection: mat4x4f,
  previousViewProjection: mat4x4f,
  viewportHistoryResponsive: vec4f,
  options0: vec4f,
  options1: vec4f,
}

struct TaaNeighborhoodBounds {
  minimum: vec3f,
  maximum: vec3f,
}

struct TaaReprojection {
  historyUv: vec2f,
  valid: f32,
  _padding: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
}

@group(0) @binding(0) var<uniform> resolveUniforms: DynamicTaaResolveUniforms;
@group(0) @binding(1) var currentColorTexture: texture_2d<f32>;
@group(0) @binding(2) var currentDepthTexture: texture_depth_2d;
@group(0) @binding(3) var currentNormalTexture: texture_2d<f32>;
@group(0) @binding(4) var historyColorTexture: texture_2d<f32>;
@group(0) @binding(5) var historyDepthTexture: texture_depth_2d;
@group(0) @binding(6) var historyNormalTexture: texture_2d<f32>;
@group(0) @binding(7) var historySampler: sampler;

fn taaUvInBounds(uv: vec2f) -> bool {
  return all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
}

fn taaScalarInvalid(value: f32) -> bool {
  return (bitcast<u32>(value) & 0x7f800000u) == 0x7f800000u;
}

fn taaVectorInvalid(value: vec4f) -> bool {
  return taaScalarInvalid(value.x) ||
    taaScalarInvalid(value.y) ||
    taaScalarInvalid(value.z) ||
    taaScalarInvalid(value.w);
}

fn taaReproject(currentUv: vec2f, currentDepth: f32) -> TaaReprojection {
  if (!taaUvInBounds(currentUv) || currentDepth >= 1.0) {
    return TaaReprojection(currentUv, 0.0, 0.0);
  }
  let currentNdc = vec3f(currentUv.x * 2.0 - 1.0, 1.0 - currentUv.y * 2.0, currentDepth);
  let worldHomogeneous =
    resolveUniforms.currentInverseViewProjection * vec4f(currentNdc, 1.0);
  if (
    taaVectorInvalid(worldHomogeneous) ||
    abs(worldHomogeneous.w) <= TAA_REPROJECTION_EPSILON
  ) {
    return TaaReprojection(currentUv, 0.0, 0.0);
  }
  let worldPosition = worldHomogeneous.xyz / worldHomogeneous.w;
  let previousClip = resolveUniforms.previousViewProjection * vec4f(worldPosition, 1.0);
  if (taaVectorInvalid(previousClip) || previousClip.w <= TAA_REPROJECTION_EPSILON) {
    return TaaReprojection(currentUv, 0.0, 0.0);
  }
  let previousNdc = previousClip.xyz / previousClip.w;
  let historyUv = vec2f((previousNdc.x + 1.0) * 0.5, (1.0 - previousNdc.y) * 0.5);
  if (previousNdc.z < 0.0 || previousNdc.z > 1.0 || !taaUvInBounds(historyUv)) {
    return TaaReprojection(historyUv, 0.0, 0.0);
  }
  return TaaReprojection(historyUv, 1.0, 0.0);
}

fn taaDecodeNormal(encoded: vec3f) -> vec3f {
  let decoded = encoded * 2.0 - vec3f(1.0);
  let lengthSquared = dot(decoded, decoded);
  if (lengthSquared <= TAA_REPROJECTION_EPSILON) {
    return vec3f(0.0, 0.0, 1.0);
  }
  return decoded * inverseSqrt(lengthSquared);
}

fn taaNeighborhoodBounds(neighborhood: array<vec3f, 9>) -> TaaNeighborhoodBounds {
  var minimum = neighborhood[0];
  var maximum = neighborhood[0];
  for (var index: u32 = 1u; index < 9u; index += 1u) {
    minimum = min(minimum, neighborhood[index]);
    maximum = max(maximum, neighborhood[index]);
  }
  return TaaNeighborhoodBounds(minimum, maximum);
}

fn taaResolve(
  currentColor: vec4f,
  currentDepth: f32,
  currentNormal: vec3f,
  historyColor: vec4f,
  historyDepth: f32,
  historyNormal: vec3f,
  historyValid: bool,
  neighborhood: array<vec3f, 9>,
  responsiveMask: f32,
) -> vec4f {
  let bounds = taaNeighborhoodBounds(neighborhood);
  let clampedHistory = clamp(historyColor.rgb, bounds.minimum, bounds.maximum);
  let depthDifference = abs(currentDepth - historyDepth);
  let depthTolerance = max(
    resolveUniforms.options0.y,
    resolveUniforms.options0.z * max(currentDepth, historyDepth),
  );
  let normalSimilarity = clamp(dot(currentNormal, historyNormal), -1.0, 1.0);
  var rejected = !historyValid;
  if (
    depthDifference > depthTolerance ||
    normalSimilarity < resolveUniforms.options0.w
  ) {
    rejected = true;
  }
  let acceptedHistoryWeight =
    resolveUniforms.options0.x * (1.0 - responsiveMask * resolveUniforms.options1.x);
  let historyWeight = select(acceptedHistoryWeight, 0.0, rejected);
  return vec4f(
    mix(currentColor.rgb, clampedHistory, vec3f(historyWeight)),
    currentColor.a,
  );
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
  let dimensions = max(vec2i(resolveUniforms.viewportHistoryResponsive.xy), vec2i(1));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let currentUv = input.position.xy / resolveUniforms.viewportHistoryResponsive.xy;
  let currentColor = textureLoad(currentColorTexture, pixel, 0);
  let currentDepth = textureLoad(currentDepthTexture, pixel, 0);
  let currentNormal = taaDecodeNormal(textureLoad(currentNormalTexture, pixel, 0).rgb);

  var neighborhood: array<vec3f, 9>;
  var neighborhoodIndex = 0u;
  for (var y: i32 = -1; y <= 1; y += 1) {
    for (var x: i32 = -1; x <= 1; x += 1) {
      let samplePixel = clamp(pixel + vec2i(x, y), vec2i(0), dimensions - vec2i(1));
      neighborhood[neighborhoodIndex] = textureLoad(currentColorTexture, samplePixel, 0).rgb;
      neighborhoodIndex += 1u;
    }
  }

  let reprojection = taaReproject(currentUv, currentDepth);
  var historyValid =
    resolveUniforms.viewportHistoryResponsive.z > 0.5 && reprojection.valid > 0.5;
  var historyColor = currentColor;
  var historyDepth = currentDepth;
  var historyNormal = currentNormal;
  if (historyValid) {
    let historyPixel = clamp(
      vec2i(reprojection.historyUv * vec2f(dimensions)),
      vec2i(0),
      dimensions - vec2i(1),
    );
    historyColor = textureSampleLevel(
      historyColorTexture,
      historySampler,
      reprojection.historyUv,
      0.0,
    );
    historyDepth = textureLoad(historyDepthTexture, historyPixel, 0);
    historyNormal = taaDecodeNormal(
      textureSampleLevel(
        historyNormalTexture,
        historySampler,
        reprojection.historyUv,
        0.0,
      ).rgb,
    );
  }
  return taaResolve(
    currentColor,
    currentDepth,
    currentNormal,
    historyColor,
    historyDepth,
    historyNormal,
    historyValid,
    neighborhood,
    resolveUniforms.viewportHistoryResponsive.w,
  );
}
`;
