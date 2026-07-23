import {
  ENVIRONMENT_CUBE_FACES,
  EnvironmentSource,
  PbrMaterial,
  PbrTextureSource,
  createMaterialTextureBinding,
  createMaterialTextureReference,
  createUvSphereGeometry,
  integrateGgxBrdfLut,
} from '@kyxos/render-sdk';
import type {
  EnvironmentCubeFace,
  EnvironmentCubeFaceData,
  PbrMaterialDescriptor,
} from '@kyxos/render-sdk';
import { createKyxosTemporalPbrRenderer } from '@kyxos/render-sdk/temporal-pbr';
import type { KyxosTemporalPbrCanvasRenderer } from '@kyxos/render-sdk/temporal-pbr';

import { acceptancePhaseHref, acceptanceRouteLabel } from '../../routing.js';
import './phase-04.css';

const COMMIT_SHA = import.meta.env.VITE_COMMIT_SHA ?? 'local-working-tree';
const TARGET_SAMPLES = 16;
const SPHERE = createUvSphereGeometry({ heightSegments: 28, radius: 0.9, widthSegments: 48 });

interface AcceptanceRuntime {
  accumulationStartedAt: number | undefined;
  animationActive: boolean;
  animationRequest: number | undefined;
  baselineResources: number | undefined;
  disposedResources: number | undefined;
  environment: EnvironmentSource;
  fps: number;
  lastDirtyFlags: readonly string[];
  lastFrameTimestamp: number | undefined;
  material: PbrMaterial | undefined;
  materials: PbrMaterial[];
  metallic: number;
  renderer: KyxosTemporalPbrCanvasRenderer | undefined;
  roughness: number;
  staticToSleepMs: number | undefined;
  textureAlternate: boolean;
  wakeCount: number;
}

function requireElement<ElementType extends Element>(
  root: ParentNode,
  selector: string,
): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (element === null) throw new Error(`Required Phase 4 element was not found: ${selector}`);
  return element;
}

function normalizeDirection(x: number, y: number, z: number): readonly number[] {
  const inverseLength = 1 / Math.hypot(x, y, z);
  return [x * inverseLength, y * inverseLength, z * inverseLength];
}

function cubeDirection(face: EnvironmentCubeFace, u: number, v: number): readonly number[] {
  switch (face) {
    case 'positive-x':
      return normalizeDirection(1, -v, -u);
    case 'negative-x':
      return normalizeDirection(-1, -v, u);
    case 'positive-y':
      return normalizeDirection(u, 1, v);
    case 'negative-y':
      return normalizeDirection(u, -1, -v);
    case 'positive-z':
      return normalizeDirection(u, -v, 1);
    case 'negative-z':
      return normalizeDirection(-u, -v, -1);
  }
}

function studioRadiance(direction: readonly number[], blur: number): readonly number[] {
  const [x = 0, y = 0, z = 0] = direction;
  const sky = Math.max(0, y) ** 0.7;
  const ground = Math.max(0, -y);
  const horizon = Math.exp(-Math.abs(y) * 5);
  const keyDirection = normalizeDirection(0.45, 0.78, 0.43);
  const rimDirection = normalizeDirection(-0.72, 0.22, 0.65);
  const exponent = 72 * (1 - blur) + 1.5;
  const lobe = (target: readonly number[], scale: number) =>
    Math.max(0, x * (target[0] ?? 0) + y * (target[1] ?? 0) + z * (target[2] ?? 0)) **
    (exponent * scale);
  const key = lobe(keyDirection, 2.6) * (11 * (1 - blur) + 0.9);
  const rim = lobe(rimDirection, 0.26) * (2.2 - blur);
  return [
    0.025 + sky * 0.08 + ground * 0.025 + horizon * 0.04 + key + rim * 0.16,
    0.035 + sky * 0.15 + ground * 0.02 + horizon * 0.055 + key * 0.82 + rim * 0.62,
    0.06 + sky * 0.34 + ground * 0.018 + horizon * 0.08 + key * 0.56 + rim,
  ];
}

