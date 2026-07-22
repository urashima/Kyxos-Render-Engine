import { acceptancePhaseHref, resolveAcceptancePhase } from './routing.js';
import './styles.css';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) {
  throw new Error('Playground root element was not found.');
}

const phase =
  resolveAcceptancePhase(window.location.pathname) ??
  (window.history.replaceState({}, '', acceptancePhaseHref(0)), 0);

if (phase === 3) {
  await import('./acceptance/phase-03/index.js').then(({ mountPhase03Acceptance }) =>
    mountPhase03Acceptance(root),
  );
} else if (phase === 2) {
  await import('./acceptance/phase-02/index.js').then(({ mountPhase02Acceptance }) =>
    mountPhase02Acceptance(root),
  );
} else if (phase === 1) {
  await import('./acceptance/phase-01/index.js').then(({ mountPhase01Acceptance }) =>
    mountPhase01Acceptance(root),
  );
} else {
  await import('./acceptance/phase-00/index.js').then(({ mountPhase00Acceptance }) =>
    mountPhase00Acceptance(root),
  );
}
