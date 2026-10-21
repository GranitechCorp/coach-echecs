// Construction des demandes envoyées au coach IA : toujours avec les données du moteur,
// pour que les explications restent exactes.
import { describePosition } from './coach-ai.js';
import { pvToSan, evalText, uciToSan, safeChess, colorName } from './chessutil.js';
import { describeMove } from './explain.js';
import { LESSONS } from './data/lessons.js';

const linesBlock = (fen, lines) =>
  lines.length
    ? lines.map((l, i) => `${i + 1}. ${evalText(l)} : ${pvToSan(fen, l.pv, 8, true)}`).join('\n')
    : '(pas d’analyse)';

const historyBlock = (sans, startMoveNo = 1) => {
  if (!sans?.length) return '(début de partie)';
  const out = [];
  sans.forEach((s, i) => out.push(i % 2 === 0 ? `${startMoveNo + i / 2}.${s}` : s));
  return out.join(' ');
};

/** Explication du meilleur coup dans la position (indice / « pourquoi ? »). */
export function promptBestMove({ fen, lines, userColor, history }) {
  const best = lines[0];
  const facts = best ? describeMove(fen, best.pv[0]).facts : [];
  return `Je joue les ${colorName(userColor)}. Explique-moi le meilleur coup dans cette position, et le plan qui va avec.

${describePosition(fen)}
Coups de la partie : ${historyBlock(history)}

Analyse Stockfish (évaluations du point de vue des Blancs) :
${linesBlock(fen, lines)}

Ce que mon programme a repéré sur le meilleur coup : ${facts.join(' ') || 'rien de particulier'}

Explique pourquoi ce coup est le meilleur, ce qu'il menace, et pourquoi les autres lignes sont moins bonnes. 150 mots maximum.`;
}

/** Explication d'un coup joué (erreur ou non). */
export function promptPlayedMove({ fen, playedUci, linesBefore, linesAfter, userColor, history, cls }) {
  const c = safeChess(fen);
  const after = safeChess(fen);
  after.move({ from: playedUci.slice(0, 2), to: playedUci.slice(2, 4), promotion: playedUci[4] || 'q' });
  const played = uciToSan(fen, playedUci);
  const playedFacts = describeMove(fen, playedUci).facts;
  return `Je joue les ${colorName(userColor)}. Au ${c.moveNumber()}e coup, j'ai joué ${played} (classé : ${cls}). Explique-moi ce coup.

Position AVANT mon coup :
${describePosition(fen)}
Coups de la partie : ${historyBlock(history)}

Meilleures lignes AVANT mon coup (évaluations du point de vue des Blancs) :
${linesBlock(fen, linesBefore || [])}

Meilleures lignes APRÈS mon coup ${played} :
${linesBlock(after.fen(), linesAfter || [])}

Ce que mon programme a repéré sur ${played} : ${playedFacts.join(' ') || 'rien de particulier'}

Si c'est une erreur : explique ce que j'ai raté (la réponse adverse et pourquoi elle fait mal), ce qu'il fallait jouer et quel réflexe de pensée m'aurait évité l'erreur. Si c'est un bon coup : dis pourquoi en deux phrases. 150 mots maximum.`;
}

/** Bilan complet d'une partie analysée. */
export function promptGameSummary({ game, review, moments, opening }) {
  const lessonTitles = LESSONS.map((l) => l.title).join(', ');
  const counts = Object.entries(review.counts[game.userColor] || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  const mo = moments
    .map((m) => `- Coup ${m.label} : j'ai joué ${m.played} (${m.cls}), le meilleur était ${m.best}. Éval. ${m.evalBefore} → ${m.evalAfter}. Suite adverse : ${m.refutation || '—'}.`)
    .join('\n');
  return `Fais le bilan de ma partie. Je jouais les ${colorName(game.userColor)}${game.botElo ? ` contre l'ordinateur niveau ${game.botElo}` : ''}. Résultat : ${game.result}.
Ouverture : ${opening || 'inconnue'}.
Précision (calculée avec Stockfish) : moi ${Math.round(review.accuracy[game.userColor])} %, adversaire ${Math.round(review.accuracy[game.userColor === 'w' ? 'b' : 'w'])} %.
Mes coups par catégorie : ${counts}.

Partie : ${historyBlock(game.sans)}

Moments clés (d'après Stockfish) :
${mo || '(aucune grosse erreur)'}

Fais un bilan structuré et encourageant :
1. **Ouverture** : comment je l'ai jouée par rapport à mon répertoire (Gambit Dame / Caro-Kann).
2. **Les moments clés** : ce qui s'est passé et la leçon à en tirer.
3. **Mes 3 priorités de travail**, chacune reliée à une leçon de l'appli parmi : ${lessonTitles}.
250 mots maximum.`;
}

/** Question libre sur une position. */
export function promptQuestion({ fen, lines, question, userColor }) {
  return `${userColor ? `Je joue les ${colorName(userColor)}. ` : ''}Question sur cette position : ${question}

${describePosition(fen)}

Analyse Stockfish (évaluations du point de vue des Blancs) :
${linesBlock(fen, lines || [])}

Réponds précisément à ma question, en t'appuyant sur ces lignes. 150 mots maximum.`;
}
