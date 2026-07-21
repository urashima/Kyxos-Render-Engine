import { mountPhase00Acceptance } from './acceptance/phase-00/index.js';
import './styles.css';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) {
  throw new Error('Playground root element was not found.');
}

const normalizedPath = window.location.pathname.replace(/\/$/, '') || '/';
if (normalizedPath !== '/' && normalizedPath !== '/acceptance/phase-00') {
  window.history.replaceState({}, '', '/acceptance/phase-00');
}

await mountPhase00Acceptance(root);
