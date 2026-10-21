// Le coach « maison » : bilans et conseils rédigés sans IA, à partir des analyses Stockfish
// et des règles de l'appli. Rien ne sort du téléphone.
import { db } from './storage.js';
import { CATEGORIES, SKILLS, lessonTitle } from './insights.js';
import { SLOTS } from './advisor.js';
import { THEME_LABELS } from './data/themes.js';
import { matchOpening } from './analyzer.js';
import { parseLine } from './data/openings.js';
import { fig, uciToSan } from './chessutil.js';

/** Les boutons ✨ (qui utilisent Claude) ne s'affichent que si le joueur les a activés. */
export const aiEnabled = () => db().settings.aiEnabled === true;

const moveLabel = (i) => `${Math.floor(i / 2) + 1}${i % 2 === 0 ? '.' : '…'}`;
/** En toutes lettres pour les phrases : « au 5e coup des Blancs » */
const moveWords = (i) => `${Math.floor(i / 2) + 1 === 1 ? '1er' : `${Math.floor(i / 2) + 1}e`} coup des ${i % 2 === 0 ? 'Blancs' : 'Noirs'}`;

/** Ce que dit le répertoire sur l'ouverture de la partie (sortie de ligne, coup prévu). */
export function openingNote(sans, userColor) {
  const m = matchOpening(sans);
  if (!m.line || m.len < 2) return null;
  const line = parseLine(m.line.moves);
  if (m.len >= line.length) return `Tu as joué toute la ligne « ${m.line.name} » de ton répertoire : bravo.`;
  const i = m.len;
  const expected = line[i];
  const whoseMove = i % 2 === 0 ? 'w' : 'b';
  if (whoseMove === userColor) {
    return `Au ${moveWords(i)}, tu as quitté ta ligne « ${m.line.name} » en jouant ${fig(sans[i])}. Le coup prévu était **${fig(expected.san)}**${expected.comment ? ` : ${expected.comment}` : '.'}`;
  }
  return `Au ${moveWords(i)}, ton adversaire a quitté la ligne « ${m.line.name} » (${fig(sans[i])} au lieu de ${fig(expected.san)}). À partir de là, applique les principes : développement, roque, centre.`;
}

/** Bilan d'une partie analysée, rédigé sans IA. */
export function gameSummaryLocal(game, review, sans) {
  const me = game.userColor;
  const d = review.derived;
  const out = [];
  const acc = Math.round(review.accuracy[me]);
  const verdict = acc >= 90 ? 'une partie très propre' : acc >= 80 ? 'une bonne partie' : acc >= 70 ? 'une partie correcte avec quelques trous' : 'une partie où des erreurs ont coûté cher';
  out.push(`**Précision ${acc} %** : ${verdict}.`);
  const note = openingNote(sans, me);
  if (note) out.push('📖 ' + note);
  const errors = (d?.errors || []).filter((e) => e.cls !== 'inaccuracy');
  if (!errors.length) {
    out.push('Aucune erreur importante de ta part. Continue comme ça !');
  } else {
    out.push(`**Les moments qui ont coûté des points :**`);
    for (const e of errors.slice(0, 5)) {
      const cat = e.cats.map((c) => CATEGORIES[c]?.label).filter(Boolean)[0];
      out.push(`- Coup ${moveLabel(e.i)} ${fig(uciToSan(e.fen, e.played))} (${e.cls === 'blunder' ? 'gaffe' : 'erreur'})${cat ? ` — ${cat.toLowerCase()}` : ''}. Il fallait ${e.best ? fig(uciToSan(e.fen, e.best)) : '?'}.`);
    }
    // conseil sur la catégorie la plus fréquente de la partie
    const count = {};
    for (const e of errors) for (const c of e.cats) if (CATEGORIES[c]) count[c] = (count[c] || 0) + 1;
    const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    if (top) out.push(`**À retenir :** ${CATEGORIES[top[0]].tip}`);
  }
  if (d && d.opportunities) out.push(`Ton adversaire t’a offert ${d.opportunities} occasion${d.opportunities > 1 ? 's' : ''} ; tu en as exploité ${d.converted}.`);
  if (d && d.maxAdv >= 300 && d.score !== 1) out.push('Tu as eu une position gagnante (+3 ou plus) sans gagner : entraîne-toi à convertir (échanger les pièces, éliminer le contre-jeu).');
  return out;
}

/** Bilan complet du joueur, rédigé sans IA. */
export function profileReportLocal(ins, recs) {
  const out = [];
  const known = SKILLS.filter((k) => ins.skills[k.id] !== null);
  if (known.length >= 3) {
    const sorted = [...known].sort((a, b) => ins.skills[b.id] - ins.skills[a.id]);
    out.push(`**Tes points forts :** ${sorted.slice(0, 2).map((k) => `${k.label.toLowerCase()} (${ins.skills[k.id]})`).join(', ')}.`);
    out.push(`**Tes points faibles :** ${sorted.slice(-2).reverse().map((k) => `${k.label.toLowerCase()} (${ins.skills[k.id]})`).join(', ')}.`);
  }
  if (ins.bpg !== null) {
    const b = ins.bpg;
    out.push(b >= 2 ? `Tu fais en moyenne ${b.toFixed(1)} gaffes par partie : c’est LE levier n°1. En dessous de 1 gaffe par partie, tu gagneras des centaines de points.` : b >= 1 ? `${b.toFixed(1)} gaffe par partie : c’est dans la moyenne à ton niveau, et c’est encore ce qui te coûte le plus.` : `Moins d’une gaffe par partie : ta vigilance est un vrai atout.`);
  }
  if (ins.weaknesses.length) {
    out.push('**Tes 3 priorités :**');
    ins.weaknesses.slice(0, 3).forEach((w, k) => out.push(`- ${k + 1}. ${w.title} — ${w.detail}. ${w.tip}`));
  }
  out.push('**Ouvertures :**');
  for (const [slot, title] of Object.entries(SLOTS)) {
    const [best] = recs[slot];
    out.push(`- ${title} : **${best.name}**${best.reasons.length ? ` (${best.reasons.slice(0, 2).join(' ; ')})` : ''}.`);
  }
  const w = ins.weaknesses;
  const theme = (k) => THEME_LABELS[w[k]?.theme] || 'mélange';
  const lesson = (k) => (w[k]?.lessons?.[0] ? lessonTitle(w[k].lessons[0]) : 'La routine anti-gaffe');
  out.push('**Plan sur 4 semaines :**');
  out.push(`- Semaine 1 : leçon « ${lesson(0)} », 10 exercices « ${theme(0)} » par jour, « Mes erreurs » chaque jour.`);
  out.push(`- Semaine 2 : leçon « ${lesson(1)} », exercices « ${theme(1)} », 3 parties contre l’ordinateur suivies de leur bilan.`);
  out.push(`- Semaine 3 : révision de tes ouvertures (« S’entraîner ») et leçons de finales, exercices « ${theme(2)} ».`);
  out.push('- Semaine 4 : importe tes nouvelles parties, relance l’analyse et compare ton diagnostic : les priorités ont-elles baissé ?');
  return out;
}
