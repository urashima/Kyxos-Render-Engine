import {
  VisibilitySystem,
  createCubeGeometry,
  createKyxosSceneRenderer,
  createPlaneGeometry,
  createUvSphereGeometry,
  quaternionFromAxisAngle,
} from '@kyxos/render-sdk';
import type { BackendClearColor, EntityHandle, KyxosSceneCanvasRenderer } from '@kyxos/render-sdk';

const ALL_LAYERS = 0xffff_ffff;
const COMMIT_SHA = import.meta.env.VITE_COMMIT_SHA ?? 'local-working-tree';
const INITIAL_RESOURCE_BASELINE = 21;

interface SceneHandles {
  readonly disabled: EntityHandle;
  readonly glassFar: EntityHandle;
  readonly glassNear: EntityHandle;
  readonly offscreen: EntityHandle;
  readonly root: EntityHandle;
}

interface AcceptanceRuntime {
  allLayers: boolean;
  clearVariant: number;
  frustumCulling: boolean;
  hidden: boolean;
  renderer: KyxosSceneCanvasRenderer | undefined;
  rotationStep: number;
  sceneHandles: SceneHandles | undefined;
  transparentSwapped: boolean;
}

const clearColors: readonly BackendClearColor[] = Object.freeze([
  Object.freeze({ a: 1, b: 0.055, g: 0.035, r: 0.025 }),
  Object.freeze({ a: 1, b: 0.075, g: 0.045, r: 0.018 }),
  Object.freeze({ a: 1, b: 0.025, g: 0.065, r: 0.06 }),
]);

function clearColorAt(index: number): BackendClearColor {
  return clearColors[index] ?? clearColors[0] ?? { a: 1, b: 0, g: 0, r: 0 };
}

