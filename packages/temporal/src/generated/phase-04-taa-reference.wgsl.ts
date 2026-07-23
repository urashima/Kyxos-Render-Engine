// Generated mirror of shaders/webgpu/phase-04-taa-reference.wgsl. Keep validation exact.
export const PHASE_04_TAA_REFERENCE_WGSL = `const TAA_BASE_HISTORY_WEIGHT: f32 = 0.9;
const TAA_DEPTH_ABSOLUTE_THRESHOLD: f32 = 0.001;
const TAA_DEPTH_RELATIVE_THRESHOLD: f32 = 0.01;
const TAA_NORMAL_REJECTION_COSINE: f32 = 0.85;
const TAA_RESPONSIVE_HISTORY_REDUCTION: f32 = 0.8;

struct TaaNeighborhoodBounds {
  minimum: vec3f,
  maximum: vec3f,
}

struct TaaResolveResult {
  outputColor: vec4f,
  clampedHistoryAndWeight: vec4f,
  minimumAndDepthDifference: vec4f,
  maximumAndNormalSimilarity: vec4f,
  diagnostics: vec4f,
}

struct TaaReferenceOutput {
  values: array<vec4f, 15>,
}

@group(0) @binding(0) var<storage, read_write> referenceOutput: TaaReferenceOutput;

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
) -> TaaResolveResult {
  let bounds = taaNeighborhoodBounds(neighborhood);
  let clampedHistory = clamp(historyColor.rgb, bounds.minimum, bounds.maximum);
  let depthDifference = abs(currentDepth - historyDepth);
  let depthTolerance = max(
    TAA_DEPTH_ABSOLUTE_THRESHOLD,
    TAA_DEPTH_RELATIVE_THRESHOLD * max(currentDepth, historyDepth),
  );
  let normalSimilarity = clamp(
    dot(normalize(currentNormal), normalize(historyNormal)),
    -1.0,
    1.0,
  );
  var rejectionMask = 0.0;
  if (
    !historyValid ||
    depthDifference > depthTolerance ||
    normalSimilarity < TAA_NORMAL_REJECTION_COSINE
  ) {
    rejectionMask = 1.0;
  }
  let acceptedHistoryWeight =
    TAA_BASE_HISTORY_WEIGHT * (1.0 - responsiveMask * TAA_RESPONSIVE_HISTORY_REDUCTION);
  let historyWeight = select(acceptedHistoryWeight, 0.0, rejectionMask > 0.5);
  let outputColor = vec4f(
    mix(currentColor.rgb, clampedHistory, vec3f(historyWeight)),
    currentColor.a,
  );
  return TaaResolveResult(
    outputColor,
    vec4f(clampedHistory, historyWeight),
    vec4f(bounds.minimum, depthDifference),
    vec4f(bounds.maximum, normalSimilarity),
    vec4f(depthTolerance, rejectionMask, responsiveMask, TAA_BASE_HISTORY_WEIGHT),
  );
}

fn taaReferenceNeighborhood() -> array<vec3f, 9> {
  return array(
    vec3f(0.1, 0.4, 0.2),
    vec3f(0.2, 0.3, 0.4),
    vec3f(0.15, 0.25, 0.35),
    vec3f(0.3, 0.2, 0.5),
    vec3f(0.25, 0.35, 0.45),
    vec3f(0.4, 0.1, 0.3),
    vec3f(0.2, 0.5, 0.1),
    vec3f(0.35, 0.45, 0.25),
    vec3f(0.05, 0.15, 0.55),
  );
}

fn taaReferenceResult(historyDepth: f32, historyNormal: vec3f) -> TaaResolveResult {
  return taaResolve(
    vec4f(0.25, 0.35, 0.45, 0.8),
    0.4,
    vec3f(0.0, 0.0, 1.0),
    vec4f(0.9, 0.05, 0.6, 0.2),
    historyDepth,
    historyNormal,
    true,
    taaReferenceNeighborhood(),
    0.5,
  );
}

fn writeReferenceResult(offset: u32, result: TaaResolveResult) {
  referenceOutput.values[offset] = result.outputColor;
  referenceOutput.values[offset + 1u] = result.clampedHistoryAndWeight;
  referenceOutput.values[offset + 2u] = result.minimumAndDepthDifference;
  referenceOutput.values[offset + 3u] = result.maximumAndNormalSimilarity;
  referenceOutput.values[offset + 4u] = result.diagnostics;
}

@compute @workgroup_size(1)
fn computeMain() {
  writeReferenceResult(0u, taaReferenceResult(0.403, vec3f(0.2, 0.0, 0.98)));
  writeReferenceResult(5u, taaReferenceResult(0.45, vec3f(0.2, 0.0, 0.98)));
  writeReferenceResult(10u, taaReferenceResult(0.403, vec3f(0.0, 1.0, 0.0)));
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
  return taaReferenceResult(0.403, vec3f(0.2, 0.0, 0.98)).outputColor;
}
`;
