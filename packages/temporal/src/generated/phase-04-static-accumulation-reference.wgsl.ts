export const PHASE_04_STATIC_ACCUMULATION_REFERENCE_WGSL = `struct StaticAccumulationResult {
  outputColor: vec4f,
  diagnostics: vec4f,
}

struct StaticAccumulationReferenceOutput {
  values: array<vec4f, 4>,
}

@group(0) @binding(0) var<storage, read_write> referenceOutput: StaticAccumulationReferenceOutput;

fn staticAccumulate(
  currentColor: vec4f,
  accumulatedColor: vec4f,
  accumulatedSampleCount: u32,
  historyValid: bool,
) -> StaticAccumulationResult {
  let acceptedSampleCount = select(0u, accumulatedSampleCount, historyValid && accumulatedSampleCount > 0u);
  let sampleCount = acceptedSampleCount + 1u;
  let currentWeight = 1.0 / f32(sampleCount);
  let historyWeight = f32(acceptedSampleCount) / f32(sampleCount);
  let outputColor = accumulatedColor * historyWeight + currentColor * currentWeight;
  var maximumChannelDelta = -1.0;
  if (acceptedSampleCount > 0u) {
    maximumChannelDelta = max(
      abs(currentColor.r - accumulatedColor.r),
      max(
        abs(currentColor.g - accumulatedColor.g),
        abs(currentColor.b - accumulatedColor.b),
      ),
    );
  }
  return StaticAccumulationResult(
    outputColor,
    vec4f(f32(sampleCount), historyWeight, currentWeight, maximumChannelDelta),
  );
}

@compute @workgroup_size(1)
fn computeMain() {
  let firstSample = staticAccumulate(
    vec4f(0.25, 0.5, 1.0, 0.75),
    vec4f(9.0, 9.0, 9.0, 0.1),
    0u,
    false,
  );
  let runningMean = staticAccumulate(
    vec4f(1.5, 0.5, 1.0, 1.0),
    vec4f(0.5, 1.0, 2.0, 0.5),
    3u,
    true,
  );
  referenceOutput.values[0] = firstSample.outputColor;
  referenceOutput.values[1] = firstSample.diagnostics;
  referenceOutput.values[2] = runningMean.outputColor;
  referenceOutput.values[3] = runningMean.diagnostics;
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
  return staticAccumulate(
    vec4f(0.25, 0.5, 1.0, 0.75),
    vec4f(9.0, 9.0, 9.0, 0.1),
    0u,
    false,
  ).outputColor;
}
`;