function requireElement<ElementType extends Element>(
  root: ParentNode,
  selector: string,
): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (element === null) throw new Error(`Required Phase 2 element was not found: ${selector}`);
  return element;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function acceptanceMarkup(): string {
  return `
    <main class="shell phase-02-shell" data-testid="phase-02-acceptance">
      <header class="topbar">
        <a class="brand" href="/acceptance/phase-02" aria-label="Kyxos Phase 2 Playground">
          <span class="brand-mark" aria-hidden="true">K</span>
          <span><strong>Kyxos Render Engine</strong><small>Independent Scene Playground</small></span>
        </a>
        <nav class="phase-nav" aria-label="Acceptance phases">
          <a href="/acceptance/phase-00">Phase 00</a>
          <a href="/acceptance/phase-01">Phase 01</a>
          <a href="/acceptance/phase-02" aria-current="page">Phase 02</a>
        </nav>
      </header>

      <section class="hero phase-02-hero">
        <div>
          <p class="eyebrow">SCENE · CAMERA · GEOMETRY · LIVE ACCEPTANCE</p>
          <h1>A scene graph that only wakes when it changes.</h1>
          <p class="lede">
            One public SDK composes hierarchy, immutable geometry, camera framing, culling,
            transparent ordering, Renderer-owned GPU resources, and dirty-only WebGPU submission.
          </p>
        </div>
        <div class="commit-block"><span>Commit</span><code data-testid="commit-sha">${COMMIT_SHA}</code></div>
      </section>

      <section class="status-strip" aria-label="Scene runtime status">
        <div><span>Backend</span><strong data-testid="backend-type">probing</strong></div>
        <div><span>Renderer</span><strong data-testid="renderer-state">initializing</strong></div>
        <div><span>Shader</span><strong data-testid="shader-status">compiling</strong></div>
        <div><span>Surface</span><strong data-testid="surface-size">—</strong></div>
        <div><span>DPR</span><strong data-testid="dpr">—</strong></div>
        <div><span>Mode</span><strong data-testid="render-mode">sleeping</strong></div>
      </section>

      <div class="workspace-grid phase-02-workspace">
        <section class="surface-card panel">
          <div class="panel-heading">
            <div><span class="section-index">01</span><h2>Scene Canvas</h2></div>
            <span class="live-status" data-testid="live-status"><i></i> INITIALIZING</span>
          </div>
          <div class="gpu-stage scene-stage" data-testid="scene-stage">
            <canvas class="gpu-canvas" data-canvas="scene" aria-label="Phase 2 WebGPU Scene"></canvas>
            <div class="gpu-overlay scene-overlay">
              <span>WEBGPU / <b>SCENE QUEUES</b></span>
              <small><b data-testid="culling-mode">FRUSTUM ON</b> · depth24plus</small>
            </div>
            <div class="scene-axis" aria-hidden="true"><i class="axis-x"></i><i class="axis-y"></i><i class="axis-z"></i></div>
            <div class="gpu-error" data-testid="gpu-error" hidden></div>
          </div>
          <div class="action-row scene-actions" aria-label="Scene and camera controls">
            <button data-action="orbit-left" type="button">Orbit left</button>
            <button data-action="orbit-right" type="button">Orbit right</button>
            <button data-action="orbit-up" type="button">Orbit up</button>
            <button data-action="dolly-in" type="button">Dolly in</button>
            <button data-action="dolly-out" type="button">Dolly out</button>
            <button data-action="frame" type="button">Frame scene</button>
            <button data-action="rotate-parent" type="button">Rotate parent</button>
            <button data-action="swap-transparent" type="button">Swap transparency</button>
            <button data-action="toggle-culling" type="button">Toggle culling</button>
            <button data-action="toggle-layers" type="button">Toggle layer 2</button>
            <button data-action="clear" type="button">Change clear</button>
            <button data-action="wake" type="button">Render once</button>
            <button data-action="hide" type="button">Suspend</button>
            <button data-action="restore" type="button">Restore</button>
            <button data-action="lose" type="button" class="warning">Simulate loss</button>
            <button data-action="recover" type="button">Recover</button>
            <button data-action="dispose" type="button" class="quiet">Dispose</button>
            <button data-action="recreate" type="button">Recreate</button>
          </div>
        </section>

        <aside class="panel diagnostics-card scene-diagnostics">
          <div class="panel-heading">
            <div><span class="section-index">02</span><h2>Queues &amp; resources</h2></div>
            <span class="pass-badge" data-testid="resource-verdict">BASELINE</span>
          </div>
          <dl class="metric-list">
            <div><dt>Frame index</dt><dd data-testid="frame-index">0</dd></div>
            <div><dt>Draw calls</dt><dd data-testid="draw-calls">0</dd></div>
            <div><dt>Triangles</dt><dd data-testid="triangles">0</dd></div>
            <div><dt>Submitted vertices</dt><dd data-testid="vertices">0</dd></div>
            <div><dt>Visible</dt><dd data-testid="visible-count">0</dd></div>
            <div><dt>Opaque / transparent</dt><dd><span data-testid="opaque-count">0</span> / <span data-testid="transparent-count">0</span></dd></div>
            <div><dt>Disabled / hidden</dt><dd><span data-testid="disabled-count">0</span> / <span data-testid="hidden-count">0</span></dd></div>
            <div><dt>Layer / frustum culled</dt><dd><span data-testid="layer-culled-count">0</span> / <span data-testid="frustum-culled-count">0</span></dd></div>
            <div><dt>Transparent order</dt><dd data-testid="transparent-order">—</dd></div>
            <div><dt>GPU meshes / objects</dt><dd><span data-testid="gpu-mesh-count">0</span> / <span data-testid="object-binding-count">0</span></dd></div>
            <div><dt>Pipelines / resources</dt><dd><span data-testid="pipeline-count">0</span> / <span data-testid="resource-count">0</span></dd></div>
            <div><dt>Buffer memory</dt><dd data-testid="buffer-memory">0 B</dd></div>
          </dl>
        </aside>
      </div>

      <div class="lower-grid">
        <section class="panel architecture-card">
          <div class="panel-heading">
            <div><span class="section-index">03</span><h2>Scene contract</h2></div>
            <span class="pass-badge">PUBLIC SDK</span>
          </div>
          <dl class="metric-list scene-contract">
            <div><dt>Hierarchy</dt><dd data-testid="hierarchy">Root → Child</dd></div>
            <div><dt>Camera aspect</dt><dd data-testid="camera-aspect">—</dd></div>
            <div><dt>Orbit yaw / pitch</dt><dd data-testid="orbit-angle">—</dd></div>
            <div><dt>Orbit distance</dt><dd data-testid="orbit-distance">—</dd></div>
            <div><dt>Scene entities</dt><dd data-testid="entity-count">0</dd></div>
            <div><dt>Surface viewport</dt><dd data-testid="viewport">—</dd></div>
          </dl>
        </section>

        <section class="panel event-card">
          <div class="panel-heading">
            <div><span class="section-index">04</span><h2>Dirty event trace</h2></div>
            <button data-action="clear-log" class="text-button" type="button">Clear</button>
          </div>
          <ol class="event-log" data-testid="event-log" aria-live="polite"></ol>
        </section>
      </div>

      <footer>
        <span>Scene → Visibility → Renderer → opaque Backend Handles · No permanent RAF</span>
        <span>Phase 02 acceptance route: <code>/acceptance/phase-02</code></span>
      </footer>
    </main>
  `;
}

