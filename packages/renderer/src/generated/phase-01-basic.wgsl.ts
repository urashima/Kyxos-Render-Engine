// Generated mirror of shaders/webgpu/phase-01-basic.wgsl. Keep validation exact.
export const PHASE_01_BASIC_WGSL = `struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) color: vec3f,
}

@vertex
fn vertexMain(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec3f,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4f(position.x, position.y, position.z * 0.5, 1.0);
  output.normal = normal;
  output.color = color;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let lightDirection = normalize(vec3f(-0.35, 0.72, 0.6));
  let diffuse = max(dot(normalize(input.normal), lightDirection), 0.0);
  let shadedColor = input.color * (0.24 + diffuse * 0.76);
  return vec4f(shadedColor, 1.0);
}
`;
