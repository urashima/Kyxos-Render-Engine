export const PHASE_04_TAA_RESOLVE_WGSL = `const TAA_EPSILON: f32 = 0.000001;

struct DynamicTaaResolveUniforms {
  currentInverseViewProjection: mat4x4f,
  previousViewProjection: mat4x4f,
  currentViewProjection: mat4x4f,
  previousInverseViewProjection: mat4x4f,
  viewportHistoryResponsive: vec4f,
  jitterOffsets: vec4f,
  options0: vec4f,
  options1: vec4f,
  options2: vec4f,
}

struct TaaDepthNeighborhood {
  closestDepth: f32,
  farthestDepth: f32,
  closestPixel: vec2i,
}

struct TaaColorNeighborhood {
  minimum: vec3f,
  maximum: vec3f,
  mean: vec3f,
  deviation: vec3f,
}

struct TaaReprojection {
  historyUv: vec2f,
  velocityPixels: vec2f,
  valid: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
}

@group(0) @binding(0) var<uniform> uniforms: DynamicTaaResolveUniforms;
@group(0) @binding(1) var currentColorTexture: texture_2d<f32>;
@group(0) @binding(2) var currentDepthTexture: texture_depth_2d;
@group(0) @binding(3) var currentNormalTexture: texture_2d<f32>;
@group(0) @binding(4) var currentVelocityTexture: texture_2d<f32>;
@group(0) @binding(5) var historyColorTexture: texture_2d<f32>;
@group(0) @binding(6) var historyDepthTexture: texture_depth_2d;
@group(0) @binding(7) var historyNormalTexture: texture_2d<f32>;
@group(0) @binding(8) var historySampler: sampler;

fn taaUvInBounds(uv: vec2f) -> bool {
  return all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
}

fn taaInvalid(value: f32) -> bool {
  return (bitcast<u32>(value) & 0x7f800000u) == 0x7f800000u;
}

fn taaInvalid4(value: vec4f) -> bool {
  return taaInvalid(value.x) || taaInvalid(value.y) || taaInvalid(value.z) || taaInvalid(value.w);
}

fn taaDecodeNormal(encoded: vec3f) -> vec3f {
  let decoded = encoded * 2.0 - vec3f(1.0);
  let lengthSquared = dot(decoded, decoded);
  if (lengthSquared <= TAA_EPSILON) {
    return vec3f(0.0, 0.0, 1.0);
  }
  return decoded * inverseSqrt(lengthSquared);
}

fn taaUvToNdc(uv: vec2f, depth: f32) -> vec3f {
  return vec3f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth);
}

fn taaNdcToUv(ndc: vec2f) -> vec2f {
  return vec2f((ndc.x + 1.0) * 0.5, (1.0 - ndc.y) * 0.5);
}

fn taaDepthNeighborhood(pixel: vec2i, dimensions: vec2i) -> TaaDepthNeighborhood {
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
  return TaaDepthNeighborhood(closestDepth, farthestDepth, closestPixel);
}

fn taaColorNeighborhood(pixel: vec2i, dimensions: vec2i) -> TaaColorNeighborhood {
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
  return TaaColorNeighborhood(minimum, maximum, mean, sqrt(variance));
}

fn taaClipAabb(history: vec3f, current: vec3f, minimum: vec3f, maximum: vec3f) -> vec3f {
  let center = (minimum + maximum) * 0.5;
  let extent = max((maximum - minimum) * 0.5, vec3f(TAA_EPSILON));
  let direction = history - current;
  let relative = current - center;
  var t = 1.0;
  for (var channel: u32 = 0u; channel < 3u; channel += 1u) {
    let d = direction[channel];
    if (abs(d) > TAA_EPSILON) {
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

fn taaMatrixReproject(currentUv: vec2f, currentDepth: f32) -> TaaReprojection {
  if (currentDepth >= 1.0) {
    return TaaReprojection(currentUv, vec2f(0.0), 0.0);
  }
  let worldH = uniforms.currentInverseViewProjection * vec4f(taaUvToNdc(currentUv, currentDepth), 1.0);
  if (taaInvalid4(worldH) || abs(worldH.w) <= TAA_EPSILON) {
    return TaaReprojection(currentUv, vec2f(0.0), 0.0);
  }
  let previousClip = uniforms.previousViewProjection * vec4f(worldH.xyz / worldH.w, 1.0);
  if (taaInvalid4(previousClip) || previousClip.w <= TAA_EPSILON) {
    return TaaReprojection(currentUv, vec2f(0.0), 0.0);
  }
  let previousNdc = previousClip.xyz / previousClip.w;
  let historyUv = taaNdcToUv(previousNdc.xy);
  let velocityPixels = (currentUv - historyUv) * uniforms.viewportHistoryResponsive.xy;
  let valid = select(0.0, 1.0, previousNdc.z >= 0.0 && previousNdc.z <= 1.0 && taaUvInBounds(historyUv));
  return TaaReprojection(historyUv, velocityPixels, valid);
}

fn taaVelocityReproject(currentUv: vec2f, velocityNdc: vec2f) -> TaaReprojection {
  let velocityUv = vec2f(-velocityNdc.x, velocityNdc.y) * 0.5;
  let jitterDeltaNdc = uniforms.jitterOffsets.xy - uniforms.jitterOffsets.zw;
  let jitterDeltaUv = vec2f(jitterDeltaNdc.x, -jitterDeltaNdc.y) * 0.5;
  let historyUv = currentUv + velocityUv + jitterDeltaUv;
  let velocityPixels = (currentUv - historyUv) * uniforms.viewportHistoryResponsive.xy;
  return TaaReprojection(historyUv, velocityPixels, select(0.0, 1.0, taaUvInBounds(historyUv)));
}

fn taaHistoryDepthMatchesCurrent(historyUv: vec2f, currentDepth: f32, historyDepth: f32) -> bool {
  if (historyDepth >= 1.0) {
    return false;
  }
  let previousWorldH = uniforms.previousInverseViewProjection * vec4f(taaUvToNdc(historyUv, historyDepth), 1.0);
  if (taaInvalid4(previousWorldH) || abs(previousWorldH.w) <= TAA_EPSILON) {
    return false;
  }
  let currentClip = uniforms.currentViewProjection * vec4f(previousWorldH.xyz / previousWorldH.w, 1.0);
  if (taaInvalid4(currentClip) || currentClip.w <= TAA_EPSILON) {
    return false;
  }
  let reprojectedDepth = currentClip.z / currentClip.w;
  let tolerance = max(uniforms.options0.y, uniforms.options0.z * max(currentDepth, reprojectedDepth));
  return abs(currentDepth - reprojectedDepth) <= tolerance;
}

fn taaLuminance(color: vec3f) -> f32 {
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
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = max(vec2i(uniforms.viewportHistoryResponsive.xy), vec2i(1));
  let pixel = clamp(vec2i(input.position.xy), vec2i(0), dimensions - vec2i(1));
  let currentUv = input.position.xy / uniforms.viewportHistoryResponsive.xy;
  let currentColor = textureLoad(currentColorTexture, pixel, 0);
  let currentDepth = textureLoad(currentDepthTexture, pixel, 0);
  let currentNormal = taaDecodeNormal(textureLoad(currentNormalTexture, pixel, 0).rgb);
  var velocityPixel = pixel;
  if (uniforms.options1.y > 0.0) {
    let depthNeighborhood = taaDepthNeighborhood(pixel, dimensions);
    if (depthNeighborhood.farthestDepth - depthNeighborhood.closestDepth > uniforms.options1.y) {
      velocityPixel = depthNeighborhood.closestPixel;
    }
  }
  let velocityNdc = textureLoad(currentVelocityTexture, velocityPixel, 0).xy;
  let explicitVelocity = dot(velocityNdc, velocityNdc) > TAA_EPSILON;
  var reprojection = taaMatrixReproject(currentUv, currentDepth);
  if (explicitVelocity) {
    reprojection = taaVelocityReproject(currentUv, velocityNdc);
  }

  var historyValid = uniforms.viewportHistoryResponsive.z > 0.5 && reprojection.valid > 0.5;
  var historyColor = currentColor;
  var historyDepth = currentDepth;
  var historyNormal = currentNormal;
  if (historyValid) {
    let historyPixel = clamp(vec2i(reprojection.historyUv * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
    historyColor = textureSampleLevel(historyColorTexture, historySampler, reprojection.historyUv, 0.0);
    historyDepth = textureLoad(historyDepthTexture, historyPixel, 0);
    historyNormal = taaDecodeNormal(textureSampleLevel(historyNormalTexture, historySampler, reprojection.historyUv, 0.0).rgb);
    let depthDifference = abs(currentDepth - historyDepth);
    let depthTolerance = max(uniforms.options0.y, uniforms.options0.z * max(currentDepth, historyDepth));
    let normalSimilarity = dot(currentNormal, historyNormal);
    let disoccluded = explicitVelocity && !taaHistoryDepthMatchesCurrent(reprojection.historyUv, currentDepth, historyDepth);
    if (depthDifference > depthTolerance || normalSimilarity < uniforms.options0.w || disoccluded) {
      historyValid = false;
    }
  }

  let neighborhood = taaColorNeighborhood(pixel, dimensions);
  var clippedHistory = clamp(historyColor.rgb, neighborhood.minimum, neighborhood.maximum);
  if (uniforms.options2.x > 0.0) {
    let clipMinimum = max(
      neighborhood.minimum,
      neighborhood.mean - neighborhood.deviation * uniforms.options2.x,
    );
    let clipMaximum = min(
      neighborhood.maximum,
      neighborhood.mean + neighborhood.deviation * uniforms.options2.x,
    );
    clippedHistory = taaClipAabb(historyColor.rgb, currentColor.rgb, clipMinimum, clipMaximum);
  }
  let responsiveMask = uniforms.viewportHistoryResponsive.w;
  var historyWeight = uniforms.options0.x * (1.0 - responsiveMask * uniforms.options1.x);
  let advancedWeightingEnabled =
    uniforms.options1.y > 0.0 ||
    uniforms.options1.w > 0.0 ||
    uniforms.options2.x > 0.0 ||
    uniforms.options2.y > 0.0 ||
    uniforms.options2.z > 0.0;
  let velocityLength = length(reprojection.velocityPixels);
  if (advancedWeightingEnabled) {
    historyWeight *=
      1.0 - clamp(velocityLength / max(uniforms.options1.z, TAA_EPSILON), 0.0, 1.0);
  }
  if (uniforms.options2.y > 0.0) {
    let fractionalMotion = length(fract(abs(reprojection.velocityPixels)) - vec2f(0.5)) * 1.41421356;
    historyWeight *= 1.0 - clamp(fractionalMotion * uniforms.options2.y, 0.0, 1.0);
  }
  if (uniforms.options2.z > 0.0) {
    let luminanceDelta = abs(taaLuminance(currentColor.rgb) - taaLuminance(clippedHistory));
    historyWeight *= mix(1.0, 1.0 / (1.0 + luminanceDelta), uniforms.options2.z);
  }
  historyWeight = min(historyWeight, 1.0 - uniforms.options1.w);
  historyWeight = select(0.0, clamp(historyWeight, 0.0, 1.0), historyValid);
  return vec4f(mix(currentColor.rgb, clippedHistory, vec3f(historyWeight)), currentColor.a);
}
`;
