// Course contre la montre (en construction)
import { setTitle } from '../ui.js';

export const tab = 'puzzles';

export function render(root) {
  setTitle('Course contre la montre', '#/train');
  root.innerHTML = '<section class="card"><p>Bientôt disponible.</p></section>';
}
