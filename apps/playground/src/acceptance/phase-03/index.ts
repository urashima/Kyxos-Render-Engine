import {
  ENVIRONMENT_CUBE_FACES,
  EnvironmentSource,
  PbrMaterial,
  PbrTextureSource,
  createKyxosPbrRenderer,
  createMaterialTextureBinding,
  createMaterialTextureReference,
  createUvSphereGeometry,
} from '@kyxos/render-sdk';
import type {
  EnvironmentCubeFaceData,
  KyxosPbrCanvasRenderer,
  PbrMaterialDescriptor,
  TextureTransferFunction,
} from '@kyxos/render-sdk';

import { acceptancePhaseHref, acceptanceRouteLabel } from '../../routing.js';

const COMMIT_SHA = import.meta.env.VITE_COMMIT_SHA ?? 'local-working-tree';
const METALLIC_STEPS = [0, 0.25, 0.5, 0.75, 1] as const;
const ROUGHNESS_STEPS = [0.05, 0.25, 0.5, 0.75, 1] as const;
const X_POSITIONS = [-3.2, -1.6, 0, 1.6, 3.2] as const;
const GALLERY_SPHERE = createUvSphereGeometry({
  heightSegments: 12,
  radius: 0.58,
  widthSegments: 24,
});

interface AcceptanceRuntime {
  aoEnabled: boolean;
  baselineResources: number | undefined;
  environment: EnvironmentSource;
  exposure: number;
  materials: PbrMaterial[];
  metallic: number;
  normalDown: boolean;
  renderer: KyxosPbrCanvasRenderer | undefined;
  rotation: number;
  roughness: number;
  special:
    | {
        readonly ao: PbrMaterial;
        readonly control: PbrMaterial;
        readonly normal: PbrMaterial;
      }
    | undefined;
  toneMapping: 'khronos-pbr-neutral' | 'none';
}

function requireElement<ElementType extends Element>(
  root: ParentNode,
  selector: string,
): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (element === null) throw new Error(`Required Phase 3 element was not found: ${selector}`);
  return element;
}

function cubeFaces(size: number, blur: number): EnvironmentCubeFaceData {
  const colors = [
    [2.2, 0.42, 0.12],
    [0.12, 0.45, 2.1],
    [1.25, 1.12, 0.84],
    [0.06, 0.08, 0.12],
    [0.24, 1.2, 0.8],
    [1.3, 0.18, 0.68],
  ] as const;
  return Object.fromEntries(
    ENVIRONMENT_CUBE_FACES.map((face, faceIndex) => {
      const source = colors[faceIndex] ?? colors[0];
      const pixels = new Float32Array(size * size * 3);
      for (let index = 0; index < size * size; index += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          const value = source[channel] ?? 0;
          pixels[index * 3 + channel] = value * (1 - blur) + 0.32 * blur;
        }
      }
      return [face, pixels];
    }),
  ) as unknown as EnvironmentCubeFaceData;
}

function createGalleryEnvironment(): EnvironmentSource {
  return new EnvironmentSource({
    brdfLut: {
      height: 2,
      pixels: [0.92, 0.02, 0.78, 0.06, 0.68, 0.08, 0.54, 0.12],
      width: 2,
    },
    diffuseIrradiance: { faces: cubeFaces(1, 0.72), size: 1 },
    id: 'phase-03-fixed-studio',
    specularPrefilter: {
      levels: [
        { faces: cubeFaces(4, 0) },
        { faces: cubeFaces(2, 0.48) },
        { faces: cubeFaces(1, 0.82) },
      ],
      size: 4,
    },
    version: 'p3-10-v1',
  });
}

function textureBinding(id: string, transferFunction: TextureTransferFunction) {
  return createMaterialTextureBinding({
    texture: createMaterialTextureReference({ id, transferFunction }),
  });
}

