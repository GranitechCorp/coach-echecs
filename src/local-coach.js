// Le coach « maison » : bilans et conseils rédigés sans IA, à partir des analyses Stockfish
// et des règles de l'appli. Rien ne sort du téléphone.
import { db } from './storage.js';
import { CATEGORIES, SKILLS, lessonTitle } from './insights.js';
import { SLOTS } from './advisor.js';
import { THEME_LABELS } from './data/themes.js';
import { matchOpening } from './analyzer.js';
import { parseLine } from './data/openings.js';
import { fig, uciToSan } from './chessutil.js';
import { tagCount } from './explain.js';

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
  const est = review.elo?.[me];
  if (est) {
    const acpl = review.acpl?.[me];
    const rating = game.myRating ? ` Ton classement au moment de la partie : ${game.myRating}.` : '';
    out.push(`**Elo estimé sur cette partie : ≈ ${est}** (indicatif${acpl !== null && acpl !== undefined ? `, d’après ta perte moyenne de ${acpl} centipions par coup` : ''}).${rating}`);
  }
  // coups brillants, coups forts, occasions manquées (étiquettes du bilan)
  const idx = (t, key) => d?.[key] || (review.tags || []).map((x, i) => (x === t && (i % 2 === 0) === (me === 'w') ? i : -1)).filter((i) => i >= 0);
  const label = (i) => `${moveLabel(i)}${fig(sans[i] || '')}`;
  const brilliant = idx('brilliant', 'brilliantIdx');
  const great = idx('great', 'greatIdx');
  const miss = idx('miss', 'missIdx');
  if (brilliant.length) out.push(`💎 **${tagCount('brilliant', brilliant.length)}** : ${brilliant.slice(0, 3).map(label).join(', ')}. Un sacrifice juste, bravo ! Revois-le pour graver l’idée.`);
  if (great.length) out.push(`**${tagCount('great', great.length)}** (le seul bon coup de la position) : ${great.slice(0, 4).map(label).join(', ')}.`);
  if (miss.length) out.push(`✗ **${tagCount('miss', miss.length)}** : ${miss.slice(0, 4).map(label).join(', ')}. ${miss.length > 1 ? 'À chaque fois, ton' : 'Ton'} adversaire venait de se tromper et tu n’as pas puni : après chaque coup adverse, demande-toi « qu’est-ce qu’il vient de laisser ? ».`);
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
  // (déjà dit plus haut s'il y a des occasions manquées)
  if (d && d.opportunities && !miss.length) out.push(`Ton adversaire t’a offert ${d.opportunities} occasion${d.opportunities > 1 ? 's' : ''} ; tu en as exploité ${d.converted}.`);
  if (d && d.maxAdv >= 300 && d.score !== 1) out.push('Tu as eu une position gagnante (+3 ou plus) sans gagner : entraîne-toi à convertir (échanger les pièces, éliminer le contre-jeu).');
  return out;
}

/** Bilan complet du joueur, rédigé sans IA. */
export function profileReportLocal(ins, recs) {
  const out = [];
  if (ins.estElo) {
    const s = db();
    const cc = s.ccRatings?.rapid?.rating || s.ccRatings?.blitz?.rating || s.profile.currentElo || null;
    const diff = cc ? ins.estElo - cc : 0;
    const cmp = !cc ? '' : diff >= 150 ? ` : c’est au-dessus de ton Elo chess.com (${cc}), tes résultats devraient suivre si tu restes régulier` : diff <= -150 ? ` : c’est sous ton Elo chess.com (${cc}), signe que quelques grosses gaffes plombent tes parties` : ` : c’est cohérent avec ton Elo chess.com (${cc})`;
    out.push(`**Niveau de jeu estimé : ≈ ${ins.estElo}** (${ins.estEloN > 1 ? `médiane de tes ${ins.estEloN} dernières parties analysées` : 'd’après ta seule partie analysée'}, indicatif)${cmp}.`);
    const goal = s.profile.goalElo;
    if (goal && ins.estAcpl !== null && ins.estAcpl !== undefined && ins.estElo < goal) out.push(`Pour jouer au niveau ${goal}, il faut perdre en moyenne environ ${acplForElo(goal)} centipions par coup ; tu en es à ${ins.estAcpl}. Chaque gaffe évitée fait baisser ce chiffre très vite.`);
  }
  if (ins.brilliants || ins.greats || ins.misses) {
    const parts = [];
    if (ins.brilliants) parts.push(`💎 ${tagCount('brilliant', ins.brilliants)}`);
    if (ins.greats) parts.push(tagCount('great', ins.greats));
    if (ins.misses) parts.push(`✗ ${tagCount('miss', ins.misses)}`);
    out.push(`Sur tes parties analysées : ${parts.join(', ')}.${ins.misses > ins.brilliants + ins.greats ? ' Les occasions manquées coûtent plus que ce que rapportent tes beaux coups : entraîne-toi à punir les erreurs adverses.' : ''}`);
  }
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

/** Perte moyenne par coup (centipions) qui correspond à un Elo donné (inverse de la formule d'Elo estimé). */
export const acplForElo = (elo) => Math.round(Math.log(3100 / elo) / 0.0116);
