// Mon arbre d'ouvertures : tes parties regroupées coup par coup, comparées à ton répertoire (ébauche, à construire).
import { setTitle } from '../ui.js';

export const tab = 'learn';

export function render(root, side) {
  setTitle('Mon arbre d’ouvertures', '#/learn');
  root.innerHTML = `<section class="card"><p class="muted">Bientôt disponible.</p></section>`;
}
