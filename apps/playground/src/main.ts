import { mountPhase00Acceptance } from './acceptance/phase-00/index.js';
import './styles.css';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) {
  throw new Error('Playground root element was not found.');
}

const normalizedPath = window.location.pathname.replace(/\/$/, '') || '/';
if (
  normalizedPath !== '/' &&
  normalizedPath !== '/acceptance/phase-00' &&
  normalizedPath !== '/acceptance/phase-01' &&
  normalizedPath !== '/acceptance/phase-02'
) {
  window.history.replaceState({}, '', '/acceptance/phase-00');
}

if (normalizedPath === '/acceptance/phase-02') {
  const { mountPhase02Acceptance } = await import('./acceptance/phase-02/index.js');
  await mountPhase02Acceptance(root);
} else if (normalizedPath === '/acceptance/phase-01') {
  const { mountPhase01Acceptance } = await import('./acceptance/phase-01/index.js');
  await mountPhase01Acceptance(root);
} else {
  await mountPhase00Acceptance(root);
}
