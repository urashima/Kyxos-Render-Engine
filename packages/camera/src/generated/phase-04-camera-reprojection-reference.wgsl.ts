// Generated mirror of shaders/webgpu/phase-04-camera-reprojection-reference.wgsl. Keep validation exact.
export const PHASE_04_CAMERA_REPROJECTION_REFERENCE_WGSL = `const CAMERA_REPROJECTION_EPSILON: f32 = 0.000001;
const CAMERA_REPROJECTION_VALID: f32 = 0.0;
const CAMERA_REPROJECTION_CURRENT_UV_INVALID: f32 = 1.0;
const CAMERA_REPROJECTION_BACKGROUND_DEPTH: f32 = 2.0;
const CAMERA_REPROJECTION_CURRENT_WORLD_INVALID: f32 = 3.0;
const CAMERA_REPROJECTION_PREVIOUS_BEHIND: f32 = 4.0;
const CAMERA_REPROJECTION_PREVIOUS_DEPTH_INVALID: f32 = 5.0;
const CAMERA_REPROJECTION_PREVIOUS_UV_INVALID: f32 = 6.0;
const CAMERA_REPROJECTION_PREVIOUS_PROJECTION_INVALID: f32 = 7.0;

struct CameraReprojectionInput {
  currentInverseViewProjection: mat4x4f,
  previousViewProjection: mat4x4f,
  currentUvAndDepth: vec4f,
}

struct CameraReprojectionResult {
  historyAndMotionUv: vec4f,
  worldAndCurrentDepth: vec4f,
  previousNdcAndClipW: vec4f,
  diagnostics: vec4f,
}

struct CameraReprojectionOutput {
  values: array<vec4f, 16>,
}

@group(0) @binding(0) var<storage, read> referenceInput: array<CameraReprojectionInput, 4>;
@group(0) @binding(1) var<storage, read_write> referenceOutput: CameraReprojectionOutput;

fn cameraUvInBounds(uv: vec2f) -> bool {
  return all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
}

fn cameraScalarInvalid(value: f32) -> bool {
  return value != value || abs(value) == bitcast<f32>(0x7f800000u);
}

fn cameraVectorInvalid(value: vec4f) -> bool {
  return cameraScalarInvalid(value.x) ||
    cameraScalarInvalid(value.y) ||
    cameraScalarInvalid(value.z) ||
    cameraScalarInvalid(value.w);
}

fn cameraInvalidResult(
  currentUv: vec2f,
  currentDepth: f32,
  reason: f32,
  historyUv: vec2f,
  motionUv: vec2f,
  worldPosition: vec3f,
  previousNdc: vec3f,
  previousClipW: f32,
) -> CameraReprojectionResult {
  return CameraReprojectionResult(
    vec4f(historyUv, motionUv),
    vec4f(worldPosition, currentDepth),
    vec4f(previousNdc, previousClipW),
    vec4f(0.0, reason, currentUv),
  );
}

fn cameraReproject(
  currentUv: vec2f,
  currentDepth: f32,
  currentInverseViewProjection: mat4x4f,
  previousViewProjection: mat4x4f,
) -> CameraReprojectionResult {
  if (!cameraUvInBounds(currentUv)) {
    return cameraInvalidResult(
      currentUv,
      currentDepth,
      CAMERA_REPROJECTION_CURRENT_UV_INVALID,
      currentUv,
      vec2f(0.0),
      vec3f(0.0),
      vec3f(0.0),
      0.0,
    );
  }
  if (currentDepth >= 1.0) {
    return cameraInvalidResult(
      currentUv,
      currentDepth,
      CAMERA_REPROJECTION_BACKGROUND_DEPTH,
      currentUv,
      vec2f(0.0),
      vec3f(0.0),
      vec3f(0.0),
      0.0,
    );
  }

  let currentNdc = vec3f(currentUv.x * 2.0 - 1.0, 1.0 - currentUv.y * 2.0, currentDepth);
  let worldHomogeneous = currentInverseViewProjection * vec4f(currentNdc, 1.0);
  if (cameraVectorInvalid(worldHomogeneous) || abs(worldHomogeneous.w) <= CAMERA_REPROJECTION_EPSILON) {
    return cameraInvalidResult(
      currentUv,
      currentDepth,
      CAMERA_REPROJECTION_CURRENT_WORLD_INVALID,
      currentUv,
      vec2f(0.0),
      vec3f(0.0),
      vec3f(0.0),
      0.0,
    );
  }

  let worldPosition = worldHomogeneous.xyz / worldHomogeneous.w;
  let previousClip = previousViewProjection * vec4f(worldPosition, 1.0);
  if (cameraVectorInvalid(previousClip)) {
    return cameraInvalidResult(
      currentUv,
      currentDepth,
      CAMERA_REPROJECTION_PREVIOUS_PROJECTION_INVALID,
      currentUv,
      vec2f(0.0),
      worldPosition,
      vec3f(0.0),
      previousClip.w,
    );
  }
  if (previousClip.w <= CAMERA_REPROJECTION_EPSILON) {
    return cameraInvalidResult(
      currentUv,
      currentDepth,
      CAMERA_REPROJECTION_PREVIOUS_BEHIND,
      currentUv,
      vec2f(0.0),
      worldPosition,
      vec3f(0.0),
      previousClip.w,
    );
  }

  let previousNdc = previousClip.xyz / previousClip.w;
  let historyUv = vec2f((previousNdc.x + 1.0) * 0.5, (1.0 - previousNdc.y) * 0.5);
  let motionUv = currentUv - historyUv;
  if (previousNdc.z < 0.0 || previousNdc.z > 1.0) {
    return cameraInvalidResult(
      currentUv,
      currentDepth,
      CAMERA_REPROJECTION_PREVIOUS_DEPTH_INVALID,
      historyUv,
      motionUv,
      worldPosition,
      previousNdc,
      previousClip.w,
    );
  }
  if (!cameraUvInBounds(historyUv)) {
    return cameraInvalidResult(
      currentUv,
      currentDepth,
      CAMERA_REPROJECTION_PREVIOUS_UV_INVALID,
      historyUv,
      motionUv,
      worldPosition,
      previousNdc,
      previousClip.w,
    );
  }

  return CameraReprojectionResult(
    vec4f(historyUv, motionUv),
    vec4f(worldPosition, currentDepth),
    vec4f(previousNdc, previousClip.w),
    vec4f(1.0, CAMERA_REPROJECTION_VALID, currentUv),
  );
}

@compute @workgroup_size(1)
fn computeMain(@builtin(global_invocation_id) invocation: vec3u) {
  let caseIndex = invocation.x;
  if (caseIndex >= 4u) {
    return;
  }
  let input = referenceInput[caseIndex];
  let result = cameraReproject(
    input.currentUvAndDepth.xy,
    input.currentUvAndDepth.z,
    input.currentInverseViewProjection,
    input.previousViewProjection,
  );
  let outputIndex = caseIndex * 4u;
  referenceOutput.values[outputIndex] = result.historyAndMotionUv;
  referenceOutput.values[outputIndex + 1u] = result.worldAndCurrentDepth;
  referenceOutput.values[outputIndex + 2u] = result.previousNdcAndClipW;
  referenceOutput.values[outputIndex + 3u] = result.diagnostics;
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
  let identity = mat4x4f(
    vec4f(1.0, 0.0, 0.0, 0.0),
    vec4f(0.0, 1.0, 0.0, 0.0),
    vec4f(0.0, 0.0, 1.0, 0.0),
    vec4f(0.0, 0.0, 0.0, 1.0),
  );
  let result = cameraReproject(vec2f(0.25, 0.75), 0.4, identity, identity);
  return vec4f(result.historyAndMotionUv.xy, result.diagnostics.x, 1.0);
}
`;
