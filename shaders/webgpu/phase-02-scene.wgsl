struct ObjectUniforms {
  modelViewProjection: mat4x4f,
  normalMatrix: mat4x4f,
  baseColor: vec4f,
}

@group(0) @binding(0) var<uniform> object: ObjectUniforms;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldNormal: vec3f,
  @location(1) baseColor: vec4f,
}

@vertex
fn vertexMain(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
) -> VertexOutput {
  var output: VertexOutput;
  output.position = object.modelViewProjection * vec4f(position, 1.0);
  output.worldNormal = (object.normalMatrix * vec4f(normal, 0.0)).xyz;
  output.baseColor = object.baseColor;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let lightDirection = normalize(vec3f(0.35, 0.8, 0.48));
  let diffuse = max(dot(normalize(input.worldNormal), lightDirection), 0.0);
  let shadedColor = input.baseColor.rgb * (0.22 + diffuse * 0.78);
  return vec4f(shadedColor, input.baseColor.a);
}
