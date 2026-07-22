export const PHASE_04_TAA_PRESENT_WGSL = `struct DynamicTaaPresentUniforms {
  output: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
}

@group(0) @binding(0) var<uniform> presentUniforms: DynamicTaaPresentUniforms;
@group(0) @binding(1) var resolvedColorTexture: texture_2d<f32>;

fn presentNeutralToneMap(inputColor: vec3f) -> vec3f {
  var color = max(inputColor, vec3f(0.0));
  let minimum = min(color.r, min(color.g, color.b));
  let offset = select(0.04, minimum - 6.25 * minimum * minimum, minimum < 0.08);
  color -= vec3f(offset);
  let peak = max(color.r, max(color.g, color.b));
  let startCompression = 0.76;
  if (peak < startCompression) {
    return color;
  }
  let compressionDistance = 1.0 - startCompression;
  let newPeak = 1.0 -
    compressionDistance * compressionDistance /
    (peak + compressionDistance - startCompression);
  color *= newPeak / peak;
  let desaturation = 1.0 - 1.0 / (0.15 * (peak - newPeak) + 1.0);
  return mix(color, vec3f(newPeak), vec3f(desaturation));
}

fn presentLinearChannelToSrgb(channel: f32) -> f32 {
  if (channel <= 0.0031308) {
    return channel * 12.92;
  }
  return 1.055 * pow(channel, 1.0 / 2.4) - 0.055;
}

fn presentLinearToSrgb(color: vec3f) -> vec3f {
  return vec3f(
    presentLinearChannelToSrgb(color.r),
    presentLinearChannelToSrgb(color.g),
    presentLinearChannelToSrgb(color.b),
  );
}

fn presentApplyOutputTransform(linearHdr: vec3f) -> vec3f {
  let exposed = max(linearHdr, vec3f(0.0)) * presentUniforms.output.x;
  let toneMapped = select(
    clamp(exposed, vec3f(0.0), vec3f(1.0)),
    presentNeutralToneMap(exposed),
    presentUniforms.output.y >= 0.5,
  );
  return presentLinearToSrgb(clamp(toneMapped, vec3f(0.0), vec3f(1.0)));
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
  let dimensions = max(vec2i(textureDimensions(resolvedColorTexture)), vec2i(1));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let resolved = textureLoad(resolvedColorTexture, pixel, 0);
  return vec4f(presentApplyOutputTransform(resolved.rgb), resolved.a);
}
`;