function appendEvent(root: ParentNode, message: string): void {
  const log = requireElement<HTMLOListElement>(root, '[data-testid="event-log"]');
  const item = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const text = document.createElement('span');
  text.textContent = message;
  item.append(time, text);
  log.prepend(item);
  while (log.childElementCount > 9) log.lastElementChild?.remove();
}

function setError(root: ParentNode, message: string | undefined): void {
  const error = requireElement<HTMLElement>(root, '[data-testid="gpu-error"]');
  error.hidden = message === undefined;
  error.textContent = message ?? '';
}

function measuredSurface(root: ParentNode): { cssHeight: number; cssWidth: number } {
  const bounds = requireElement<HTMLElement>(
    root,
    '[data-testid="scene-stage"]',
  ).getBoundingClientRect();
  return {
    cssHeight: Math.max(1, Math.round(bounds.height)),
    cssWidth: Math.max(1, Math.round(bounds.width)),
  };
}

function visibilityOptions(runtime: AcceptanceRuntime) {
  return {
    cameraLayerMask: runtime.allLayers ? ALL_LAYERS : 1,
    frustumCulling: runtime.frustumCulling,
  } as const;
}

function frameVisibleCluster(runtime: AcceptanceRuntime): void {
  const renderer = runtime.renderer;
  const handles = runtime.sceneHandles;
  if (renderer === undefined || handles === undefined) return;
  renderer.scene.setVisible(handles.offscreen, false);
  renderer.scene.setVisible(handles.disabled, false);
  renderer.frameScene({ bounds: { layerMask: 1, visibleOnly: true } });
  renderer.scene.setVisible(handles.offscreen, true);
  renderer.scene.setVisible(handles.disabled, true);
}

