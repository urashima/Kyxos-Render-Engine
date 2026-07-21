import { createKyxosRenderer } from '@kyxos/render-sdk';
import type { BackendClearColor, KyxosCanvasRenderer } from '@kyxos/render-sdk';

const COMMIT_SHA = import.meta.env.VITE_COMMIT_SHA ?? 'local-working-tree';
const RESOURCE_BASELINE = 6;

interface AcceptanceRuntime {
  activeCanvas: 'a' | 'b';
  clearVariant: number;
  hidden: boolean;
  renderer: KyxosCanvasRenderer | undefined;
}

const clearColors: readonly BackendClearColor[] = Object.freeze([
  Object.freeze({ a: 1, b: 0.055, g: 0.035, r: 0.025 }),
  Object.freeze({ a: 1, b: 0.025, g: 0.085, r: 0.055 }),
  Object.freeze({ a: 1, b: 0.11, g: 0.045, r: 0.075 }),
]);

function clearColorAt(index: number): BackendClearColor {
  return clearColors[index] ?? clearColors[0] ?? { a: 1, b: 0, g: 0, r: 0 };
}

function requireElement<ElementType extends Element>(
  root: ParentNode,
  selector: string,
): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (element === null) throw new Error(`Required Phase 1 element was not found: ${selector}`);
  return element;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function acceptanceMarkup(): string {
  return `
    <main class="shell phase-01-shell" data-testid="phase-01-acceptance">
      <header class="topbar">
        <a class="brand" href="/acceptance/phase-01" aria-label="Kyxos Phase 1 Playground">
          <span class="brand-mark" aria-hidden="true">K</span>
          <span><strong>Kyxos Render Engine</strong><small>Independent WebGPU Playground</small></span>
        </a>
        <nav class="phase-nav" aria-label="Acceptance phases">
          <a href="/acceptance/phase-00">Phase 00</a>
          <a href="/acceptance/phase-01" aria-current="page">Phase 01</a>
        </nav>
      </header>

      <section class="hero phase-01-hero">
        <div>
          <p class="eyebrow">WEBGPU CORE · LIVE ACCEPTANCE</p>
          <h1>Native surface, owned end to end.</h1>
          <p class="lede">
            The public SDK negotiates WebGPU, compiles canonical WGSL, uploads generated geometry,
            submits one dirty-driven frame, and returns every resource to baseline on disposal.
          </p>
        </div>
        <div class="commit-block"><span>Commit</span><code data-testid="commit-sha">${COMMIT_SHA}</code></div>
      </section>

      <section class="status-strip" aria-label="WebGPU runtime status">
        <div><span>Backend</span><strong data-testid="backend-type">probing</strong></div>
        <div><span>Renderer</span><strong data-testid="renderer-state">initializing</strong></div>
        <div><span>Shader</span><strong data-testid="shader-status">compiling</strong></div>
        <div><span>Surface</span><strong data-testid="surface-size">—</strong></div>
        <div><span>DPR</span><strong data-testid="dpr">—</strong></div>
        <div><span>Mode</span><strong data-testid="render-mode">sleeping</strong></div>
      </section>

      <div class="workspace-grid phase-01-workspace">
        <section class="surface-card panel">
          <div class="panel-heading">
            <div><span class="section-index">01</span><h2>WebGPU Canvas</h2></div>
            <span class="live-status" data-testid="live-status"><i></i> INITIALIZING</span>
          </div>
          <div class="gpu-stage" data-testid="gpu-stage">
            <canvas class="gpu-canvas" data-canvas="a" aria-label="Primary WebGPU Canvas"></canvas>
            <canvas class="gpu-canvas" data-canvas="b" aria-label="Secondary WebGPU Canvas" hidden></canvas>
            <div class="gpu-overlay" data-testid="gpu-overlay">
              <span>WEBGPU / <b data-testid="primitive">TRIANGLE</b></span>
              <small>Canvas <b data-testid="active-canvas">A</b> · dirty-driven</small>
            </div>
            <div class="gpu-error" data-testid="gpu-error" hidden></div>
          </div>
          <div class="action-row phase-01-actions" aria-label="Geometry and lifecycle controls">
            <button data-action="triangle" type="button">Triangle</button>
            <button data-action="sphere" type="button">Sphere</button>
            <button data-action="clear" type="button">Change clear</button>
            <button data-action="wake" type="button">Render once</button>
            <button data-action="hide" type="button">Hide Canvas</button>
            <button data-action="restore" type="button">Restore</button>
            <button data-action="switch" type="button">Switch Canvas</button>
            <button data-action="lose" type="button" class="warning">Simulate loss</button>
            <button data-action="recover" type="button">Recover</button>
            <button data-action="dispose" type="button" class="quiet">Dispose</button>
            <button data-action="recreate" type="button">Recreate</button>
          </div>
        </section>

        <aside class="panel diagnostics-card">
          <div class="panel-heading">
            <div><span class="section-index">02</span><h2>Frame &amp; resources</h2></div>
            <span class="pass-badge" data-testid="resource-verdict">BASELINE</span>
          </div>
          <dl class="metric-list">
            <div><dt>Frame index</dt><dd data-testid="frame-index">0</dd></div>
            <div><dt>Draw calls</dt><dd data-testid="draw-calls">0</dd></div>
            <div><dt>Triangles</dt><dd data-testid="triangles">0</dd></div>
            <div><dt>Submitted vertices</dt><dd data-testid="vertices">0</dd></div>
            <div><dt>Pipelines</dt><dd data-testid="pipeline-count">0</dd></div>
            <div><dt>Resources</dt><dd data-testid="resource-count">0</dd></div>
            <div><dt>Resource delta</dt><dd data-testid="resource-delta">—</dd></div>
            <div><dt>Buffer memory</dt><dd data-testid="buffer-memory">0 B</dd></div>
            <div><dt>Canvas</dt><dd data-testid="canvas-status">A · visible</dd></div>
            <div><dt>Viewport</dt><dd data-testid="viewport">—</dd></div>
          </dl>
        </aside>
      </div>

      <div class="lower-grid">
        <section class="panel architecture-card">
          <div class="panel-heading">
            <div><span class="section-index">03</span><h2>Public path</h2></div>
            <span class="pass-badge">ISOLATED</span>
          </div>
          <ol class="dependency-flow phase-01-flow" aria-label="Phase 1 dependency direction">
            <li><span>Playground</span><small>Canvas only</small></li>
            <li><span>Public SDK</span><small>auto / webgpu</small></li>
            <li><span>Feature</span><small>triangle / sphere</small></li>
            <li><span>Backend API</span><small>opaque handles</small></li>
            <li><span>WebGPU</span><small>native private</small></li>
          </ol>
        </section>

        <section class="panel event-card">
          <div class="panel-heading">
            <div><span class="section-index">04</span><h2>Event trace</h2></div>
            <button data-action="clear-log" class="text-button" type="button">Clear</button>
          </div>
          <ol class="event-log" data-testid="event-log" aria-live="polite"></ol>
        </section>
      </div>

      <footer>
        <span>No native GPU objects cross the SDK · No permanent RAF</span>
        <span>Phase 01 acceptance route: <code>/acceptance/phase-01</code></span>
      </footer>
    </main>
  `;
}