function cubeFaces(size: number, blur: number): EnvironmentCubeFaceData {
  return Object.fromEntries(
    ENVIRONMENT_CUBE_FACES.map((face) => {
      const pixels = new Float32Array(size * size * 3);
      for (let row = 0; row < size; row += 1) {
        for (let column = 0; column < size; column += 1) {
          const u = ((column + 0.5) / size) * 2 - 1;
          const v = ((row + 0.5) / size) * 2 - 1;
          const radiance = studioRadiance(cubeDirection(face, u, v), blur);
          const offset = (row * size + column) * 3;
          pixels[offset] = radiance[0] ?? 0;
          pixels[offset + 1] = radiance[1] ?? 0;
          pixels[offset + 2] = radiance[2] ?? 0;
        }
      }
      return [face, pixels];
    }),
  ) as unknown as EnvironmentCubeFaceData;
}

function createBrdfLut(size: number): readonly number[] {
  const pixels: number[] = [];
  for (let row = 0; row < size; row += 1) {
    const roughness = (row + 0.5) / size;
    for (let column = 0; column < size; column += 1) {
      const result = integrateGgxBrdfLut((column + 0.5) / size, roughness);
      pixels.push(Math.min(1, result.scale), Math.min(1, result.bias));
    }
  }
  return pixels;
}

function createTemporalEnvironment(): EnvironmentSource {
  const size = 16;
  const mipCount = Math.log2(size) + 1;
  return new EnvironmentSource({
    brdfLut: { height: 12, pixels: createBrdfLut(12), width: 12 },
    diffuseIrradiance: { faces: cubeFaces(4, 0.9), size: 4 },
    id: 'phase-04-temporal-studio',
    specularPrefilter: {
      levels: Array.from({ length: mipCount }, (_, mipLevel) => ({
        faces: cubeFaces(size / 2 ** mipLevel, mipLevel / (mipCount - 1)),
      })),
      size,
    },
    version: 'p4-12-v1',
  });
}

function textureBinding(id: string) {
  return createMaterialTextureBinding({
    texture: createMaterialTextureReference({ id, transferFunction: 'srgb' }),
  });
}