function populateScene(renderer: KyxosSceneCanvasRenderer): SceneHandles {
  const plane = createPlaneGeometry({ depth: 7, width: 7 });
  const cube = createCubeGeometry({ height: 1.25, width: 1.25 });
  const sphere = createUvSphereGeometry({ heightSegments: 8, radius: 0.62, widthSegments: 16 });
  const ground = renderer.scene.createEntity({
    name: 'Ground',
    transform: { translation: [0, -1, 0] },
  });
  renderer.meshRenderers.attach(ground, { baseColor: [0.19, 0.23, 0.24, 1], mesh: plane });

  const root = renderer.scene.createEntity({
    name: 'Root Cube',
    transform: { translation: [-1.15, -0.3, 0] },
  });
  renderer.meshRenderers.attach(root, { baseColor: [0.92, 0.34, 0.18, 1], mesh: cube });
  const child = renderer.scene.createEntity({
    name: 'Child Sphere',
    parent: root,
    transform: { translation: [2.05, 0.38, 0] },
  });
  renderer.meshRenderers.attach(child, { baseColor: [0.23, 0.76, 0.68, 1], mesh: sphere });

  const glassNear = renderer.scene.createEntity({
    name: 'Glass Near',
    transform: { translation: [-0.15, 0.55, 1.35], scale: [0.78, 0.78, 0.78] },
  });
  renderer.meshRenderers.attach(glassNear, {
    alphaMode: 'blend',
    baseColor: [0.35, 0.68, 1, 0.42],
    materialKey: 'glass-near',
    mesh: sphere,
  });
  const glassFar = renderer.scene.createEntity({
    name: 'Glass Far',
    transform: { translation: [0.55, 0.35, -1.5], scale: [1.05, 1.05, 1.05] },
  });
  renderer.meshRenderers.attach(glassFar, {
    alphaMode: 'blend',
    baseColor: [0.67, 0.38, 0.95, 0.38],
    materialKey: 'glass-far',
    mesh: sphere,
  });

  const offscreen = renderer.scene.createEntity({
    name: 'Offscreen Cube',
    transform: { translation: [60, 0, 0] },
  });
  renderer.meshRenderers.attach(offscreen, { baseColor: [0.8, 0.75, 0.2, 1], mesh: cube });
  const hidden = renderer.scene.createEntity({ name: 'Hidden Cube', visible: false });
  renderer.meshRenderers.attach(hidden, { mesh: cube });
  const layer = renderer.scene.createEntity({
    layerMask: 2,
    name: 'Layer 2 Cube',
    transform: { translation: [0, 1.4, 0] },
  });
  renderer.meshRenderers.attach(layer, { baseColor: [0.85, 0.7, 0.15, 1], mesh: cube });
  const disabled = renderer.scene.createEntity({
    name: 'Disabled Cube',
    transform: { translation: [0, 0, 1] },
  });
  renderer.meshRenderers.attach(disabled, { enabled: false, mesh: cube });

  return { disabled, glassFar, glassNear, offscreen, root };
}