function activeCanvas(root: ParentNode, runtime: AcceptanceRuntime): HTMLCanvasElement {
  return requireElement(root, `[data-canvas="${runtime.activeCanvas}"]`);
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

function updateViewport(root: ParentNode): void {
  requireElement(root, '[data-testid="viewport"]').textContent =
    `${window.innerWidth} × ${window.innerHeight}`;
  requireElement(root, '[data-testid="dpr"]').textContent = window.devicePixelRatio.toFixed(2);
}

function updateDiagnostics(root: ParentNode, runtime: AcceptanceRuntime): void {
  updateViewport(root);
  const renderer = runtime.renderer;
  if (renderer === undefined) return;
  const diagnostics = renderer.getDiagnostics();
  const resources = diagnostics.backend.resources;
  const statistics = diagnostics.lastFrameStatistics;
  const backendType = requireElement<HTMLElement>(root, '[data-testid="backend-type"]');
  backendType.textContent = diagnostics.backend.type;
  backendType.dataset['timestampQuery'] = String(
    diagnostics.backend.capabilities.features['timestamp-query'],
  );
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
  requireElement(root, '[data-testid="resource-delta"]').textContent =
    diagnostics.state === 'ready' ? String(resources.activeCount - RESOURCE_BASELINE) : '—';
  const bufferMemory = requireElement<HTMLElement>(root, '[data-testid="buffer-memory"]');
  bufferMemory.textContent = formatBytes(resources.byKind.buffer.activeEstimatedBytes);
  bufferMemory.dataset['bytes'] = String(resources.byKind.buffer.activeEstimatedBytes);
  requireElement(root, '[data-testid="primitive"]').textContent = renderer.primitive.toUpperCase();
  requireElement(root, '[data-testid="active-canvas"]').textContent =
    runtime.activeCanvas.toUpperCase();
  requireElement(root, '[data-testid="canvas-status"]').textContent =
    `${runtime.activeCanvas.toUpperCase()} · ${runtime.hidden ? 'suspended' : 'visible'}`;

  const liveStatus = requireElement<HTMLElement>(root, '[data-testid="live-status"]');
  liveStatus.dataset['state'] = diagnostics.state;
  liveStatus.lastChild?.remove();
  liveStatus.append(document.createTextNode(` ${diagnostics.state.toUpperCase()}`));
  const verdict = requireElement(root, '[data-testid="resource-verdict"]');
  verdict.textContent =
    diagnostics.state === 'ready' && resources.activeCount === RESOURCE_BASELINE
      ? 'BASELINE'
      : diagnostics.state.toUpperCase();

  try {
    const surface = renderer.getSurfaceInfo();
    requireElement(root, '[data-testid="surface-size"]').textContent = surface.size.suspended
      ? 'suspended'
      : `${surface.size.physicalWidth}×${surface.size.physicalHeight}`;
  } catch {
    requireElement(root, '[data-testid="surface-size"]').textContent = 'unavailable';
  }
}

function bindRendererEvents(
  root: ParentNode,
  runtime: AcceptanceRuntime,
  renderer: KyxosCanvasRenderer,
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
      `frame.${frameIndex} · ${statistics.drawCalls} draw · ${statistics.triangles} triangles`,
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

function measuredSurface(root: ParentNode): { cssHeight: number; cssWidth: number } {
  const bounds = requireElement<HTMLElement>(
    root,
    '[data-testid="gpu-stage"]',
  ).getBoundingClientRect();
  return {
    cssHeight: Math.max(1, Math.round(bounds.height)),
    cssWidth: Math.max(1, Math.round(bounds.width)),
  };
}

async function createRenderer(root: ParentNode, runtime: AcceptanceRuntime): Promise<void> {
  runtime.renderer?.dispose();
  runtime.renderer = undefined;
  runtime.hidden = false;
  setError(root, undefined);
  const primary = requireElement<HTMLCanvasElement>(root, '[data-canvas="a"]');
  const secondary = requireElement<HTMLCanvasElement>(root, '[data-canvas="b"]');
  primary.classList.remove('is-hidden');
  secondary.classList.remove('is-hidden');
  primary.hidden = runtime.activeCanvas !== 'a';
  secondary.hidden = runtime.activeCanvas !== 'b';
  requireElement(root, '[data-testid="renderer-state"]').textContent = 'initializing';
  requireElement(root, '[data-testid="shader-status"]').textContent = 'compiling';
  const measured = measuredSurface(root);

  try {
    const renderer = await createKyxosRenderer({
      backend: 'webgpu',
      canvas: activeCanvas(root, runtime),
      clearColor: clearColorAt(runtime.clearVariant),
      cssHeight: measured.cssHeight,
      cssWidth: measured.cssWidth,
      devicePixelRatio: window.devicePixelRatio,
      label: `phase-01-canvas-${runtime.activeCanvas}`,
      powerPreference: 'high-performance',
      primitive: 'triangle',
    });
    runtime.renderer = renderer;
    bindRendererEvents(root, runtime, renderer);
    requireElement(root, '[data-testid="shader-status"]').textContent = 'pass';
    appendEvent(root, `renderer.ready · Canvas ${runtime.activeCanvas.toUpperCase()} · WGSL PASS`);
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
    try {
      switch (action) {
        case 'triangle':
          runtime.renderer?.setPrimitive('triangle');
          break;
        case 'sphere':
          runtime.renderer?.setPrimitive('sphere');
          break;
        case 'clear':
          runtime.clearVariant = (runtime.clearVariant + 1) % clearColors.length;
          runtime.renderer?.setClearColor(clearColorAt(runtime.clearVariant));
          break;
        case 'wake':
          runtime.renderer?.requestFrame('geometry');
          break;
        case 'hide':
          runtime.hidden = true;
          activeCanvas(root, runtime).classList.add('is-hidden');
          resizeRenderer(root, runtime);
          appendEvent(root, 'surface.suspend · zero CSS height');
          break;
        case 'restore':
          runtime.hidden = false;
          activeCanvas(root, runtime).classList.remove('is-hidden');
          resizeRenderer(root, runtime);
          appendEvent(root, 'surface.restore · reconfigured');
          break;
        case 'switch':
          runtime.activeCanvas = runtime.activeCanvas === 'a' ? 'b' : 'a';
          await createRenderer(root, runtime);
          break;
        case 'lose':
          runtime.renderer?.debugSimulateDeviceLoss();
          appendEvent(root, 'backend.loss-request · native device kept private');
          break;
        case 'recover':
          await runtime.renderer?.recover();
          appendEvent(root, 'renderer.recover · resources recreated');
          updateDiagnostics(root, runtime);
          break;
        case 'dispose':
          runtime.renderer?.dispose();
          appendEvent(root, 'renderer.dispose · RAF canceled · resources 0');
          updateDiagnostics(root, runtime);
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

export async function mountPhase01Acceptance(root: HTMLElement): Promise<void> {
  root.innerHTML = acceptanceMarkup();
  const runtime: AcceptanceRuntime = {
    activeCanvas: 'a',
    clearVariant: 0,
    hidden: false,
    renderer: undefined,
  };
  bindActions(root, runtime);
  updateViewport(root);
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
    observer.observe(requireElement(root, '[data-testid="gpu-stage"]'));
  }
}
