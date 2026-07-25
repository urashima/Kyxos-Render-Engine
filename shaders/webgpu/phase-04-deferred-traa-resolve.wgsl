const TRAA_EPSILON: f32 = 0.000001;
const TRAA_REPROJECTION_TOLERANCE_PIXELS: f32 = 2.0;

struct DeferredTraaResolveUniforms {
  currentRasterInverseViewProjection: mat4x4f,
  previousRasterViewProjection: mat4x4f,
  viewportHistoryResponsive: vec4f,
  jitterOffsets: vec4f,
  options0: vec4f,
  options1: vec4f,
  options2: vec4f,
}

struct TraaDepthNeighborhood {
  closestDepth: f32,
  farthestDepth: f32,
  closestPixel: vec2i,
}

struct TraaColorNeighborhood {
  minimum: vec3f,
  maximum: vec3f,
  mean: vec3f,
  deviation: vec3f,
}

struct TraaReprojection {
  historyUv: vec2f,
  motionPixels: vec2f,
  valid: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
}

struct FragmentOutput {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
}

@group(0) @binding(0) var<uniform> uniforms: DeferredTraaResolveUniforms;
@group(0) @binding(1) var currentColorTexture: texture_2d<f32>;
@group(0) @binding(2) var currentDepthTexture: texture_depth_2d;
@group(0) @binding(3) var currentVelocityTexture: texture_2d<f32>;
@group(0) @binding(4) var historyColorTexture: texture_2d<f32>;
@group(0) @binding(5) var historyDepthTexture: texture_depth_2d;
@group(0) @binding(6) var historySampler: sampler;

fn traaUvInBounds(uv: vec2f) -> bool {
  return all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
}

fn traaInvalid(value: f32) -> bool {
  return (bitcast<u32>(value) & 0x7f800000u) == 0x7f800000u;
}

fn traaInvalid4(value: vec4f) -> bool {
  return traaInvalid(value.x) || traaInvalid(value.y) || traaInvalid(value.z) || traaInvalid(value.w);
}

fn traaUvToNdc(uv: vec2f, depth: f32) -> vec3f {
  return vec3f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth);
}

fn traaNdcToUv(ndc: vec2f) -> vec2f {
  return vec2f((ndc.x + 1.0) * 0.5, (1.0 - ndc.y) * 0.5);
}

fn traaDepthNeighborhood(pixel: vec2i, dimensions: vec2i) -> TraaDepthNeighborhood {
  var closestDepth = 2.0;
  var farthestDepth = -1.0;
  var closestPixel = pixel;
  for (var y: i32 = -1; y <= 1; y += 1) {
    for (var x: i32 = -1; x <= 1; x += 1) {
      let samplePixel = clamp(pixel + vec2i(x, y), vec2i(0), dimensions - vec2i(1));
      let depth = textureLoad(currentDepthTexture, samplePixel, 0);
      if (depth < closestDepth) {
        closestDepth = depth;
        closestPixel = samplePixel;
      }
      farthestDepth = max(farthestDepth, depth);
    }
  }
  return TraaDepthNeighborhood(closestDepth, farthestDepth, closestPixel);
}

fn traaColorNeighborhood(pixel: vec2i, dimensions: vec2i) -> TraaColorNeighborhood {
  var minimum = vec3f(1e20);
  var maximum = vec3f(-1e20);
  var sum = vec3f(0.0);
  var sumSquared = vec3f(0.0);
  for (var y: i32 = -1; y <= 1; y += 1) {
    for (var x: i32 = -1; x <= 1; x += 1) {
      let samplePixel = clamp(pixel + vec2i(x, y), vec2i(0), dimensions - vec2i(1));
      let color = textureLoad(currentColorTexture, samplePixel, 0).rgb;
      minimum = min(minimum, color);
      maximum = max(maximum, color);
      sum += color;
      sumSquared += color * color;
    }
  }
  let mean = sum / 9.0;
  let variance = max(sumSquared / 9.0 - mean * mean, vec3f(0.0));
  return TraaColorNeighborhood(minimum, maximum, mean, sqrt(variance));
}

fn traaClipAabb(history: vec3f, current: vec3f, minimum: vec3f, maximum: vec3f) -> vec3f {
  let center = (minimum + maximum) * 0.5;
  let extent = max((maximum - minimum) * 0.5, vec3f(TRAA_EPSILON));
  let direction = history - current;
  let relative = current - center;
  var t = 1.0;
  for (var channel: u32 = 0u; channel < 3u; channel += 1u) {
    let d = direction[channel];
    if (abs(d) > TRAA_EPSILON) {
      let lower = (-extent[channel] - relative[channel]) / d;
      let upper = (extent[channel] - relative[channel]) / d;
      let exit = max(lower, upper);
      if (exit >= 0.0) {
        t = min(t, exit);
      }
    }
  }
  return clamp(current + direction * clamp(t, 0.0, 1.0), minimum, maximum);
}

fn traaVelocityReproject(currentUv: vec2f, velocityNdc: vec2f) -> TraaReprojection {
  let velocityUv = vec2f(-velocityNdc.x, velocityNdc.y) * 0.5;
  let jitterDeltaNdc = uniforms.jitterOffsets.xy - uniforms.jitterOffsets.zw;
  let jitterDeltaUv = vec2f(jitterDeltaNdc.x, -jitterDeltaNdc.y) * 0.5;
  let historyUv = currentUv + velocityUv + jitterDeltaUv;
  let motionPixels = (currentUv - historyUv) * uniforms.viewportHistoryResponsive.xy;
  return TraaReprojection(historyUv, motionPixels, select(0.0, 1.0, traaUvInBounds(historyUv)));
}