function updateDiagnostics(root: ParentNode, runtime: AcceptanceRuntime): void {
  requireElement(root, '[data-testid="viewport"]').textContent =
    `${window.innerWidth} × ${window.innerHeight}`;
  requireElement(root, '[data-testid="dpr"]').textContent = window.devicePixelRatio.toFixed(2);
  const renderer = runtime.renderer;
  if (renderer === undefined) return;
  const diagnostics = renderer.getDiagnostics();
  const resources = diagnostics.backend.resources;
  const statistics = diagnostics.lastFrameStatistics;
  requireElement(root, '[data-testid="backend-type"]').textContent = diagnostics.backend.type;
  requireElement(root, '[data-testid="renderer-state"]').textContent = diagnostics.state;
  requireElement(root, '[data-testid="render-mode"]').textContent = diagnostics.renderMode;
  const frameIndex = requireElement<HTMLElement>(root, '[data-testid="frame-index"]');
  frameIndex.textContent = String(diagnostics.frameIndex);
  frameIndex.dataset['cpuFrameTimeMs'] = String(diagnostics.lastCpuFrameTimeMs);
  requireElement(root, '[data-testid="draw-calls"]').textContent = String(statistics.drawCalls);
  requireElement(root, '[data-testid="triangles"]').textContent = String(statistics.triangles);
  requireElement(root, '[data-testid="vertices"]').textContent = String(statistics.vertices);
  requireElement(root, '[data-testid="pipeline-count"]').textContent = String(
    resources.byKind.pipeline.activeCount,
  );
  requireElement(root, '[data-testid="resource-count"]').textContent = String(
    resources.activeCount,
  );
  const bufferMemory = requireElement<HTMLElement>(root, '[data-testid="buffer-memory"]');
  bufferMemory.textContent = formatBytes(resources.byKind.buffer.activeEstimatedBytes);
  bufferMemory.dataset['bytes'] = String(resources.byKind.buffer.activeEstimatedBytes);
  const verdict = requireElement(root, '[data-testid="resource-verdict"]');
  verdict.textContent =
    diagnostics.state === 'ready' && resources.activeCount === INITIAL_RESOURCE_BASELINE
      ? 'BASELINE'
      : diagnostics.state.toUpperCase();

  const liveStatus = requireElement<HTMLElement>(root, '[data-testid="live-status"]');
  liveStatus.dataset['state'] = diagnostics.state;
  liveStatus.lastChild?.remove();
  liveStatus.append(document.createTextNode(` ${diagnostics.state.toUpperCase()}`));
  requireElement(root, '[data-testid="culling-mode"]').textContent =
    `FRUSTUM ${runtime.frustumCulling ? 'ON' : 'OFF'}`;

  try {
    const surface = renderer.getSurfaceInfo();
    requireElement(root, '[data-testid="surface-size"]').textContent = surface.size.suspended
      ? 'suspended'
      : `${surface.size.physicalWidth}×${surface.size.physicalHeight}`;
  } catch {
    requireElement(root, '[data-testid="surface-size"]').textContent = 'unavailable';
  }
  if (diagnostics.state !== 'ready') return;

  const queues = new VisibilitySystem().build(
    renderer.scene,
    renderer.camera,
    renderer.meshRenderers,
    visibilityOptions(runtime),
  );
  const queueDiagnostics = queues.diagnostics;
  requireElement(root, '[data-testid="visible-count"]').textContent = String(
    queueDiagnostics.visibleCount,
  );
  requireElement(root, '[data-testid="opaque-count"]').textContent = String(
    queueDiagnostics.opaqueCount,
  );
  requireElement(root, '[data-testid="transparent-count"]').textContent = String(
    queueDiagnostics.transparentCount,
  );
  requireElement(root, '[data-testid="disabled-count"]').textContent = String(
    queueDiagnostics.disabledCount,
  );
  requireElement(root, '[data-testid="hidden-count"]').textContent = String(
    queueDiagnostics.hiddenCount,
  );
  requireElement(root, '[data-testid="layer-culled-count"]').textContent = String(
    queueDiagnostics.layerCulledCount,
  );
  requireElement(root, '[data-testid="frustum-culled-count"]').textContent = String(
    queueDiagnostics.frustumCulledCount,
  );
  requireElement(root, '[data-testid="transparent-order"]').textContent = queues.transparent
    .map(({ entity }) => renderer.scene.nameOf(entity))
    .join(' → ');
  const sceneDiagnostics = renderer.getSceneDiagnostics();
  requireElement(root, '[data-testid="gpu-mesh-count"]').textContent = String(
    sceneDiagnostics.feature.gpuMeshCount,
  );
  requireElement(root, '[data-testid="object-binding-count"]').textContent = String(
    sceneDiagnostics.feature.objectBindingCount,
  );
  requireElement(root, '[data-testid="camera-aspect"]').textContent =
    renderer.camera.aspect.toFixed(3);
  requireElement(root, '[data-testid="orbit-angle"]').textContent =
    `${sceneDiagnostics.orbit.yawRadians.toFixed(3)} / ${sceneDiagnostics.orbit.pitchRadians.toFixed(3)}`;
  requireElement(root, '[data-testid="orbit-distance"]').textContent =
    sceneDiagnostics.orbit.distance.toFixed(3);
  requireElement(root, '[data-testid="entity-count"]').textContent = String(
    sceneDiagnostics.scene.entityCount,
  );
}

