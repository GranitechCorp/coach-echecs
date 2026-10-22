// Salle d'entraînement : tous les modes d'exercice au même endroit, avec où tu en es.
import { db } from '../storage.js';
import { setTitle, esc } from '../ui.js';
import { visionStats } from './vision.js';
import { rushStats } from './rush.js';
import { woodpeckerStatus } from './woodpecker.js';
import { blunderStats } from './blunder.js';

export const tab = 'puzzles';

export function render(root) {
  setTitle('Entraînement');
  const s = db();
  const due = s.mistakes.filter((m) => m.due <= Date.now()).length;
  const vision = visionStats();
  const rush = rushStats();
  const wood = woodpeckerStatus();
  const gaffe = blunderStats();
  const lastGame = [...s.games].reverse().find((g) => !(s.selfReviews || {})[g.id]) || s.games.at(-1);
  const rushBest = Math.max(rush.best.m3 || 0, rush.best.m5 || 0, rush.best.survival || 0);

  const MODES = [
    { href: '#/vision', icon: '👁', title: 'Vision de l’échiquier', text: 'Situer e4, c6 ou h7 sans regarder les lettres, lire la notation, visualiser les coups.', status: vision.bestFind ? `Record : ${vision.bestFind} cases en 30 s · ${vision.level}${vision.dailyDone ? ' · défi du jour fait ✓' : ''}` : 'À commencer : 5 minutes par jour suffisent.' },
    { href: '#/gaffe', icon: '🛡', title: 'Anti-gaffe', text: 'Sûr ou gaffe ? Vérifie des coups tirés de tes parties, puis punis les gaffes de tes adversaires : le réflexe qui fait gagner le plus de points.', status: gaffe.total ? `${gaffe.today} position${gaffe.today > 1 ? 's' : ''} aujourd’hui${gaffe.accuracy !== null ? ` · ${gaffe.accuracy} % de bonnes réponses` : ''}` : 'Ta priorité si tu laisses souvent des pièces en prise.' },
    { href: '#/puzzles', icon: '✦', title: 'Tactique', text: 'Exercices par thème, à ton niveau (Lichess en ligne, banque intégrée sinon).', status: `Classement exercices : ${Math.round(s.puzzles.rating)}` },
    { href: '#/rush', icon: '⏱', title: 'Course contre la montre', text: '3 minutes, 3 erreurs maximum, difficulté croissante : entraîne ton coup d’œil.', status: rushBest ? `Record : ${rushBest} exercice${rushBest > 1 ? 's' : ''}` : '' },
    { href: '#/woodpecker', icon: '🔁', title: 'Méthode Woodpecker', text: 'Le même lot d’exercices, en cycles de plus en plus rapides, jusqu’à ce que les motifs deviennent des réflexes.', status: wood.active ? `Cycle ${wood.cycle} : ${wood.done}/${wood.total}` : '' },
    { href: '#/puzzles/mistakes', icon: '🎯', title: 'Mes erreurs', text: 'Les positions où tu t’es trompé dans tes parties reviennent jusqu’à ce que tu les trouves.', status: due ? `${due} à revoir aujourd’hui` : 'Rien à revoir pour l’instant', badge: due },
    { href: '#/guess', icon: '🤔', title: 'Devine le coup', text: 'Rejoue des parties modèles et trouve les coups des joueurs : la méthode des grands livres.', status: '' },
    { href: lastGame ? `#/selfreview/${lastGame.id}` : '#/play', icon: '🧠', title: 'Auto-analyse', text: 'Analyse d’abord ta partie toi-même, puis compare avec Stockfish : l’habitude des joueurs qui progressent vite.', status: lastGame ? `Prochaine partie : ${lastGame.label || 'ta dernière partie'}` : 'Joue ou importe d’abord une partie.' },
    { href: '#/puzzles/lessons', icon: '📘', title: 'Exercices des cours', text: 'Les positions des leçons, mélangées, pour réviser.', status: '' },
  ];

  root.innerHTML = `<div class="train-grid">${MODES.map(
    (m) => `<a class="card train-tile" href="${m.href}"><span class="train-icon">${m.icon}</span><span><b>${esc(m.title)}</b>${m.badge ? ` <span class="pill">${m.badge}</span>` : ''}<br/><small class="muted">${esc(m.text)}</small>${m.status ? `<br/><small class="train-status">${esc(m.status)}</small>` : ''}</span></a>`,
  ).join('')}</div>`;
}
