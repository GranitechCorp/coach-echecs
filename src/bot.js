// Adversaire à niveau réglable, qui se trompe « comme un humain » de ce niveau.
// Jusqu'à 1800 : Stockfish calcule ses meilleurs coups (MultiPV), puis on en choisit un au hasard, pondéré par
// la perte qu'il entraîne : les coups proches du meilleur sont les plus probables, et de temps en temps vient une
// vraie erreur, plutôt « naturelle » (une prise, un échec) qu'absurde. Les réglages sont étalonnés (scripts/calibrate-bot.mjs)
// sur la perte moyenne par coup et la fréquence des gaffes des joueurs humains de chaque niveau.
// ≥ 2000 : le limiteur officiel de Stockfish (UCI_Elo), qui reste correct à ce niveau. En dessous, il joue des coups
// parfaits entrecoupés de gaffes au hasard, sur une échelle d'Elo de moteurs : rien à voir avec un humain de 1400.
import { Chess } from 'chess.js';
import { cpWhite } from './chessutil.js';

/**
 * temp : « température » en centipions (plus elle est haute, plus il accepte de perdre) ;
 * blunder : probabilité, à chaque coup, de choisir franchement une erreur (perte de 1,5 pion à maxLoss, 6 par défaut) ;
 * depth : profondeur de calcul (un joueur faible voit moins loin) ; lines : nombre de coups examinés.
 */
export const LEVELS = [
  // étalonnés sur 430 positions contre une analyse à la profondeur 14 (scripts/calibrate-bot.mjs) : perte moyenne par coup
  // et part de gaffes (≥ 2 pions) proches des joueurs humains de chaque niveau (sous 1000, les gaffes sont justes mais
  // la perte moyenne un peu plus faible : un débutant humain donne parfois sa dame, l'ordinateur rarement)
  { elo: 400, label: 'Débutant', temp: 600, blunder: 0.35, maxLoss: 900, depth: 6, lines: 10 },
  { elo: 600, label: 'Novice', temp: 600, blunder: 0.08, maxLoss: 900, depth: 7, lines: 10 },
  { elo: 800, label: 'Club débutant', temp: 280, blunder: 0.02, maxLoss: 900, depth: 8, lines: 10 },
  { elo: 1000, label: 'Amateur', temp: 200, blunder: 0, depth: 9, lines: 10 },
  { elo: 1200, label: 'Amateur+', temp: 140, blunder: 0, depth: 10, lines: 10 },
  { elo: 1400, label: 'Intermédiaire', temp: 100, blunder: 0.02, maxLoss: 900, depth: 10, lines: 10 },
  { elo: 1600, label: 'Objectif !', temp: 70, blunder: 0.06, maxLoss: 900, depth: 11, lines: 10 },
  { elo: 1800, label: 'Confirmé', temp: 70, blunder: 0.02, maxLoss: 900, depth: 12, lines: 10 },
  { elo: 2000, label: 'Expert' },
  { elo: 2400, label: 'Maître' },
];

export const levelFor = (elo) => LEVELS.reduce((a, l) => (Math.abs(l.elo - elo) < Math.abs(a.elo - elo) ? l : a));

const CAP = 1000; // les mats et les évaluations énormes sont ramenés à ±10 pions

/**
 * Probabilités de jeu de chaque coup examiné (fonction pure, utilisée aussi pour l'étalonnage).
 * lines : lignes MultiPV de Stockfish (les plus fortes d'abord). Renvoie [{ uci, loss, p }].
 */
export function moveChances(fen, lines, lvl) {
  const ok = lines.filter((l) => l.pv?.length);
  if (!ok.length) return [];
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
  const score = (l) => Math.max(-CAP, Math.min(CAP, cpWhite(l) * sign));
  const top = score(ok[0]);
  const chess = new Chess(fen);
  const moves = ok.map((l) => {
    const uci = l.pv[0];
    let natural = 1;
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      // un humain qui se trompe le fait surtout sur une prise ou un échec qui « a l'air » bon
      if (m.captured || m.san.includes('+')) natural = 1.6;
      chess.undo();
    } catch {
      /* coup illégal : ignoré plus bas */
    }
    return { uci, loss: Math.max(0, top - score(l)), natural };
  });
  // mat en 1 : à partir de 800, il ne le rate jamais
  const mate1 = ok[0].white?.mate !== undefined && Math.abs(ok[0].white.mate) === 1 && top > 0;
  if (mate1 && lvl.elo >= 800) return moves.map((m, i) => ({ ...m, p: i === 0 ? 1 : 0 }));
  // dans l'ouverture (8 premiers coups), même un joueur moyen suit les principes : on resserre le choix, sinon les coups
  // presque équivalents pour Stockfish (1…a5, 2…b6) sortiraient aussi souvent que les coups classiques
  const opening = +fen.split(' ')[5] <= 8;
  const temp = opening ? Math.max(8, lvl.temp / 4) : lvl.temp;
  // choix « normal » : softmax sur la perte
  const soft = moves.map((m) => Math.exp(-m.loss / temp) * (m.loss > 0 ? m.natural : 1));
  const softSum = soft.reduce((a, b) => a + b, 0);
  // vraie erreur : une perte de 1,5 pion à maxLoss, de préférence naturelle (une prise, un échec)
  const pool = moves.map((m) => (m.loss >= 150 && m.loss <= (lvl.maxLoss || 600) ? m.natural : 0));
  const poolSum = pool.reduce((a, b) => a + b, 0);
  const pb = poolSum ? (opening ? lvl.blunder / 2 : lvl.blunder) : 0;
  return moves.map((m, i) => ({ ...m, p: (1 - pb) * (soft[i] / softSum) + (poolSum ? pb * (pool[i] / poolSum) : 0) }));
}

/** Choisit le coup de l'ordinateur. Renvoie un coup UCI. */
export async function chooseBotMove(engine, fen, elo) {
  const lvl = levelFor(elo);
  if (!lvl.temp) {
    const res = await engine.search(fen, { movetime: elo >= 2400 ? 1500 : 1000, elo });
    return res.bestmove;
  }
  const res = await engine.search(fen, { depth: lvl.depth, multipv: lvl.lines });
  const chances = moveChances(fen, res.lines, lvl);
  if (!chances.length) return res.bestmove;
  let r = Math.random();
  for (const c of chances) {
    r -= c.p;
    if (r <= 0) return c.uci;
  }
  return chances[0].uci;
}