function acceptanceMarkup(): string {
  return `
    <main class="shell phase-03-shell" data-testid="phase-03-acceptance">
      <header class="topbar">
        <a class="brand" href="${acceptancePhaseHref(3)}" aria-label="Kyxos Phase 3 Playground">
          <span class="brand-mark" aria-hidden="true">K</span>
          <span><strong>Kyxos Render Engine</strong><small>PBR Material Gallery</small></span>
        </a>
        <nav class="phase-nav" aria-label="Acceptance phases">
          <a href="${acceptancePhaseHref(0)}">Phase 00</a>
          <a href="${acceptancePhaseHref(1)}">Phase 01</a>
          <a href="${acceptancePhaseHref(2)}">Phase 02</a>
          <a href="${acceptancePhaseHref(3)}" aria-current="page">Phase 03</a>
        </nav>
      </header>

      <section class="hero phase-03-hero">
        <div>
          <p class="eyebrow">METALLIC · ROUGHNESS · IBL · HDR OUTPUT</p>
          <h1>Material response, under one fixed light.</h1>
          <p class="lede">
            Twenty deterministic spheres exercise glTF metallic-roughness semantics, tangent-space
            normals, indirect-only occlusion, emissive sRGB, environment rotation, exposure, and
            Khronos PBR Neutral output through the public SDK.
          </p>
        </div>
        <div class="commit-block"><span>Commit</span><code data-testid="commit-sha">${COMMIT_SHA}</code></div>
      </section>

      <section class="status-strip" aria-label="PBR runtime status">
        <div><span>Backend</span><strong data-testid="backend-type">probing</strong></div>
        <div><span>Renderer</span><strong data-testid="renderer-state">initializing</strong></div>
        <div><span>Shader</span><strong data-testid="shader-status">compiling</strong></div>
        <div><span>Surface</span><strong data-testid="surface-size">—</strong></div>
        <div><span>Mode</span><strong data-testid="render-mode">sleeping</strong></div>
        <div><span>Gate</span><strong data-testid="resource-verdict">probing</strong></div>
      </section>

      <div class="workspace-grid phase-03-workspace">
        <section class="surface-card panel">
          <div class="panel-heading">
            <div><span class="section-index">01</span><h2>Fixed material matrix</h2></div>
            <span class="live-status" data-testid="live-status"><i></i> INITIALIZING</span>
          </div>
          <div class="gpu-stage pbr-stage" data-testid="pbr-stage">
            <canvas class="gpu-canvas" data-canvas="pbr" aria-label="Phase 3 PBR Material Gallery"></canvas>
            <div class="gpu-overlay pbr-overlay">
              <span>WEBGPU / <b>LINEAR HDR</b></span>
              <small>DIRECT + IBL → EXPOSURE → PBR NEUTRAL → sRGB</small>
            </div>
            <div class="gpu-error" data-testid="gpu-error" hidden></div>
          </div>
          <div class="gallery-key" aria-label="Material rows">
            <span><b>M</b> Metallic 0 → 1</span>
            <span><b>R</b> Roughness .05 → 1</span>
            <span><b>F</b> White · Gold · Copper · Iron · Control</span>
            <span><b>T</b> Normal · AO · Emission · sRGB · Linear MR</span>
          </div>
        </section>

        <aside class="panel diagnostics-card pbr-diagnostics">
          <div class="panel-heading">
            <div><span class="section-index">02</span><h2>GPU diagnostics</h2></div>
            <span class="pass-badge">PUBLIC SDK</span>
          </div>
          <dl class="metric-list">
            <div><dt>Frame / CPU</dt><dd><span data-testid="frame-index">0</span> / <span data-testid="cpu-frame-time">0.00 ms</span></dd></div>
            <div><dt>Draws / triangles</dt><dd><span data-testid="draw-calls">0</span> / <span data-testid="triangles">0</span></dd></div>
            <div><dt>GPU meshes / objects</dt><dd><span data-testid="gpu-mesh-count">0</span> / <span data-testid="object-binding-count">0</span></dd></div>
            <div><dt>Visible</dt><dd data-testid="visible-count">0</dd></div>
            <div><dt>Pipelines / materials</dt><dd><span data-testid="pipeline-count">0</span> / <span data-testid="material-count">0</span></dd></div>
            <div><dt>CPU textures</dt><dd data-testid="texture-count">0</dd></div>
            <div><dt>GPU resources</dt><dd><span data-testid="resource-count">0</span> / <span data-testid="resource-baseline">—</span></dd></div>
            <div><dt>Estimated GPU bytes</dt><dd data-testid="gpu-bytes" data-bytes="0">0 B</dd></div>
            <div><dt>Environment</dt><dd data-testid="environment-identity">—</dd></div>
            <div><dt>Exposure / tone map</dt><dd><span data-testid="exposure-value">0.00</span> / <span data-testid="tone-map-mode">neutral</span></dd></div>
            <div><dt>Environment rotation</dt><dd data-testid="rotation-value">0°</dd></div>
            <div><dt>Normal / AO</dt><dd><span data-testid="normal-direction">Y-up</span> / <span data-testid="ao-state">on</span></dd></div>
          </dl>
        </aside>
      </div>

      <div class="lower-grid phase-03-lower">
        <section class="panel controls-card">
          <div class="panel-heading">
            <div><span class="section-index">03</span><h2>Acceptance controls</h2></div>
            <span class="pass-badge">DIRTY ONLY</span>
          </div>
          <div class="pbr-controls">
            <label>Metallic <output data-output="metallic">0.50</output><input data-control="metallic" type="range" min="0" max="1" step="0.05" value="0.5"></label>
            <label>Roughness <output data-output="roughness">0.50</output><input data-control="roughness" type="range" min="0.05" max="1" step="0.05" value="0.5"></label>
            <label>Exposure <output data-output="exposure">0.00 EV</output><input data-control="exposure" type="range" min="-2" max="2" step="0.25" value="0"></label>
            <label>HDRI rotation <output data-output="rotation">0°</output><input data-control="rotation" type="range" min="0" max="360" step="15" value="0"></label>
          </div>
          <div class="action-row pbr-actions">
            <button data-action="normal" type="button">Flip Normal Y</button>
            <button data-action="ao" type="button">Toggle AO</button>
            <button data-action="tone-map" type="button">Toggle tone map</button>
            <button data-action="orbit-left" type="button">Orbit left</button>
            <button data-action="orbit-right" type="button">Orbit right</button>
            <button data-action="wake" type="button">Render once</button>
            <button data-action="lose" class="warning" type="button">Simulate loss</button>
            <button data-action="recover" type="button">Recover</button>
            <button data-action="dispose" class="quiet" type="button">Dispose</button>
            <button data-action="recreate" type="button">Recreate</button>
          </div>
        </section>

        <section class="panel architecture-card">
          <div class="panel-heading">
            <div><span class="section-index">04</span><h2>Color contract</h2></div>
            <span class="pass-badge">glTF 2.0</span>
          </div>
          <dl class="metric-list">
            <div><dt>Base color / Emission</dt><dd>sRGB → linear</dd></div>
            <div><dt>Metallic-Roughness / AO / Normal</dt><dd>linear</dd></div>
            <div><dt>AO scope</dt><dd>indirect only</dd></div>
            <div><dt>Environment</dt><dd>rgba16float cube mips</dd></div>
            <div><dt>BRDF LUT</dt><dd>rg16float split-sum</dd></div>
            <div><dt>Output</dt><dd>single sRGB encode</dd></div>
          </dl>
        </section>
      </div>

      <footer>
        <span>Public SDK → PBR Feature → opaque Backend Handles · No permanent RAF</span>
        <span>Phase 03 acceptance route: <code>${acceptanceRouteLabel(3)}</code></span>
      </footer>
    </main>
  `;
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function setError(root: ParentNode, message: string | undefined): void {
  const element = requireElement<HTMLElement>(root, '[data-testid="gpu-error"]');
  element.hidden = message === undefined;
  element.textContent = message ?? '';
}

function measuredSurface(root: ParentNode): { cssHeight: number; cssWidth: number } {
  const bounds = requireElement<HTMLElement>(
    root,
    '[data-testid="pbr-stage"]',
  ).getBoundingClientRect();
  return {
    cssHeight: Math.max(1, Math.round(bounds.height)),
    cssWidth: Math.max(1, Math.round(bounds.width)),
  };
}

function registerTextures(renderer: KyxosPbrCanvasRenderer): void {
  for (const source of [
    new PbrTextureSource({
      height: 1,
      id: 'normal-up',
      normalYDirection: 'up',
      pixels: new Uint8Array([128, 224, 196, 255]),
      transferFunction: 'linear',
      width: 1,
    }),
    new PbrTextureSource({
      height: 1,
      id: 'normal-down',
      normalYDirection: 'down',
      pixels: new Uint8Array([128, 224, 196, 255]),
      transferFunction: 'linear',
      width: 1,
    }),
    new PbrTextureSource({
      height: 1,
      id: 'occlusion',
      pixels: new Uint8Array([48, 255, 255, 255]),
      transferFunction: 'linear',
      width: 1,
    }),
    new PbrTextureSource({
      height: 1,
      id: 'emissive-srgb',
      pixels: new Uint8Array([255, 96, 24, 255]),
      transferFunction: 'srgb',
      width: 1,
    }),
    new PbrTextureSource({
      height: 1,
      id: 'base-color-srgb',
      pixels: new Uint8Array([128, 128, 128, 255]),
      transferFunction: 'srgb',
      width: 1,
    }),
    new PbrTextureSource({
      height: 1,
      id: 'metallic-roughness-linear',
      pixels: new Uint8Array([0, 128, 255, 255]),
      transferFunction: 'linear',
      width: 1,
    }),
  ]) {
    renderer.textures.set(source);
  }
}

function addMaterial(
  runtime: AcceptanceRuntime,
  renderer: KyxosPbrCanvasRenderer,
  key: string,
  descriptor: PbrMaterialDescriptor,
  position: readonly [number, number, number],
): PbrMaterial {
  const material = new PbrMaterial({ ...descriptor, name: key });
  runtime.materials.push(material);
  renderer.materials.set(key, material);
  const entity = renderer.scene.createEntity({ name: key, transform: { translation: position } });
  renderer.meshRenderers.attach(entity, {
    materialKey: key,
    mesh: GALLERY_SPHERE,
  });
  return material;
}

function populateGallery(
  runtime: AcceptanceRuntime,
  renderer: KyxosPbrCanvasRenderer,
): AcceptanceRuntime['special'] {
  registerTextures(renderer);
  METALLIC_STEPS.forEach((metallicFactor, index) => {
    addMaterial(
      runtime,
      renderer,
      `Metallic ${metallicFactor.toFixed(2)}`,
      { baseColorFactor: [0.78, 0.24, 0.08, 1], metallicFactor, roughnessFactor: 0.28 },
      [X_POSITIONS[index] ?? 0, 2.5, 0],
    );
  });
  ROUGHNESS_STEPS.forEach((roughnessFactor, index) => {
    addMaterial(
      runtime,
      renderer,
      `Roughness ${roughnessFactor.toFixed(2)}`,
      { baseColorFactor: [1, 0.766, 0.336, 1], metallicFactor: 1, roughnessFactor },
      [X_POSITIONS[index] ?? 0, 0.84, 0],
    );
  });
  const finishes = [
    ['White dielectric', [0.9, 0.9, 0.9, 1], 0, 0.34],
    ['Gold', [1, 0.766, 0.336, 1], 1, 0.24],
    ['Copper', [0.955, 0.638, 0.538, 1], 1, 0.28],
    ['Iron', [0.56, 0.57, 0.58, 1], 1, 0.33],
  ] as const;
  finishes.forEach(([name, baseColorFactor, metallicFactor, roughnessFactor], index) => {
    addMaterial(runtime, renderer, name, { baseColorFactor, metallicFactor, roughnessFactor }, [
      X_POSITIONS[index] ?? 0,
      -0.82,
      0,
    ]);
  });
  const control = addMaterial(
    runtime,
    renderer,
    'Interactive control',
    {
      baseColorFactor: [0.24, 0.7, 0.82, 1],
      metallicFactor: runtime.metallic,
      roughnessFactor: runtime.roughness,
    },
    [X_POSITIONS[4], -0.82, 0],
  );
  const normal = addMaterial(
    runtime,
    renderer,
    'Normal Y',
    {
      baseColorFactor: [0.72, 0.74, 0.78, 1],
      roughnessFactor: 0.4,
      textures: {
        normal: textureBinding(runtime.normalDown ? 'normal-down' : 'normal-up', 'linear'),
      },
    },
    [X_POSITIONS[0], -2.48, 0],
  );
  const ao = addMaterial(
    runtime,
    renderer,
    'Indirect AO',
    {
      baseColorFactor: [0.72, 0.48, 0.18, 1],
      occlusionStrength: runtime.aoEnabled ? 1 : 0,
      roughnessFactor: 0.58,
      textures: { occlusion: textureBinding('occlusion', 'linear') },
    },
    [X_POSITIONS[1], -2.48, 0],
  );
  addMaterial(
    runtime,
    renderer,
    'sRGB Emission',
    {
      baseColorFactor: [0.03, 0.03, 0.03, 1],
      emissiveFactor: [1, 0.42, 0.12],
      emissiveStrength: 2.5,
      textures: { emissive: textureBinding('emissive-srgb', 'srgb') },
    },
    [X_POSITIONS[2], -2.48, 0],
  );
  addMaterial(
    runtime,
    renderer,
    'sRGB Base Color',
    {
      roughnessFactor: 0.5,
      textures: { 'base-color': textureBinding('base-color-srgb', 'srgb') },
    },
    [X_POSITIONS[3], -2.48, 0],
  );
  addMaterial(
    runtime,
    renderer,
    'Linear Metallic-Roughness',
    {
      baseColorFactor: [0.86, 0.86, 0.86, 1],
      textures: {
        'metallic-roughness': textureBinding('metallic-roughness-linear', 'linear'),
      },
    },
    [X_POSITIONS[4], -2.48, 0],
  );
  return { ao, control, normal };
}

function updateDiagnostics(root: ParentNode, runtime: AcceptanceRuntime): void {
  const renderer = runtime.renderer;
  if (renderer === undefined) return;
  const diagnostics = renderer.getDiagnostics();
  const resources = diagnostics.backend.resources;
  requireElement(root, '[data-testid="backend-type"]').textContent = diagnostics.backend.type;
  requireElement(root, '[data-testid="renderer-state"]').textContent = diagnostics.state;
  requireElement(root, '[data-testid="render-mode"]').textContent = diagnostics.renderMode;
  requireElement(root, '[data-testid="frame-index"]').textContent = String(diagnostics.frameIndex);
  const cpuFrameTime = requireElement<HTMLElement>(root, '[data-testid="cpu-frame-time"]');
  cpuFrameTime.textContent = `${diagnostics.lastCpuFrameTimeMs.toFixed(2)} ms`;
  cpuFrameTime.dataset['milliseconds'] = String(diagnostics.lastCpuFrameTimeMs);
  requireElement(root, '[data-testid="draw-calls"]').textContent = String(
    diagnostics.lastFrameStatistics.drawCalls,
  );
  requireElement(root, '[data-testid="triangles"]').textContent = String(
    diagnostics.lastFrameStatistics.triangles,
  );
  requireElement(root, '[data-testid="resource-count"]').textContent = String(
    resources.activeCount,
  );
  const gpuBytes = resources.activeEstimatedBytes;
  const gpuBytesElement = requireElement<HTMLElement>(root, '[data-testid="gpu-bytes"]');
  gpuBytesElement.textContent = formatBytes(gpuBytes);
  gpuBytesElement.dataset['bytes'] = String(gpuBytes);
  const baseline = runtime.baselineResources;
  requireElement(root, '[data-testid="resource-baseline"]').textContent =
    baseline === undefined ? '—' : String(baseline);
  requireElement(root, '[data-testid="resource-verdict"]').textContent =
    diagnostics.state === 'ready' && baseline !== undefined && resources.activeCount === baseline
      ? 'stable'
      : diagnostics.state;
  const live = requireElement<HTMLElement>(root, '[data-testid="live-status"]');
  live.dataset['state'] = diagnostics.state;
  live.lastChild?.remove();
  live.append(document.createTextNode(` ${diagnostics.state.toUpperCase()}`));
  try {
    const surface = renderer.getSurfaceInfo();
    requireElement(root, '[data-testid="surface-size"]').textContent = surface.size.suspended
      ? 'suspended'
      : `${surface.size.physicalWidth}×${surface.size.physicalHeight}`;
  } catch {
    requireElement(root, '[data-testid="surface-size"]').textContent = 'unavailable';
  }
  if (diagnostics.state !== 'ready') return;
  const pbr = renderer.getPbrDiagnostics();
  requireElement(root, '[data-testid="visible-count"]').textContent = String(
    pbr.feature.visibility?.visibleCount ?? 0,
  );
  requireElement(root, '[data-testid="object-binding-count"]').textContent = String(
    pbr.feature.objectBindingCount,
  );
  requireElement(root, '[data-testid="gpu-mesh-count"]').textContent = String(
    pbr.feature.gpuMeshCount,
  );
  requireElement(root, '[data-testid="pipeline-count"]').textContent = String(
    pbr.feature.pipelineCount,
  );
  requireElement(root, '[data-testid="material-count"]').textContent = String(
    pbr.materials.materialCount,
  );
  requireElement(root, '[data-testid="texture-count"]').textContent = String(
    pbr.textures.textureCount,
  );
  requireElement(root, '[data-testid="environment-identity"]').textContent =
    pbr.feature.environmentIdentity === null ? 'fallback' : 'fixed-studio';
  requireElement(root, '[data-testid="exposure-value"]').textContent = runtime.exposure.toFixed(2);
  requireElement(root, '[data-testid="tone-map-mode"]').textContent =
    runtime.toneMapping === 'none' ? 'clamp' : 'neutral';
  requireElement(root, '[data-testid="rotation-value"]').textContent =
    `${Math.round((runtime.rotation * 180) / Math.PI)}°`;
  requireElement(root, '[data-testid="normal-direction"]').textContent = runtime.normalDown
    ? 'Y-down'
    : 'Y-up';
  requireElement(root, '[data-testid="ao-state"]').textContent = runtime.aoEnabled ? 'on' : 'off';
}

function disposeRenderer(runtime: AcceptanceRuntime): void {
  runtime.renderer?.dispose();
  for (const material of runtime.materials) material.dispose();
  runtime.materials = [];
  runtime.special = undefined;
}

function bindRendererEvents(
  root: ParentNode,
  runtime: AcceptanceRuntime,
  renderer: KyxosPbrCanvasRenderer,
): void {
  renderer.on('frame', () => {
    if (runtime.renderer !== renderer) return;
    if (runtime.baselineResources === undefined) {
      runtime.baselineResources = renderer.getDiagnostics().backend.resources.activeCount;
    }
    updateDiagnostics(root, runtime);
  });
  renderer.on('sleep', () => {
    if (runtime.renderer === renderer) updateDiagnostics(root, runtime);
  });
  renderer.on('device-lost', () => {
    if (runtime.renderer === renderer) updateDiagnostics(root, runtime);
  });
  renderer.on('error', (error) => {
    if (runtime.renderer !== renderer) return;
    setError(root, `${error.code}: ${error.message}`);
    updateDiagnostics(root, runtime);
  });
}

async function createRenderer(root: ParentNode, runtime: AcceptanceRuntime): Promise<void> {
  disposeRenderer(runtime);
  runtime.renderer = undefined;
  runtime.baselineResources = undefined;
  setError(root, undefined);
  requireElement(root, '[data-testid="renderer-state"]').textContent = 'initializing';
  requireElement(root, '[data-testid="shader-status"]').textContent = 'compiling';
  const canvas = requireElement<HTMLCanvasElement>(root, '[data-canvas="pbr"]');
  const size = measuredSurface(root);
  try {
    const renderer = await createKyxosPbrRenderer({
      backend: 'webgpu',
      canvas,
      clearColor: { a: 1, b: 0.025, g: 0.018, r: 0.014 },
      cssHeight: size.cssHeight,
      cssWidth: size.cssWidth,
      devicePixelRatio: window.devicePixelRatio,
      environment: {
        intensity: 1,
        rotation: runtime.rotation,
        source: runtime.environment,
      },
      label: 'phase-03-material-gallery',
      light: { color: [1, 0.94, 0.86], direction: [0.35, -1, -0.4], intensity: 2.4 },
      orbit: { distance: 10.5, pitchRadians: 0.02, target: [0, 0, 0], yawRadians: 0 },
      output: { exposure: runtime.exposure, toneMapping: runtime.toneMapping },
      powerPreference: 'high-performance',
    });
    runtime.renderer = renderer;
    bindRendererEvents(root, runtime, renderer);
    runtime.special = populateGallery(runtime, renderer);
    requireElement(root, '[data-testid="shader-status"]').textContent = 'pass';
    renderer.requestFrame('geometry');
    updateDiagnostics(root, runtime);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown WebGPU initialization error.';
    requireElement(root, '[data-testid="backend-type"]').textContent = 'unavailable';
    requireElement(root, '[data-testid="renderer-state"]').textContent = 'error';
    requireElement(root, '[data-testid="shader-status"]').textContent = 'blocked';
    setError(root, message);
  }
}

function bindControls(root: HTMLElement, runtime: AcceptanceRuntime): void {
  root.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const value = Number(input.value);
    switch (input.dataset['control']) {
      case 'metallic':
        runtime.metallic = value;
        runtime.special?.control.update({ metallicFactor: value });
        requireElement(root, '[data-output="metallic"]').textContent = value.toFixed(2);
        break;
      case 'roughness':
        runtime.roughness = value;
        runtime.special?.control.update({ roughnessFactor: value });
        requireElement(root, '[data-output="roughness"]').textContent = value.toFixed(2);
        break;
      case 'exposure':
        runtime.exposure = value;
        runtime.renderer?.setOutputTransform({ exposure: value });
        requireElement(root, '[data-output="exposure"]').textContent = `${value.toFixed(2)} EV`;
        break;
      case 'rotation':
        runtime.rotation = (value * Math.PI) / 180;
        runtime.renderer?.setEnvironment({ rotation: runtime.rotation });
        requireElement(root, '[data-output="rotation"]').textContent = `${value.toFixed(0)}°`;
        break;
      default:
        return;
    }
    updateDiagnostics(root, runtime);
  });
  root.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    try {
      switch (target.dataset['action']) {
        case 'normal':
          runtime.normalDown = !runtime.normalDown;
          runtime.special?.normal.update({
            textures: {
              normal: textureBinding(runtime.normalDown ? 'normal-down' : 'normal-up', 'linear'),
            },
          });
          break;
        case 'ao':
          runtime.aoEnabled = !runtime.aoEnabled;
          runtime.special?.ao.update({ occlusionStrength: runtime.aoEnabled ? 1 : 0 });
          break;
        case 'tone-map':
          runtime.toneMapping = runtime.toneMapping === 'none' ? 'khronos-pbr-neutral' : 'none';
          runtime.renderer?.setOutputTransform({ toneMapping: runtime.toneMapping });
          break;
        case 'orbit-left':
          runtime.renderer?.orbit(-0.18, 0);
          break;
        case 'orbit-right':
          runtime.renderer?.orbit(0.18, 0);
          break;
        case 'wake':
          runtime.renderer?.requestFrame();
          break;
        case 'lose':
          runtime.renderer?.debugSimulateDeviceLoss();
          break;
        case 'recover':
          await runtime.renderer?.recover();
          break;
        case 'dispose':
          disposeRenderer(runtime);
          break;
        case 'recreate':
          await createRenderer(root, runtime);
          break;
        default:
          return;
      }
      updateDiagnostics(root, runtime);
    } catch (error) {
      setError(root, error instanceof Error ? error.message : 'Unknown acceptance action error.');
      updateDiagnostics(root, runtime);
    }
  });
}

