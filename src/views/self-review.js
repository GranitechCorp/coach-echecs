// Auto-analyse (en construction)
import { setTitle } from '../ui.js';

export const tab = 'profile';

export function render(root) {
  setTitle('Auto-analyse', '#/train');
  root.innerHTML = '<section class="card"><p>Bientôt disponible.</p></section>';
}