function acceptanceMarkup(): string {
  return `
    <main class="shell phase-04-shell" data-testid="phase-04-acceptance">
      <header class="topbar">
        <a class="brand" href="${acceptancePhaseHref(4)}" aria-label="Kyxos Phase 4 Playground">
          <span class="brand-mark" aria-hidden="true">K</span>
          <span><strong>Kyxos Render Engine</strong><small>Temporal Pipeline Lab</small></span>
        </a>
        <nav class="phase-nav" aria-label="Acceptance phases">
          <a href="${acceptancePhaseHref(0)}">Phase 00</a>
          <a href="${acceptancePhaseHref(1)}">Phase 01</a>
          <a href="${acceptancePhaseHref(2)}">Phase 02</a>
          <a href="${acceptancePhaseHref(3)}">Phase 03</a>
          <a href="${acceptancePhaseHref(4)}" aria-current="page">Phase 04</a>
        </nav>
      </header>

      <section class="hero phase-04-hero">
        <div>
          <p class="eyebrow">SCHEDULER · DYNAMIC TAA · STATIC ACCUMULATION · SLEEP</p>
          <h1>Move. Settle. Converge. Stop.</h1>
          <p class="lede">
            A single public-SDK Surface exposes the complete temporal transaction. Camera, material,
            texture, animation, Resize, and Device Lost events reset History, wake rendering, and
            return to zero-RAF sleep after ${TARGET_SAMPLES} static samples.
          </p>
        </div>
        <div class="commit-block"><span>Commit</span><code data-testid="commit-sha">${COMMIT_SHA}</code></div>
      </section>

      <section class="temporal-status" aria-label="Temporal runtime status">
        <div><span>Backend</span><strong data-testid="backend-type">probing</strong></div>
        <div><span>Renderer</span><strong data-testid="renderer-state">initializing</strong></div>
        <div><span>Render mode</span><strong data-testid="render-mode">sleeping</strong></div>
        <div><span>RAF active</span><strong data-testid="raf-active">false</strong></div>
        <div><span>Samples</span><strong><b data-testid="sample-count">0</b> / <b data-testid="target-samples">${TARGET_SAMPLES}</b></strong></div>
        <div><span>History</span><strong data-testid="history-valid">invalid</strong></div>
      </section>

      <div class="phase-04-grid">
        <section class="panel temporal-stage-card">
          <div class="panel-heading">
            <div><span class="section-index">01</span><h2>Temporal material stage</h2></div>
            <span class="live-status" data-testid="live-status"><i></i> INITIALIZING</span>
          </div>
          <div class="gpu-stage temporal-stage" data-testid="temporal-stage">
            <canvas class="gpu-canvas" data-canvas="temporal" aria-label="Phase 4 Temporal PBR Stage"></canvas>
            <div class="temporal-mode-overlay" data-testid="mode-overlay">
              <span data-testid="overlay-mode">SLEEPING</span>
              <small data-testid="active-passes">NO ACTIVE PASS</small>
            </div>
            <div class="sample-progress" aria-hidden="true"><i data-testid="sample-progress"></i></div>
            <div class="gpu-error" data-testid="gpu-error" hidden></div>
          </div>
          <div class="stage-instructions">
            <span>Drag to orbit</span><span>Wheel to dolly</span><span>Stop to accumulate</span>
          </div>
        </section>

        <aside class="panel temporal-diagnostics">
          <div class="panel-heading">
            <div><span class="section-index">02</span><h2>Realtime HUD</h2></div>
            <span class="pass-badge">PUBLIC SDK</span>
          </div>
          <dl class="metric-list">
            <div><dt>Frame / FPS</dt><dd><span data-testid="frame-index">0</span> / <span data-testid="fps">0.0</span></dd></div>
            <div><dt>CPU / GPU frame</dt><dd><span data-testid="cpu-frame-time">0.00 ms</span> / <span data-testid="gpu-frame-time">N/A</span></dd></div>
            <div><dt>Draws / triangles</dt><dd><span data-testid="draw-calls">0</span> / <span data-testid="triangles">0</span></dd></div>
            <div><dt>Pipelines</dt><dd data-testid="pipeline-count">0</dd></div>
            <div><dt>Texture / buffer</dt><dd><span data-testid="texture-bytes">0 B</span> / <span data-testid="buffer-bytes">0 B</span></dd></div>
            <div><dt>GPU resources</dt><dd><span data-testid="resource-count">0</span> / <span data-testid="resource-baseline">—</span></dd></div>
            <div><dt>Surface / DPR</dt><dd><span data-testid="surface-size">—</span> / <span data-testid="surface-dpr">—</span></dd></div>
            <div><dt>Dirty flags</dt><dd data-testid="dirty-flags">none</dd></div>
            <div><dt>Wake count</dt><dd data-testid="wake-count">0</dd></div>
            <div><dt>Static to sleep</dt><dd data-testid="static-to-sleep">—</dd></div>
            <div><dt>History generation</dt><dd data-testid="history-generation">0</dd></div>
            <div><dt>Resource verdict</dt><dd data-testid="resource-verdict">probing</dd></div>
          </dl>
        </aside>
      </div>

      <div class="phase-04-lower">
        <section class="panel temporal-controls">
          <div class="panel-heading">
            <div><span class="section-index">03</span><h2>Dirty and activity controls</h2></div>
            <span class="pass-badge">${acceptanceRouteLabel(4)}</span>
          </div>
          <div class="temporal-sliders">
            <label>Roughness <output data-output="roughness">0.22</output><input data-control="roughness" type="range" min="0.05" max="1" step="0.01" value="0.22"></label>
            <label>Metallic <output data-output="metallic">0.80</output><input data-control="metallic" type="range" min="0" max="1" step="0.01" value="0.8"></label>
          </div>
          <div class="control-grid temporal-buttons">
            <button data-action="orbit-left">Orbit left</button>
            <button data-action="orbit-right">Orbit right</button>
            <button data-action="texture">Replace texture</button>
            <button data-action="reset-history">Reset History</button>
            <button data-action="wake">Dirty wake</button>
            <button data-action="animation">Start animation</button>
            <button data-action="lose">Simulate Device Lost</button>
            <button data-action="recover">Recover renderer</button>
            <button data-action="reset-scene">Reset scene</button>
            <button data-action="dispose">Dispose</button>
            <button data-action="recreate">Recreate</button>
          </div>
        </section>

        <section class="panel temporal-timeline">
          <div class="panel-heading">
            <div><span class="section-index">04</span><h2>Required state path</h2></div>
            <span class="pass-badge">FAIL CLOSED</span>
          </div>
          <ol>
            <li data-mode="interactive"><b>Interactive</b><span>Camera, animation, or Dirty activity</span></li>
            <li data-mode="stabilizing"><b>Stabilizing</b><span>Interaction ended; History prepares</span></li>
            <li data-mode="accumulating"><b>Accumulating</b><span>Dynamic TAA feeds static HDR mean</span></li>
            <li data-mode="sleeping"><b>Sleeping</b><span>No pending RAF after convergence</span></li>
          </ol>
        </section>
      </div>
    </main>
  `;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function setError(root: ParentNode, message: string | undefined): void {
  const element = requireElement<HTMLElement>(root, '[data-testid="gpu-error"]');
  element.hidden = message === undefined;
  element.textContent = message ?? '';
}

function measuredSurface(root: ParentNode): { cssHeight: number; cssWidth: number } {
  const bounds = requireElement<HTMLElement>(
    root,
    '[data-testid="temporal-stage"]',
  ).getBoundingClientRect();
  return {
    cssHeight: Math.max(1, Math.round(bounds.height)),
    cssWidth: Math.max(1, Math.round(bounds.width)),
  };
}

function materialDescriptor(runtime: AcceptanceRuntime): PbrMaterialDescriptor {
  return {
    baseColorFactor: [1, 1, 1, 1],
    metallicFactor: runtime.metallic,
    roughnessFactor: runtime.roughness,
    textures: {
      'base-color': textureBinding(runtime.textureAlternate ? 'temporal-orange' : 'temporal-cyan'),
    },
  };
}

function addMaterial(
  runtime: AcceptanceRuntime,
  renderer: KyxosTemporalPbrCanvasRenderer,
  key: string,
  descriptor: PbrMaterialDescriptor,
  position: readonly [number, number, number],
): PbrMaterial {
  const material = new PbrMaterial({ ...descriptor, name: key });
  runtime.materials.push(material);
  renderer.materials.set(key, material);
  const entity = renderer.scene.createEntity({ name: key, transform: { translation: position } });
  renderer.meshRenderers.attach(entity, { materialKey: key, mesh: SPHERE });
  return material;
}

function populateScene(
  runtime: AcceptanceRuntime,
  renderer: KyxosTemporalPbrCanvasRenderer,
): PbrMaterial {
  renderer.textures.set(
    new PbrTextureSource({
      height: 1,
      id: 'temporal-cyan',
      pixels: new Uint8Array([42, 176, 216, 255]),
      transferFunction: 'srgb',
      width: 1,
    }),
  );
  renderer.textures.set(
    new PbrTextureSource({
      height: 1,
      id: 'temporal-orange',
      pixels: new Uint8Array([255, 94, 36, 255]),
      transferFunction: 'srgb',
      width: 1,
    }),
  );
  addMaterial(
    runtime,
    renderer,
    'Gold reference',
    { baseColorFactor: [1, 0.766, 0.336, 1], metallicFactor: 1, roughnessFactor: 0.18 },
    [-2.05, 0, 0],
  );
  const control = addMaterial(runtime, renderer, 'Temporal control', materialDescriptor(runtime), [0, 0, 0]);
  addMaterial(
    runtime,
    renderer,
    'Dielectric reference',
    { baseColorFactor: [0.72, 0.76, 0.82, 1], metallicFactor: 0, roughnessFactor: 0.38 },
    [2.05, 0, 0],
  );
  return control;
}

function updateTimeline(root: ParentNode, mode: string): void {
  for (const item of root.querySelectorAll<HTMLElement>('[data-mode]')) {
    item.dataset['active'] = String(item.dataset['mode'] === mode);
  }
}

function updateDiagnostics(root: ParentNode, runtime: AcceptanceRuntime): void {
  const renderer = runtime.renderer;
  if (renderer === undefined) {
    requireElement(root, '[data-testid="renderer-state"]').textContent = 'disposed';
    if (runtime.disposedResources !== undefined) {
      requireElement(root, '[data-testid="resource-count"]').textContent = String(
        runtime.disposedResources,
      );
      requireElement(root, '[data-testid="resource-verdict"]').textContent =
        runtime.disposedResources === 0 ? 'released' : 'leaked';
    }
    return;
  }
  const diagnostics = renderer.getTemporalDiagnostics();
  const base = diagnostics.renderer;
  const scheduler = diagnostics.scheduler;
  const pipeline = diagnostics.feature.pipeline;
  const resources = base.backend.resources;
  const mode = scheduler.mode;
  requireElement(root, '[data-testid="backend-type"]').textContent = base.backend.type;
  requireElement(root, '[data-testid="renderer-state"]').textContent = base.state;
  requireElement(root, '[data-testid="render-mode"]').textContent = mode;
  requireElement(root, '[data-testid="raf-active"]').textContent = String(scheduler.pending);
  requireElement(root, '[data-testid="sample-count"]').textContent = String(
    scheduler.convergence.sampleCount,
  );
  requireElement(root, '[data-testid="target-samples"]').textContent = String(
    scheduler.convergence.targetSamples,
  );
  requireElement(root, '[data-testid="history-valid"]').textContent =
    pipeline.dynamicHistory.history.valid ? 'valid' : 'invalid';
  requireElement(root, '[data-testid="frame-index"]').textContent = String(base.frameIndex);
  requireElement(root, '[data-testid="fps"]').textContent = runtime.fps.toFixed(1);
  requireElement(root, '[data-testid="cpu-frame-time"]').textContent =
    `${base.lastCpuFrameTimeMs.toFixed(2)} ms`;
  requireElement(root, '[data-testid="draw-calls"]').textContent = String(
    base.lastFrameStatistics.drawCalls,
  );
  requireElement(root, '[data-testid="triangles"]').textContent = String(
    base.lastFrameStatistics.triangles,
  );
  requireElement(root, '[data-testid="pipeline-count"]').textContent = String(
    resources.byKind.pipeline?.activeCount ?? 0,
  );
  requireElement(root, '[data-testid="texture-bytes"]').textContent = formatBytes(
    resources.byKind.texture?.activeEstimatedBytes ?? 0,
  );
  requireElement(root, '[data-testid="buffer-bytes"]').textContent = formatBytes(
    resources.byKind.buffer?.activeEstimatedBytes ?? 0,
  );
  requireElement(root, '[data-testid="resource-count"]').textContent = String(
    resources.activeCount,
  );
  requireElement(root, '[data-testid="resource-baseline"]').textContent =
    runtime.baselineResources === undefined ? '—' : String(runtime.baselineResources);
  requireElement(root, '[data-testid="dirty-flags"]').textContent =
    runtime.lastDirtyFlags.length === 0 ? 'none' : runtime.lastDirtyFlags.join(', ');
  requireElement(root, '[data-testid="wake-count"]').textContent = String(runtime.wakeCount);
  requireElement(root, '[data-testid="static-to-sleep"]').textContent =
    runtime.staticToSleepMs === undefined ? '—' : `${runtime.staticToSleepMs.toFixed(1)} ms`;
  requireElement(root, '[data-testid="history-generation"]').textContent = String(
    scheduler.historyGeneration,
  );
  requireElement(root, '[data-testid="resource-verdict"]').textContent =
    runtime.baselineResources === undefined
      ? 'probing'
      : resources.activeCount === runtime.baselineResources
        ? 'stable'
        : 'changed';
  const surface = renderer.getSurfaceInfo();
  requireElement(root, '[data-testid="surface-size"]').textContent = surface.size.suspended
    ? 'suspended'
    : `${surface.size.physicalWidth}×${surface.size.physicalHeight}`;
  requireElement(root, '[data-testid="surface-dpr"]').textContent =
    surface.size.devicePixelRatio.toFixed(2);
  const activePasses =
    mode === 'sleeping'
      ? 'NO ACTIVE PASS'
      : mode === 'accumulating'
        ? 'PBR MRT → DYNAMIC TAA → STATIC ACCUMULATION → PRESENT'
        : 'PBR MRT → DYNAMIC TAA → PRESENT';
  requireElement(root, '[data-testid="active-passes"]').textContent = activePasses;
  requireElement(root, '[data-testid="overlay-mode"]').textContent = mode.toUpperCase();
  const progress = requireElement<HTMLElement>(root, '[data-testid="sample-progress"]');
  progress.style.width = `${Math.min(100, (scheduler.convergence.sampleCount / scheduler.convergence.targetSamples) * 100)}%`;
  const live = requireElement<HTMLElement>(root, '[data-testid="live-status"]');
  live.dataset['state'] = base.state;
  live.lastChild?.remove();
  live.append(document.createTextNode(` ${base.state.toUpperCase()}`));
  requireElement<HTMLElement>(root, '[data-testid="mode-overlay"]').dataset['mode'] = mode;
  updateTimeline(root, mode);
}

function stopAnimation(runtime: AcceptanceRuntime): void {
  runtime.animationActive = false;
  if (runtime.animationRequest !== undefined) {
    window.cancelAnimationFrame(runtime.animationRequest);
    runtime.animationRequest = undefined;
  }
  const renderer = runtime.renderer;
  if (renderer !== undefined && renderer.state === 'ready') {
    renderer.setActivity('animation', false);
  }
}

function disposeRenderer(runtime: AcceptanceRuntime): void {
  stopAnimation(runtime);
  const renderer = runtime.renderer;
  runtime.renderer = undefined;
  if (renderer !== undefined) {
    renderer.dispose();
    runtime.disposedResources = renderer.getDiagnostics().backend.resources.activeCount;
  }
  for (const material of runtime.materials) material.dispose();
  runtime.materials = [];
  runtime.material = undefined;
}

function bindRendererEvents(
  root: ParentNode,
  runtime: AcceptanceRuntime,
  renderer: KyxosTemporalPbrCanvasRenderer,
): void {
  renderer.on('frame', (event) => {
    if (runtime.renderer !== renderer) return;
    runtime.lastDirtyFlags = event.dirtyFlags;
    if (runtime.lastFrameTimestamp !== undefined && event.timestamp > runtime.lastFrameTimestamp) {
      runtime.fps = 1000 / (event.timestamp - runtime.lastFrameTimestamp);
    }
    runtime.lastFrameTimestamp = event.timestamp;
    if (event.temporal?.mode === 'accumulating' && runtime.accumulationStartedAt === undefined) {
      runtime.accumulationStartedAt = performance.now();
    }
    updateDiagnostics(root, runtime);
  });
  renderer.on('wake', () => {
    if (runtime.renderer !== renderer) return;
    runtime.wakeCount += 1;
    runtime.staticToSleepMs = undefined;
    runtime.accumulationStartedAt = undefined;
    updateDiagnostics(root, runtime);
  });
  renderer.on('sleep', () => {
    if (runtime.renderer !== renderer) return;
    if (runtime.accumulationStartedAt !== undefined) {
      runtime.staticToSleepMs = performance.now() - runtime.accumulationStartedAt;
    }
    runtime.baselineResources ??= renderer.getDiagnostics().backend.resources.activeCount;
    updateDiagnostics(root, runtime);
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
  runtime.baselineResources = undefined;
  runtime.disposedResources = undefined;
  runtime.lastDirtyFlags = [];
  runtime.lastFrameTimestamp = undefined;
  runtime.fps = 0;
  runtime.wakeCount = 0;
  setError(root, undefined);
  requireElement(root, '[data-testid="renderer-state"]').textContent = 'initializing';
  const canvas = requireElement<HTMLCanvasElement>(root, '[data-canvas="temporal"]');
  const size = measuredSurface(root);
  try {
    const renderer = await createKyxosTemporalPbrRenderer({
      backend: 'webgpu',
      canvas,
      clearColor: { a: 1, b: 0.018, g: 0.012, r: 0.008 },
      cssHeight: size.cssHeight,
      cssWidth: size.cssWidth,
      devicePixelRatio: window.devicePixelRatio,
      environment: { intensity: 1, rotation: 0, source: runtime.environment },
      frustumCulling: false,
      label: 'phase-04-temporal-acceptance',
      light: { color: [1, 0.95, 0.88], direction: [0.4, 0.78, 0.46], intensity: 2.2 },
      orbit: { distance: 7.2, pitchRadians: 0.04, target: [0, 0, 0], yawRadians: 0 },
      output: { exposure: 0, toneMapping: 'khronos-pbr-neutral' },
      ownerId: 'phase-04-temporal-acceptance',
      powerPreference: 'high-performance',
      stabilizationMs: 120,
      targetSamples: TARGET_SAMPLES,
    });
    runtime.renderer = renderer;
    bindRendererEvents(root, runtime, renderer);
    runtime.material = populateScene(runtime, renderer);
    renderer.requestFrame('geometry');
    updateDiagnostics(root, runtime);
  } catch (error) {
    requireElement(root, '[data-testid="backend-type"]').textContent = 'unavailable';
    requireElement(root, '[data-testid="renderer-state"]').textContent = 'error';
    setError(root, error instanceof Error ? error.message : 'Unknown WebGPU initialization error.');
  }
}

function startAnimation(root: ParentNode, runtime: AcceptanceRuntime): void {
  const renderer = runtime.renderer;
  if (renderer === undefined || renderer.state !== 'ready') return;
  runtime.animationActive = true;
  renderer.setActivity('animation', true, 'animation');
  const button = requireElement<HTMLButtonElement>(root, '[data-action="animation"]');
  button.textContent = 'Stop animation';
  button.dataset['active'] = 'true';
  const tick = () => {
    if (!runtime.animationActive || runtime.renderer !== renderer || renderer.state !== 'ready') {
      return;
    }
    renderer.orbit(0.008, 0);
    runtime.animationRequest = window.requestAnimationFrame(tick);
  };
  runtime.animationRequest = window.requestAnimationFrame(tick);
}

function finishAnimation(root: ParentNode, runtime: AcceptanceRuntime): void {
  stopAnimation(runtime);
  const button = requireElement<HTMLButtonElement>(root, '[data-action="animation"]');
  button.textContent = 'Start animation';
  button.dataset['active'] = 'false';
}

function bindControls(root: HTMLElement, runtime: AcceptanceRuntime): void {
  root.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const value = Number(input.value);
    if (input.dataset['control'] === 'roughness') {
      runtime.roughness = value;
      runtime.material?.update({ roughnessFactor: value });
      requireElement(root, '[data-output="roughness"]').textContent = value.toFixed(2);
    } else if (input.dataset['control'] === 'metallic') {
      runtime.metallic = value;
      runtime.material?.update({ metallicFactor: value });
      requireElement(root, '[data-output="metallic"]').textContent = value.toFixed(2);
    } else {
      return;
    }
    updateDiagnostics(root, runtime);
  });
  root.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    try {
      switch (target.dataset['action']) {
        case 'orbit-left':
          runtime.renderer?.orbit(-0.22, 0);
          break;
        case 'orbit-right':
          runtime.renderer?.orbit(0.22, 0);
          break;
        case 'texture':
          runtime.textureAlternate = !runtime.textureAlternate;
          runtime.material?.update({
            textures: {
              'base-color': textureBinding(
                runtime.textureAlternate ? 'temporal-orange' : 'temporal-cyan',
              ),
            },
          });
          break;
        case 'reset-history':
          runtime.renderer?.resetTemporalHistory('accumulation');
          break;
        case 'wake':
          runtime.renderer?.requestFrame('material');
          break;
        case 'animation':
          if (runtime.animationActive) finishAnimation(root, runtime);
          else startAnimation(root, runtime);
          break;
        case 'lose':
          runtime.renderer?.debugSimulateDeviceLoss();
          break;
        case 'recover':
          await runtime.renderer?.recover();
          break;
        case 'reset-scene':
          runtime.roughness = 0.22;
          runtime.metallic = 0.8;
          runtime.textureAlternate = false;
          requireElement<HTMLInputElement>(root, '[data-control="roughness"]').value = '0.22';
          requireElement<HTMLInputElement>(root, '[data-control="metallic"]').value = '0.8';
          requireElement(root, '[data-output="roughness"]').textContent = '0.22';
          requireElement(root, '[data-output="metallic"]').textContent = '0.80';
          await createRenderer(root, runtime);
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
  const canvas = requireElement<HTMLCanvasElement>(root, '[data-canvas="temporal"]');
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
    runtime.renderer?.setActivity('interaction', true, 'camera');
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
    runtime.renderer?.setActivity('interaction', false);
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const renderer = runtime.renderer;
      renderer?.setActivity('interaction', true, 'camera');
      renderer?.dolly(Math.exp(event.deltaY * 0.001));
      renderer?.setActivity('interaction', false);
    },
    { passive: false },
  );
}

export async function mountPhase04Acceptance(root: HTMLElement): Promise<void> {
  root.innerHTML = acceptanceMarkup();
  const runtime: AcceptanceRuntime = {
    accumulationStartedAt: undefined,
    animationActive: false,
    animationRequest: undefined,
    baselineResources: undefined,
    disposedResources: undefined,
    environment: createTemporalEnvironment(),
    fps: 0,
    lastDirtyFlags: [],
    lastFrameTimestamp: undefined,
    material: undefined,
    materials: [],
    metallic: 0.8,
    renderer: undefined,
    roughness: 0.22,
    staticToSleepMs: undefined,
    textureAlternate: false,
    wakeCount: 0,
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
    observer.observe(requireElement(root, '[data-testid="temporal-stage"]'));
  }
}