fn traaHistoryDepthMatchesCurrent(
  currentUv: vec2f,
  currentDepth: f32,
  historyUv: vec2f,
  historyDepth: f32,
) -> bool {
  if (currentDepth >= 1.0 || historyDepth >= 1.0) {
    return false;
  }
  let currentWorldH = uniforms.currentRasterInverseViewProjection *
    vec4f(traaUvToNdc(currentUv, currentDepth), 1.0);
  if (traaInvalid4(currentWorldH) || abs(currentWorldH.w) <= TRAA_EPSILON) {
    return false;
  }
  let previousClip = uniforms.previousRasterViewProjection *
    vec4f(currentWorldH.xyz / currentWorldH.w, 1.0);
  if (traaInvalid4(previousClip) || previousClip.w <= TRAA_EPSILON) {
    return false;
  }
  let previousNdc = previousClip.xyz / previousClip.w;
  let expectedHistoryUv = traaNdcToUv(previousNdc.xy);
  let reprojectionDeltaPixels =
    length((expectedHistoryUv - historyUv) * uniforms.viewportHistoryResponsive.xy);
  if (
    previousNdc.z < 0.0 ||
    previousNdc.z > 1.0 ||
    !traaUvInBounds(expectedHistoryUv) ||
    reprojectionDeltaPixels > TRAA_REPROJECTION_TOLERANCE_PIXELS
  ) {
    return false;
  }
  let tolerance = max(
    uniforms.options0.y,
    uniforms.options0.z * max(abs(previousNdc.z), abs(historyDepth)),
  );
  return abs(previousNdc.z - historyDepth) <= tolerance;
}

fn traaLuminance(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> FragmentOutput {
  let dimensions = max(vec2i(uniforms.viewportHistoryResponsive.xy), vec2i(1));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let currentUv = input.position.xy / uniforms.viewportHistoryResponsive.xy;
  let currentColor = textureLoad(currentColorTexture, pixel, 0);
  let currentDepth = textureLoad(currentDepthTexture, pixel, 0);
  var velocityPixel = pixel;
  if (uniforms.options1.x > 0.0) {
    let depthNeighborhood = traaDepthNeighborhood(pixel, dimensions);
    if (depthNeighborhood.farthestDepth - depthNeighborhood.closestDepth > uniforms.options1.x) {
      velocityPixel = depthNeighborhood.closestPixel;
    }
  }
  let velocityNdc = textureLoad(currentVelocityTexture, velocityPixel, 0).xy;
  let reprojection = traaVelocityReproject(currentUv, velocityNdc);

  var historyValid = uniforms.viewportHistoryResponsive.z > 0.5 && reprojection.valid > 0.5;
  var historyColor = currentColor;
  if (historyValid) {
    let historyPixel = clamp(
      vec2i(reprojection.historyUv * vec2f(dimensions)),
      vec2i(0),
      dimensions - vec2i(1),
    );
    historyColor = textureSampleLevel(historyColorTexture, historySampler, reprojection.historyUv, 0.0);
    let historyDepth = textureLoad(historyDepthTexture, historyPixel, 0);
    historyValid = traaHistoryDepthMatchesCurrent(
      currentUv,
      currentDepth,
      reprojection.historyUv,
      historyDepth,
    );
  }

  let neighborhood = traaColorNeighborhood(pixel, dimensions);
  var clippedHistory = clamp(historyColor.rgb, neighborhood.minimum, neighborhood.maximum);
  if (uniforms.options1.z > 0.0) {
    let clipMinimum = max(
      neighborhood.minimum,
      neighborhood.mean - neighborhood.deviation * uniforms.options1.z,
    );
    let clipMaximum = min(
      neighborhood.maximum,
      neighborhood.mean + neighborhood.deviation * uniforms.options1.z,
    );
    clippedHistory = traaClipAabb(historyColor.rgb, currentColor.rgb, clipMinimum, clipMaximum);
  }

  let responsiveMask = uniforms.viewportHistoryResponsive.w;
  var historyWeight = uniforms.options0.x * (1.0 - responsiveMask * uniforms.options2.x);
  let motionLength = length(reprojection.motionPixels);
  historyWeight *= 1.0 - clamp(motionLength / max(uniforms.options1.y, TRAA_EPSILON), 0.0, 1.0);
  if (uniforms.options2.y > 0.0) {
    let fractionalMotion = length(fract(abs(reprojection.motionPixels)) - vec2f(0.5)) * 1.41421356;
    historyWeight *= 1.0 - clamp(fractionalMotion * uniforms.options2.y, 0.0, 1.0);
  }
  if (uniforms.options1.w > 0.0) {
    let luminanceDelta = abs(traaLuminance(currentColor.rgb) - traaLuminance(clippedHistory));
    historyWeight *= mix(1.0, 1.0 / (1.0 + luminanceDelta), uniforms.options1.w);
  }
  historyWeight = min(historyWeight, 1.0 - uniforms.options0.w);
  historyWeight = select(0.0, clamp(historyWeight, 0.0, 1.0), historyValid);

  var output: FragmentOutput;
  output.color = vec4f(mix(currentColor.rgb, clippedHistory, vec3f(historyWeight)), currentColor.a);
  output.depth = currentDepth;
  return output;
}