function bindRendererEvents(
  root: ParentNode,
  runtime: AcceptanceRuntime,
  renderer: KyxosSceneCanvasRenderer,
): void {
  renderer.on('wake', ({ dirtyFlag }) => {
    if (runtime.renderer !== renderer) return;
    appendEvent(root, `scheduler.wake · ${dirtyFlag}`);
    updateDiagnostics(root, runtime);
  });
  renderer.on('frame', ({ frameIndex, statistics }) => {
    if (runtime.renderer !== renderer) return;
    appendEvent(
      root,
      `frame.${frameIndex} · ${statistics.drawCalls} draws · ${statistics.triangles} triangles`,
    );
    updateDiagnostics(root, runtime);
  });
  renderer.on('sleep', () => {
    if (runtime.renderer !== renderer) return;
    appendEvent(root, 'scheduler.sleep · zero pending frames');
    updateDiagnostics(root, runtime);
  });
  renderer.on('device-lost', ({ reason }) => {
    if (runtime.renderer !== renderer) return;
    appendEvent(root, `backend.lost · ${reason} · resources released`);
    updateDiagnostics(root, runtime);
  });
  renderer.on('error', (error) => {
    if (runtime.renderer !== renderer) return;
    setError(root, `${error.code}: ${error.message}`);
    appendEvent(root, `error · ${error.code}`);
    updateDiagnostics(root, runtime);
  });
}

async function createRenderer(root: ParentNode, runtime: AcceptanceRuntime): Promise<void> {
  runtime.renderer?.dispose();
  runtime.renderer = undefined;
  runtime.sceneHandles = undefined;
  runtime.hidden = false;
  runtime.allLayers = false;
  runtime.frustumCulling = true;
  runtime.transparentSwapped = false;
  runtime.rotationStep = 0;
  setError(root, undefined);
  const canvas = requireElement<HTMLCanvasElement>(root, '[data-canvas="scene"]');
  canvas.classList.remove('is-hidden');
  requireElement(root, '[data-testid="renderer-state"]').textContent = 'initializing';
  requireElement(root, '[data-testid="shader-status"]').textContent = 'compiling';
  const measured = measuredSurface(root);

  try {
    const renderer = await createKyxosSceneRenderer({
      backend: 'webgpu',
      cameraLayerMask: 1,
      canvas,
      clearColor: clearColorAt(runtime.clearVariant),
      cssHeight: measured.cssHeight,
      cssWidth: measured.cssWidth,
      devicePixelRatio: window.devicePixelRatio,
      label: 'phase-02-scene',
      orbit: { distance: 8, pitchRadians: 0.22, yawRadians: 0.35 },
      powerPreference: 'high-performance',
    });
    runtime.renderer = renderer;
    bindRendererEvents(root, runtime, renderer);
    runtime.sceneHandles = populateScene(renderer);
    frameVisibleCluster(runtime);
    requireElement(root, '[data-testid="shader-status"]').textContent = 'pass';
    appendEvent(root, 'renderer.ready · Scene + Camera + WGSL PASS');
    updateDiagnostics(root, runtime);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown WebGPU initialization error.';
    requireElement(root, '[data-testid="backend-type"]').textContent = 'unavailable';
    requireElement(root, '[data-testid="renderer-state"]').textContent = 'error';
    requireElement(root, '[data-testid="shader-status"]').textContent = 'blocked';
    setError(root, message);
    appendEvent(root, `initialization.error · ${message}`);
  }
}

function resizeRenderer(root: ParentNode, runtime: AcceptanceRuntime): void {
  const renderer = runtime.renderer;
  if (renderer === undefined || renderer.state !== 'ready') return;
  const measured = measuredSurface(root);
  renderer.resize({
    cssHeight: runtime.hidden ? 0 : measured.cssHeight,
    cssWidth: measured.cssWidth,
    devicePixelRatio: window.devicePixelRatio,
  });
  updateDiagnostics(root, runtime);
}

