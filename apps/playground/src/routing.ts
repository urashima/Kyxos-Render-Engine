export type PlaygroundPhase = 0 | 1 | 2 | 3;

function parseSupportedPhase(value: string | undefined): PlaygroundPhase | undefined {
  return value !== undefined && /^0?[0-3]$/.test(value)
    ? (Number(value) as PlaygroundPhase)
    : undefined;
}

function deployedPhase(): PlaygroundPhase | undefined {
  return parseSupportedPhase(import.meta.env.VITE_DEPLOYED_PHASE);
}

function latestAcceptedPhase(): PlaygroundPhase {
  return parseSupportedPhase(import.meta.env.VITE_LATEST_ACCEPTED_PHASE) ?? 0;
}

function pagesRoot(): string | undefined {
  if (deployedPhase() === undefined) return undefined;
  const base = import.meta.env.BASE_URL;
  const root = base.replace(/(?:phase-\d+|latest)\/$/, '');
  return root.endsWith('/') ? root : `${root}/`;
}

export function acceptancePhaseHref(phase: PlaygroundPhase): string {
  const root = pagesRoot();
  return root === undefined
    ? `/acceptance/phase-${String(phase).padStart(2, '0')}`
    : `${root}phase-${phase}/`;
}

export function acceptanceRouteLabel(phase: PlaygroundPhase): string {
  return deployedPhase() === undefined
    ? `/acceptance/phase-${String(phase).padStart(2, '0')}`
    : `/phase-${phase}/`;
}

export function resolveAcceptancePhase(pathname: string): PlaygroundPhase | undefined {
  const fixedPhase = deployedPhase();
  if (fixedPhase !== undefined) return fixedPhase;

  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return 0;
  if (path.endsWith('/latest')) return latestAcceptedPhase();

  const match = /\/(?:acceptance\/)?phase-(\d{1,2})$/.exec(path);
  return parseSupportedPhase(match?.[1]);
}
