// Anti-gaffe : « Sûr ou gaffe ? » et « Punis la gaffe », à partir de tes propres parties (ébauche, à construire).
import { db } from '../storage.js';
import { setTitle } from '../ui.js';

export const tab = 'puzzles';

/** Où tu en es (salle d'entraînement et programme) : positions faites aujourd'hui, au total, précision. */
export function blunderStats() {
  const b = db().blunder || {};
  return { today: 0, total: (b.history || []).length, accuracy: null };
}

export function render(root, mode) {
  setTitle('Anti-gaffe', '#/train');
  root.innerHTML = `<section class="card"><p class="muted">Bientôt disponible.</p></section>`;
}
