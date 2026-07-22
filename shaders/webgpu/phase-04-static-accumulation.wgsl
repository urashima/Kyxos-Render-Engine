struct StaticAccumulationUniforms {
  weightsAndState: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
}

@group(0) @binding(0) var<uniform> accumulationUniforms: StaticAccumulationUniforms;
@group(0) @binding(1) var currentColorTexture: texture_2d<f32>;
@group(0) @binding(2) var historyColorTexture: texture_2d<f32>;

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
  let dimensions = max(vec2i(textureDimensions(currentColorTexture)), vec2i(1));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let currentColor = textureLoad(currentColorTexture, pixel, 0);
  let historyColor = textureLoad(historyColorTexture, pixel, 0);
  let historyWeight = accumulationUniforms.weightsAndState.x;
  let currentWeight = accumulationUniforms.weightsAndState.y;
  return historyColor * historyWeight + currentColor * currentWeight;
}