function bindPointerCamera(root: HTMLElement, runtime: AcceptanceRuntime): void {
  const canvas = requireElement<HTMLCanvasElement>(root, '[data-canvas="pbr"]');
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  let pointer: number | undefined;
  let previousX = 0;
  let previousY = 0;
  canvas.addEventListener('pointerdown', (event) => {
    pointer = event.pointerId;
    previousX = event.clientX;
    previousY = event.clientY;
    canvas.setPointerCapture(pointer);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (event) => {
    if (pointer !== event.pointerId) return;
    runtime.renderer?.orbit(
      (event.clientX - previousX) * 0.006,
      (previousY - event.clientY) * 0.006,
    );
    previousX = event.clientX;
    previousY = event.clientY;
  });
  const finish = (event: PointerEvent) => {
    if (pointer !== event.pointerId) return;
    if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    pointer = undefined;
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      runtime.renderer?.dolly(Math.exp(event.deltaY * 0.001));
    },
    { passive: false },
  );
}

export async function mountPhase03Acceptance(root: HTMLElement): Promise<void> {
  root.innerHTML = acceptanceMarkup();
  const runtime: AcceptanceRuntime = {
    aoEnabled: true,
    baselineResources: undefined,
    environment: createGalleryEnvironment(),
    exposure: 0,
    materials: [],
    metallic: 0.5,
    normalDown: false,
    renderer: undefined,
    rotation: 0,
    roughness: 0.5,
    special: undefined,
    toneMapping: 'khronos-pbr-neutral',
  };
  bindControls(root, runtime);
  bindPointerCamera(root, runtime);
  await createRenderer(root, runtime);
  let resizeRequest: number | undefined;
  const resize = () => {
    if (resizeRequest !== undefined) window.cancelAnimationFrame(resizeRequest);
    resizeRequest = window.requestAnimationFrame(() => {
      resizeRequest = undefined;
      const renderer = runtime.renderer;
      if (renderer === undefined || renderer.state !== 'ready') return;
      renderer.resize({ ...measuredSurface(root), devicePixelRatio: window.devicePixelRatio });
      updateDiagnostics(root, runtime);
    });
  };
  window.addEventListener('resize', resize);
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(resize);
    observer.observe(requireElement(root, '[data-testid="pbr-stage"]'));
  }
}
