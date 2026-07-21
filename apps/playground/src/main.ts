import { mountPhase00Acceptance } from './acceptance/phase-00/index.js';
import { acceptancePhaseHref, resolveAcceptancePhase } from './routing.js';
import './styles.css';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) {
  throw new Error('Playground root element was not found.');
}

const phase = resolveAcceptancePhase(window.location.pathname);
if (phase === undefined) {
  window.history.replaceState({}, '', acceptancePhaseHref(0));
}

if (phase === 2) {
  const { mountPhase02Acceptance } = await import('./acceptance/phase-02/index.js');
  await mountPhase02Acceptance(root);
} else if (phase === 1) {
  const { mountPhase01Acceptance } = await import('./acceptance/phase-01/index.js');
  await mountPhase01Acceptance(root);
} else {
  await mountPhase00Acceptance(root);
}
