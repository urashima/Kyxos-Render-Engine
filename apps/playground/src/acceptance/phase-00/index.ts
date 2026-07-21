import { createKyxosRendererFromBackend } from '@kyxos/render-sdk';
import type { BackendResourceHandle, KyxosRenderer } from '@kyxos/render-sdk';
import { MockBackend } from '@kyxos/render-testing';

import { acceptancePhaseHref, acceptanceRouteLabel } from '../../routing.js';

const COMMIT_SHA = import.meta.env.VITE_COMMIT_SHA ?? 'local-working-tree';

interface AcceptanceRuntime {
  readonly backend: MockBackend;
  readonly renderer: KyxosRenderer;
  readonly resources: BackendResourceHandle[];
}

function requireElement<ElementType extends Element>(
  root: ParentNode,
  selector: string,
): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (element === null) {
    throw new Error(`Required acceptance element was not found: ${selector}`);
  }
  return element;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function acceptanceMarkup(): string {
  return `
    <main class="shell" data-testid="phase-00-acceptance">
      <header class="topbar">
        <a class="brand" href="${acceptancePhaseHref(0)}" aria-label="Kyxos Render Engine home">
          <span class="brand-mark" aria-hidden="true">K</span>
          <span>
            <strong>Kyxos Render Engine</strong>
            <small>Independent Playground</small>
          </span>
        </a>
        <div class="phase-chip"><span></span> Phase 00 · Foundation</div>
      </header>

      <section class="hero">
        <div>
          <p class="eyebrow">AUTONOMOUS ACCEPTANCE SURFACE</p>
          <h1>Repository &amp; architecture baseline</h1>
          <p class="lede">
            A framework-independent runtime proving the public SDK, Mock Backend, dirty-driven
            scheduler, resource ownership, and device-loss path without Texture Lab.
          </p>
        </div>
        <div class="commit-block">
          <span>Commit</span>
          <code data-testid="commit-sha">${COMMIT_SHA}</code>
        </div>
      </section>

      <section class="status-strip" aria-label="Runtime status">
        <div><span>Backend</span><strong data-testid="backend-type">mock</strong></div>
        <div><span>Renderer</span><strong data-testid="renderer-state">initializing</strong></div>
        <div><span>Render mode</span><strong data-testid="render-mode">sleeping</strong></div>
        <div><span>Viewport</span><strong data-testid="viewport">—</strong></div>
        <div><span>DPR</span><strong data-testid="dpr">—</strong></div>
        <div><span>Quality</span><strong>foundation</strong></div>
      </section>

      <div class="workspace-grid">
        <section class="surface-card panel">
          <div class="panel-heading">
            <div>
              <span class="section-index">01</span>
              <h2>Runtime surface</h2>
            </div>
            <span class="live-status" data-testid="live-status"><i></i> READY</span>
          </div>
          <div class="mock-surface" data-testid="mock-surface">
            <div class="surface-orbit orbit-a"></div>
            <div class="surface-orbit orbit-b"></div>
            <div class="surface-core"><span>K</span></div>
            <p>Mock Backend</p>
            <small>GPU surface begins in Phase 01</small>
          </div>
          <div class="action-row" aria-label="Acceptance actions">
            <button data-action="wake" type="button">Wake / Invalidate</button>
            <button data-action="allocate" type="button">Allocate 1 MiB</button>
            <button data-action="release" type="button">Release latest</button>
            <button data-action="lose" type="button" class="warning">Simulate loss</button>
            <button data-action="recover" type="button">Recover</button>
            <button data-action="dispose" type="button" class="quiet">Dispose</button>
          </div>
        </section>

        <aside class="panel diagnostics-card">
          <div class="panel-heading">
            <div>
              <span class="section-index">02</span>
              <h2>Diagnostics</h2>
            </div>
          </div>
          <dl class="metric-list">
            <div><dt>Frame index</dt><dd data-testid="frame-index">0</dd></div>
            <div><dt>FPS</dt><dd data-testid="fps">0 · sleeping</dd></div>
            <div><dt>CPU frame</dt><dd>n/a · Phase 01</dd></div>
            <div><dt>GPU frame</dt><dd>n/a · Phase 01</dd></div>
            <div><dt>Draw calls</dt><dd>0</dd></div>
            <div><dt>Triangles</dt><dd>0</dd></div>
            <div><dt>Pipelines</dt><dd data-testid="pipeline-count">0</dd></div>
            <div><dt>Resources</dt><dd data-testid="resource-count">0</dd></div>
            <div><dt>Texture memory</dt><dd data-testid="texture-memory">0 B</dd></div>
            <div><dt>Buffer memory</dt><dd data-testid="buffer-memory">0 B</dd></div>
          </dl>
        </aside>
      </div>

      <div class="lower-grid">
        <section class="panel architecture-card">
          <div class="panel-heading">
            <div>
              <span class="section-index">03</span>
              <h2>Dependency boundary</h2>
            </div>
            <span class="pass-badge">PASS</span>
          </div>
          <ol class="dependency-flow" aria-label="Allowed dependency direction">
            <li><span>Playground</span><small>plain TypeScript</small></li>
            <li><span>Public SDK</span><small>stable root entry</small></li>
            <li><span>Renderer</span><small>no DOM / React</small></li>
            <li><span>Backend API</span><small>opaque handles</small></li>
            <li><span>Core</span><small>lifecycle &amp; errors</small></li>
          </ol>
        </section>

        <section class="panel event-card">
          <div class="panel-heading">
            <div>
              <span class="section-index">04</span>
              <h2>Event trace</h2>
            </div>
            <button data-action="clear-log" class="text-button" type="button">Clear</button>
          </div>
          <ol class="event-log" data-testid="event-log" aria-live="polite"></ol>
        </section>
      </div>

      <footer>
        <span>No Texture Lab · No React · No permanent RAF</span>
        <span>Phase 00 acceptance route: <code>${acceptanceRouteLabel(0)}</code></span>
      </footer>
    </main>
  `;
}

