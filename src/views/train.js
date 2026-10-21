// Salle d'entraînement : tous les modes d'exercice au même endroit.
import { db } from '../storage.js';
import { setTitle, esc } from '../ui.js';

export const tab = 'puzzles';

const MODES = [
  { href: '#/puzzles', icon: '✦', title: 'Tactique', text: 'Exercices par thème, à ton niveau (Lichess en ligne, banque intégrée sinon).' },
  { href: '#/rush', icon: '⏱', title: 'Course contre la montre', text: '3 minutes, 3 erreurs maximum, difficulté croissante : entraîne ton coup d’œil.' },
  { href: '#/woodpecker', icon: '🔁', title: 'Méthode Woodpecker', text: 'Le même lot d’exercices, en cycles de plus en plus rapides, jusqu’à ce que les motifs deviennent des réflexes.' },
  { href: '#/puzzles/mistakes', icon: '🎯', title: 'Mes erreurs', text: 'Les positions où tu t’es trompé dans tes parties reviennent jusqu’à ce que tu les trouves.' },
  { href: '#/vision', icon: '👁', title: 'Vision de l’échiquier', text: 'Repérer les cases (e4, c6, h7…) sans hésiter, lire la notation, visualiser les coups.' },
  { href: '#/guess', icon: '🤔', title: 'Devine le coup', text: 'Rejoue des parties modèles et trouve les coups des joueurs : la méthode des grands livres.' },
  { href: '#/puzzles/lessons', icon: '📘', title: 'Exercices des cours', text: 'Les positions des leçons, mélangées, pour réviser.' },
];

export function render(root) {
  setTitle('Entraînement');
  const s = db();
  const due = s.mistakes.filter((m) => m.due <= Date.now()).length;
  root.innerHTML = `<div class="train-grid">${MODES.map(
    (m) => `<a class="card train-tile" href="${m.href}"><span class="train-icon">${m.icon}</span><span><b>${esc(m.title)}</b>${m.href === '#/puzzles/mistakes' && due ? ` <span class="pill">${due}</span>` : ''}<br/><small class="muted">${esc(m.text)}</small></span></a>`,
  ).join('')}</div>`;
}