function bindActions(root: HTMLElement, runtime: AcceptanceRuntime): void {
  root.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const action = target.dataset['action'];
    const renderer = runtime.renderer;
    const handles = runtime.sceneHandles;
    try {
      switch (action) {
        case 'orbit-left':
          renderer?.orbit(-0.18, 0);
          break;
        case 'orbit-right':
          renderer?.orbit(0.18, 0);
          break;
        case 'orbit-up':
          renderer?.orbit(0, 0.12);
          break;
        case 'dolly-in':
          renderer?.dolly(0.82);
          break;
        case 'dolly-out':
          renderer?.dolly(1.22);
          break;
        case 'frame':
          frameVisibleCluster(runtime);
          appendEvent(root, 'camera.frame · visible layer-1 cluster');
          break;
        case 'rotate-parent':
          if (renderer !== undefined && handles !== undefined) {
            runtime.rotationStep += 1;
            renderer.scene.setLocalTransform(handles.root, {
              rotation: quaternionFromAxisAngle([0, 1, 0], runtime.rotationStep * (Math.PI / 8)),
            });
            appendEvent(root, `scene.transform · parent rotation ${runtime.rotationStep}`);
          }
          break;
        case 'swap-transparent':
          if (renderer !== undefined && handles !== undefined) {
            runtime.transparentSwapped = !runtime.transparentSwapped;
            renderer.scene.setLocalTransform(handles.glassNear, {
              translation: runtime.transparentSwapped ? [-0.15, 0.55, -1.8] : [-0.15, 0.55, 1.35],
            });
            renderer.scene.setLocalTransform(handles.glassFar, {
              translation: runtime.transparentSwapped ? [0.55, 0.35, 1.5] : [0.55, 0.35, -1.5],
            });
            appendEvent(root, 'queues.transparent · distance order changed');
          }
          break;
        case 'toggle-culling':
          runtime.frustumCulling = !runtime.frustumCulling;
          renderer?.setVisibilityOptions(visibilityOptions(runtime));
          break;
        case 'toggle-layers':
          runtime.allLayers = !runtime.allLayers;
          renderer?.setVisibilityOptions(visibilityOptions(runtime));
          break;
        case 'clear':
          runtime.clearVariant = (runtime.clearVariant + 1) % clearColors.length;
          renderer?.setClearColor(clearColorAt(runtime.clearVariant));
          break;
        case 'wake':
          renderer?.requestFrame('geometry');
          break;
        case 'hide':
          runtime.hidden = true;
          requireElement(root, '[data-canvas="scene"]').classList.add('is-hidden');
          resizeRenderer(root, runtime);
          appendEvent(root, 'surface.suspend · zero CSS height');
          break;
        case 'restore':
          runtime.hidden = false;
          requireElement(root, '[data-canvas="scene"]').classList.remove('is-hidden');
          resizeRenderer(root, runtime);
          appendEvent(root, 'surface.restore · depth recreated');
          break;
        case 'lose':
          renderer?.debugSimulateDeviceLoss();
          appendEvent(root, 'backend.loss-request · native device private');
          break;
        case 'recover':
          await renderer?.recover();
          appendEvent(root, 'renderer.recover · Scene resources recreated');
          break;
        case 'dispose':
          renderer?.dispose();
          appendEvent(root, 'renderer.dispose · Scene + GPU resources 0');
          break;
        case 'recreate':
          await createRenderer(root, runtime);
          break;
        case 'clear-log':
          requireElement(root, '[data-testid="event-log"]').replaceChildren();
          break;
        default:
          return;
      }
      updateDiagnostics(root, runtime);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown acceptance action error.';
      setError(root, message);
      appendEvent(root, `action.error · ${message}`);
      updateDiagnostics(root, runtime);
    }
  });
}

export async function mountPhase02Acceptance(root: HTMLElement): Promise<void> {
  root.innerHTML = acceptanceMarkup();
  const runtime: AcceptanceRuntime = {
    allLayers: false,
    clearVariant: 0,
    frustumCulling: true,
    hidden: false,
    renderer: undefined,
    rotationStep: 0,
    sceneHandles: undefined,
    transparentSwapped: false,
  };
  bindActions(root, runtime);
  await createRenderer(root, runtime);

  let resizeRequest: number | undefined;
  const requestResize = () => {
    if (resizeRequest !== undefined) window.cancelAnimationFrame(resizeRequest);
    resizeRequest = window.requestAnimationFrame(() => {
      resizeRequest = undefined;
      resizeRenderer(root, runtime);
    });
  };
  window.addEventListener('resize', requestResize);
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(requestResize);
    observer.observe(requireElement(root, '[data-testid="scene-stage"]'));
  }
}