function updateViewport(root: ParentNode): void {
  requireElement(root, '[data-testid="viewport"]').textContent =
    `${window.innerWidth} × ${window.innerHeight}`;
  requireElement(root, '[data-testid="dpr"]').textContent = window.devicePixelRatio.toFixed(2);
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
  while (log.childElementCount > 8) {
    log.lastElementChild?.remove();
  }
}

function updateDiagnostics(root: ParentNode, runtime: AcceptanceRuntime): void {
  const diagnostics = runtime.renderer.getDiagnostics();
  const resources = diagnostics.backend.resources;
  requireElement(root, '[data-testid="backend-type"]').textContent = diagnostics.backend.type;
  requireElement(root, '[data-testid="renderer-state"]').textContent = diagnostics.state;
  requireElement(root, '[data-testid="render-mode"]').textContent = diagnostics.renderMode;
  requireElement(root, '[data-testid="frame-index"]').textContent = String(diagnostics.frameIndex);
  requireElement(root, '[data-testid="fps"]').textContent =
    diagnostics.renderMode === 'sleeping' ? '0 · sleeping' : 'active';
  requireElement(root, '[data-testid="pipeline-count"]').textContent = String(
    resources.byKind.pipeline.activeCount,
  );
  requireElement(root, '[data-testid="resource-count"]').textContent = String(
    resources.activeCount,
  );
  requireElement(root, '[data-testid="texture-memory"]').textContent = formatBytes(
    resources.byKind.texture.activeEstimatedBytes,
  );
  requireElement(root, '[data-testid="buffer-memory"]').textContent = formatBytes(
    resources.byKind.buffer.activeEstimatedBytes,
  );

  const liveStatus = requireElement<HTMLElement>(root, '[data-testid="live-status"]');
  liveStatus.dataset['state'] = diagnostics.state;
  liveStatus.lastChild?.remove();
  liveStatus.append(document.createTextNode(` ${diagnostics.state.toUpperCase()}`));
}

function bindRuntimeEvents(root: ParentNode, runtime: AcceptanceRuntime): void {
  runtime.renderer.on('ready', () => {
    appendEvent(root, 'renderer.ready');
    updateDiagnostics(root, runtime);
  });
  runtime.renderer.on('wake', ({ dirtyFlag }) => {
    appendEvent(root, `scheduler.wake · ${dirtyFlag}`);
    updateDiagnostics(root, runtime);
  });
  runtime.renderer.on('frame', ({ dirtyFlags, frameIndex }) => {
    appendEvent(root, `frame.${frameIndex} · ${dirtyFlags.join(', ')}`);
    updateDiagnostics(root, runtime);
  });
  runtime.renderer.on('sleep', () => {
    appendEvent(root, 'scheduler.sleep · zero pending frames');
    updateDiagnostics(root, runtime);
  });
  runtime.renderer.on('device-lost', ({ reason }) => {
    appendEvent(root, `backend.lost · ${reason}`);
    updateDiagnostics(root, runtime);
  });
}

function bindActions(root: ParentNode, runtime: AcceptanceRuntime): void {
  root.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    const action = target.dataset['action'];
    try {
      switch (action) {
        case 'wake':
          runtime.renderer.invalidate('material');
          break;
        case 'allocate':
          runtime.resources.push(
            runtime.backend.createResource('texture', {
              estimatedBytes: 1024 * 1024,
              label: `phase-00-texture-${runtime.resources.length + 1}`,
            }),
          );
          appendEvent(root, 'resource.create · texture 1 MiB');
          updateDiagnostics(root, runtime);
          break;
        case 'release': {
          const resource = runtime.resources.pop();
          if (resource !== undefined) {
            runtime.backend.destroyResource(resource);
            appendEvent(root, 'resource.dispose · active baseline updated');
          }
          updateDiagnostics(root, runtime);
          break;
        }
        case 'lose':
          runtime.backend.simulateLoss({ message: 'Phase 0 acceptance loss simulation.' });
          runtime.resources.length = 0;
          break;
        case 'recover':
          await runtime.renderer.initialize();
          appendEvent(root, 'renderer.recovered');
          updateDiagnostics(root, runtime);
          break;
        case 'dispose':
          runtime.renderer.dispose();
          runtime.resources.length = 0;
          appendEvent(root, 'renderer.dispose · resources 0');
          updateDiagnostics(root, runtime);
          break;
        case 'clear-log':
          requireElement(root, '[data-testid="event-log"]').replaceChildren();
          break;
        default:
          break;
      }
    } catch (error) {
      appendEvent(root, error instanceof Error ? `error · ${error.message}` : 'error · unknown');
      updateDiagnostics(root, runtime);
    }
  });
}

export async function mountPhase00Acceptance(root: HTMLElement): Promise<void> {
  root.innerHTML = acceptanceMarkup();
  const backend = new MockBackend();
  const renderer = await createKyxosRendererFromBackend({ backend });
  const runtime: AcceptanceRuntime = { backend, renderer, resources: [] };

  bindRuntimeEvents(root, runtime);
  bindActions(root, runtime);
  updateViewport(root);
  updateDiagnostics(root, runtime);
  appendEvent(root, 'acceptance.ready · SDK initialized');
  window.addEventListener('resize', () => updateViewport(root));
}
